import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type {
  VexaCompositionRenderer,
  VexaFrameRenderOptions,
  VexaImageRenderResult
} from "@vexa-video/renderer";

export type VexaVisualTestErrorCode =
  | "INVALID_VISUAL_TEST_OPTIONS"
  | "INVALID_PNG_SNAPSHOT"
  | "VISUAL_SNAPSHOT_MISMATCH";

export interface VexaPngDimensions {
  readonly width: number;
  readonly height: number;
}

export interface VexaPngSnapshotTolerance {
  /** Maximum allowed absolute delta for each RGBA channel, from 0 through 255. */
  readonly channelTolerance?: number;
  /** Maximum share of pixels that may exceed channelTolerance, from 0 through 1. */
  readonly maxDifferentPixelRatio?: number;
}

export interface VexaPngSnapshotComparison {
  readonly matches: boolean;
  readonly dimensionsMatch: boolean;
  readonly actualDimensions: VexaPngDimensions;
  readonly expectedDimensions: VexaPngDimensions;
  readonly totalPixels: number;
  readonly differentPixels: number;
  readonly differentPixelRatio: number;
  readonly maxChannelDelta: number;
  readonly channelTolerance: number;
  readonly maxDifferentPixelRatio: number;
}

export class VexaVisualTestError extends Error {
  readonly code: VexaVisualTestErrorCode;
  readonly comparison?: VexaPngSnapshotComparison;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: VexaVisualTestErrorCode,
    options: {
      readonly comparison?: VexaPngSnapshotComparison;
      readonly cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.comparison !== undefined) this.comparison = options.comparison;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface VexaVisualCheckpoint {
  readonly name: string;
  readonly frame: number;
}

export interface VexaVisualCheckpointRenderOptions
  extends Omit<VexaFrameRenderOptions, "frame" | "output" | "format"> {
  readonly outputDirectory: string;
  readonly checkpoints: readonly VexaVisualCheckpoint[];
}

export interface VexaRenderedVisualCheckpoint {
  readonly name: string;
  readonly frame: number;
  readonly output: string;
  readonly render: VexaImageRenderResult;
}

export type VexaVisualCheckpointRenderer = Pick<VexaCompositionRenderer, "renderFrame">;

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface NormalizedTolerance {
  readonly channelTolerance: number;
  readonly maxDifferentPixelRatio: number;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_PIXELS = 40_000_000;
const CHECKPOINT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

function invalidOptions(message: string): VexaVisualTestError {
  return new VexaVisualTestError(message, "INVALID_VISUAL_TEST_OPTIONS");
}

function invalidPng(message: string, cause?: unknown): VexaVisualTestError {
  return new VexaVisualTestError(
    message,
    "INVALID_PNG_SNAPSHOT",
    cause === undefined ? {} : { cause }
  );
}

function normalizeTolerance(options: VexaPngSnapshotTolerance = {}): NormalizedTolerance {
  const channelTolerance = options.channelTolerance ?? 0;
  if (!Number.isInteger(channelTolerance) || channelTolerance < 0 || channelTolerance > 255) {
    throw invalidOptions("channelTolerance must be an integer between 0 and 255.");
  }

  const maxDifferentPixelRatio = options.maxDifferentPixelRatio ?? 0;
  if (
    typeof maxDifferentPixelRatio !== "number" ||
    !Number.isFinite(maxDifferentPixelRatio) ||
    maxDifferentPixelRatio < 0 ||
    maxDifferentPixelRatio > 1
  ) {
    throw invalidOptions("maxDifferentPixelRatio must be a finite number between 0 and 1.");
  }

  return Object.freeze({ channelTolerance, maxDifferentPixelRatio });
}

function assertPngSignature(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw invalidPng("PNG snapshot is shorter than the PNG signature.");
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw invalidPng("PNG snapshot has an invalid signature.");
    }
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function unfilterScanlines(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number
): Uint8Array {
  const stride = width * bytesPerPixel;
  const expectedBytes = (stride + 1) * height;
  if (raw.length !== expectedBytes) {
    throw invalidPng(
      `Inflated PNG data has ${raw.length} bytes; expected ${expectedBytes}.`
    );
  }

  const output = new Uint8Array(stride * height);
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    if (filter === undefined || filter > 4) {
      throw invalidPng(`PNG row ${row} uses unsupported filter ${String(filter)}.`);
    }

    const rowOffset = row * stride;
    const previousRowOffset = rowOffset - stride;
    for (let column = 0; column < stride; column += 1) {
      const encoded = raw[sourceOffset + column];
      if (encoded === undefined) throw invalidPng("PNG scanline ended unexpectedly.");

      const left = column >= bytesPerPixel
        ? output[rowOffset + column - bytesPerPixel] ?? 0
        : 0;
      const up = row > 0 ? output[previousRowOffset + column] ?? 0 : 0;
      const upLeft = row > 0 && column >= bytesPerPixel
        ? output[previousRowOffset + column - bytesPerPixel] ?? 0
        : 0;

      let predictor = 0;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = Math.floor((left + up) / 2);
          break;
        case 4:
          predictor = paethPredictor(left, up, upLeft);
          break;
      }
      output[rowOffset + column] = (encoded + predictor) & 0xff;
    }
    sourceOffset += stride;
  }

  return output;
}

function decodePng(snapshot: Uint8Array): DecodedPng {
  assertPngSignature(snapshot);
  const bytes = Buffer.from(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
  let offset = PNG_SIGNATURE.length;
  let width: number | undefined;
  let height: number | undefined;
  let colorType: number | undefined;
  const idatChunks: Buffer[] = [];
  let sawIend = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw invalidPng("PNG chunk header is truncated.");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) throw invalidPng(`PNG ${type} chunk is truncated.`);

    if (type === "IHDR") {
      if (width !== undefined) throw invalidPng("PNG contains more than one IHDR chunk.");
      if (length !== 13) throw invalidPng("PNG IHDR chunk must contain exactly 13 bytes.");
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filterMethod = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];

      if (width <= 0 || height <= 0) throw invalidPng("PNG dimensions must be positive.");
      if (width * height > MAX_PNG_PIXELS) {
        throw invalidPng(`PNG exceeds the ${MAX_PNG_PIXELS}-pixel visual-test limit.`);
      }
      if (bitDepth !== 8) throw invalidPng("Only 8-bit PNG snapshots are supported.");
      if (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6) {
        throw invalidPng(`PNG color type ${String(colorType)} is not supported.`);
      }
      if (compression !== 0 || filterMethod !== 0) {
        throw invalidPng("PNG uses an unsupported compression or filter method.");
      }
      if (interlace !== 0) throw invalidPng("Interlaced PNG snapshots are not supported.");
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }

    offset = chunkEnd;
  }

  if (width === undefined || height === undefined || colorType === undefined) {
    throw invalidPng("PNG is missing its IHDR chunk.");
  }
  if (idatChunks.length === 0) throw invalidPng("PNG is missing image data.");
  if (!sawIend) throw invalidPng("PNG is missing its IEND chunk.");

  const bytesPerPixel = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const expectedInflatedBytes = (width * bytesPerPixel + 1) * height;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedInflatedBytes });
  } catch (cause) {
    throw invalidPng("PNG image data could not be inflated.", cause);
  }

  const scanlines = unfilterScanlines(inflated, width, height, bytesPerPixel);
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let outputOffset = 0;

  while (sourceOffset < scanlines.length) {
    switch (colorType) {
      case 0: {
        const gray = scanlines[sourceOffset] ?? 0;
        rgba[outputOffset] = gray;
        rgba[outputOffset + 1] = gray;
        rgba[outputOffset + 2] = gray;
        rgba[outputOffset + 3] = 255;
        break;
      }
      case 2:
        rgba[outputOffset] = scanlines[sourceOffset] ?? 0;
        rgba[outputOffset + 1] = scanlines[sourceOffset + 1] ?? 0;
        rgba[outputOffset + 2] = scanlines[sourceOffset + 2] ?? 0;
        rgba[outputOffset + 3] = 255;
        break;
      case 4: {
        const gray = scanlines[sourceOffset] ?? 0;
        rgba[outputOffset] = gray;
        rgba[outputOffset + 1] = gray;
        rgba[outputOffset + 2] = gray;
        rgba[outputOffset + 3] = scanlines[sourceOffset + 1] ?? 0;
        break;
      }
      case 6:
        rgba[outputOffset] = scanlines[sourceOffset] ?? 0;
        rgba[outputOffset + 1] = scanlines[sourceOffset + 1] ?? 0;
        rgba[outputOffset + 2] = scanlines[sourceOffset + 2] ?? 0;
        rgba[outputOffset + 3] = scanlines[sourceOffset + 3] ?? 0;
        break;
    }
    sourceOffset += bytesPerPixel;
    outputOffset += 4;
  }

  return Object.freeze({ width, height, rgba });
}

function dimensions(width: number, height: number): VexaPngDimensions {
  return Object.freeze({ width, height });
}

export function comparePngSnapshots(
  actualSnapshot: Uint8Array,
  expectedSnapshot: Uint8Array,
  options: VexaPngSnapshotTolerance = {}
): VexaPngSnapshotComparison {
  const tolerance = normalizeTolerance(options);
  const actual = decodePng(actualSnapshot);
  const expected = decodePng(expectedSnapshot);
  const dimensionsMatch = actual.width === expected.width && actual.height === expected.height;

  if (!dimensionsMatch) {
    const totalPixels = Math.max(actual.width * actual.height, expected.width * expected.height);
    return Object.freeze({
      matches: false,
      dimensionsMatch: false,
      actualDimensions: dimensions(actual.width, actual.height),
      expectedDimensions: dimensions(expected.width, expected.height),
      totalPixels,
      differentPixels: totalPixels,
      differentPixelRatio: 1,
      maxChannelDelta: 255,
      ...tolerance
    });
  }

  const totalPixels = actual.width * actual.height;
  let differentPixels = 0;
  let maxChannelDelta = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const channelStart = pixel * 4;
    let pixelDifferent = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        (actual.rgba[channelStart + channel] ?? 0) -
        (expected.rgba[channelStart + channel] ?? 0)
      );
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > tolerance.channelTolerance) pixelDifferent = true;
    }
    if (pixelDifferent) differentPixels += 1;
  }

  const differentPixelRatio = differentPixels / totalPixels;
  return Object.freeze({
    matches: differentPixelRatio <= tolerance.maxDifferentPixelRatio,
    dimensionsMatch: true,
    actualDimensions: dimensions(actual.width, actual.height),
    expectedDimensions: dimensions(expected.width, expected.height),
    totalPixels,
    differentPixels,
    differentPixelRatio,
    maxChannelDelta,
    ...tolerance
  });
}

export async function comparePngSnapshotFiles(
  actualPath: string,
  expectedPath: string,
  options: VexaPngSnapshotTolerance = {}
): Promise<VexaPngSnapshotComparison> {
  if (typeof actualPath !== "string" || actualPath.trim() === "") {
    throw invalidOptions("actualPath must be a non-empty string.");
  }
  if (typeof expectedPath !== "string" || expectedPath.trim() === "") {
    throw invalidOptions("expectedPath must be a non-empty string.");
  }
  const [actual, expected] = await Promise.all([readFile(actualPath), readFile(expectedPath)]);
  return comparePngSnapshots(actual, expected, options);
}

export function assertPngSnapshot(
  actualSnapshot: Uint8Array,
  expectedSnapshot: Uint8Array,
  options: VexaPngSnapshotTolerance = {}
): VexaPngSnapshotComparison {
  const comparison = comparePngSnapshots(actualSnapshot, expectedSnapshot, options);
  if (!comparison.matches) {
    const dimensionSummary = comparison.dimensionsMatch
      ? `${comparison.actualDimensions.width}x${comparison.actualDimensions.height}`
      : `${comparison.actualDimensions.width}x${comparison.actualDimensions.height} vs ${comparison.expectedDimensions.width}x${comparison.expectedDimensions.height}`;
    throw new VexaVisualTestError(
      `PNG snapshot mismatch (${dimensionSummary}): ${comparison.differentPixels}/${comparison.totalPixels} pixels differ (${comparison.differentPixelRatio.toFixed(6)}), max channel delta ${comparison.maxChannelDelta}.`,
      "VISUAL_SNAPSHOT_MISMATCH",
      { comparison }
    );
  }
  return comparison;
}

function normalizeCheckpoint(checkpoint: VexaVisualCheckpoint, index: number): VexaVisualCheckpoint {
  if (!checkpoint || typeof checkpoint !== "object") {
    throw invalidOptions(`checkpoints[${index}] must be an object.`);
  }
  if (
    typeof checkpoint.name !== "string" ||
    checkpoint.name !== checkpoint.name.trim() ||
    !CHECKPOINT_NAME_PATTERN.test(checkpoint.name)
  ) {
    throw invalidOptions(
      `checkpoints[${index}].name must match ${CHECKPOINT_NAME_PATTERN.source}.`
    );
  }
  if (!Number.isSafeInteger(checkpoint.frame) || checkpoint.frame < 0) {
    throw invalidOptions(`checkpoints[${index}].frame must be a non-negative safe integer.`);
  }
  return Object.freeze({ name: checkpoint.name, frame: checkpoint.frame });
}

export async function renderVisualCheckpoints(
  renderer: VexaVisualCheckpointRenderer,
  options: VexaVisualCheckpointRenderOptions
): Promise<readonly VexaRenderedVisualCheckpoint[]> {
  if (!renderer || typeof renderer.renderFrame !== "function") {
    throw invalidOptions("renderer must expose renderFrame().");
  }
  if (!options || typeof options !== "object") {
    throw invalidOptions("visual checkpoint render options are required.");
  }
  if (typeof options.outputDirectory !== "string" || options.outputDirectory.trim() === "") {
    throw invalidOptions("outputDirectory must be a non-empty string.");
  }
  if (!Array.isArray(options.checkpoints) || options.checkpoints.length === 0) {
    throw invalidOptions("checkpoints must contain at least one frame checkpoint.");
  }

  const checkpoints = options.checkpoints.map(normalizeCheckpoint);
  const names = new Set<string>();
  for (const checkpoint of checkpoints) {
    if (names.has(checkpoint.name)) {
      throw invalidOptions(`checkpoint name "${checkpoint.name}" is duplicated.`);
    }
    names.add(checkpoint.name);
  }

  const { outputDirectory, checkpoints: _ignored, ...frameOptions } = options;
  void _ignored;
  await mkdir(outputDirectory, { recursive: true });

  const results: VexaRenderedVisualCheckpoint[] = [];
  for (const checkpoint of checkpoints) {
    const output = join(outputDirectory, `${checkpoint.name}.png`);
    const render = await renderer.renderFrame({
      ...frameOptions,
      frame: checkpoint.frame,
      output,
      format: "png"
    });
    results.push(Object.freeze({
      name: checkpoint.name,
      frame: checkpoint.frame,
      output,
      render
    }));
  }

  return Object.freeze(results);
}

export interface VexaVisualBaselineOptions extends VexaPngSnapshotTolerance {
  readonly baselineDirectory: string;
}

export interface VexaVisualCheckpointBaselineComparison {
  readonly name: string;
  readonly frame: number;
  readonly actualPath: string;
  readonly expectedPath: string;
  readonly comparison: VexaPngSnapshotComparison;
}

export type VexaVisualCheckpointOutput = Pick<
  VexaRenderedVisualCheckpoint,
  "name" | "frame" | "output"
>;

function normalizeVisualCheckpointOutput(
  checkpoint: VexaVisualCheckpointOutput,
  index: number
): VexaVisualCheckpointOutput {
  if (!checkpoint || typeof checkpoint !== "object") {
    throw invalidOptions(`checkpoints[${index}] must be an object.`);
  }
  const normalized = normalizeCheckpoint(checkpoint, index);
  if (typeof checkpoint.output !== "string" || checkpoint.output.trim() === "") {
    throw invalidOptions(`checkpoints[${index}].output must be a non-empty string.`);
  }
  return Object.freeze({
    name: normalized.name,
    frame: normalized.frame,
    output: checkpoint.output
  });
}

export async function compareVisualCheckpointBaselines(
  checkpoints: readonly VexaVisualCheckpointOutput[],
  options: VexaVisualBaselineOptions
): Promise<readonly VexaVisualCheckpointBaselineComparison[]> {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw invalidOptions("checkpoints must contain at least one rendered visual checkpoint.");
  }
  if (!options || typeof options !== "object") {
    throw invalidOptions("visual baseline options are required.");
  }
  if (
    typeof options.baselineDirectory !== "string" ||
    options.baselineDirectory.trim() === ""
  ) {
    throw invalidOptions("baselineDirectory must be a non-empty string.");
  }

  const normalized = checkpoints.map(normalizeVisualCheckpointOutput);
  const names = new Set<string>();
  for (const checkpoint of normalized) {
    if (names.has(checkpoint.name)) {
      throw invalidOptions(`checkpoint name "${checkpoint.name}" is duplicated.`);
    }
    names.add(checkpoint.name);
  }

  const { baselineDirectory, ...tolerance } = options;
  const results: VexaVisualCheckpointBaselineComparison[] = [];
  for (const checkpoint of normalized) {
    const expectedPath = join(baselineDirectory, `${checkpoint.name}.png`);
    const comparison = await comparePngSnapshotFiles(
      checkpoint.output,
      expectedPath,
      tolerance
    );
    results.push(Object.freeze({
      name: checkpoint.name,
      frame: checkpoint.frame,
      actualPath: checkpoint.output,
      expectedPath,
      comparison
    }));
  }
  return Object.freeze(results);
}

export async function assertVisualCheckpointBaselines(
  checkpoints: readonly VexaVisualCheckpointOutput[],
  options: VexaVisualBaselineOptions
): Promise<readonly VexaVisualCheckpointBaselineComparison[]> {
  const comparisons = await compareVisualCheckpointBaselines(checkpoints, options);
  const mismatch = comparisons.find((entry) => !entry.comparison.matches);
  if (mismatch) {
    const comparison = mismatch.comparison;
    throw new VexaVisualTestError(
      `Visual checkpoint "${mismatch.name}" at frame ${mismatch.frame} does not match its baseline: ${comparison.differentPixels}/${comparison.totalPixels} pixels differ (${comparison.differentPixelRatio.toFixed(6)}), max channel delta ${comparison.maxChannelDelta}.`,
      "VISUAL_SNAPSHOT_MISMATCH",
      { comparison }
    );
  }
  return comparisons;
}

export * from "./runtime-parity.js";
export * from "./media-sync.js";

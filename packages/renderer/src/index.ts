import { mkdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { readBundleManifest } from "@vexa-video/bundler";
import type {
  VexaBundleManifest,
  VexaBundledCompositionDescriptor
} from "@vexa-video/bundler";
import {
  HardwareAccelerationUnavailableError,
  ProcessAbortedError,
  ProcessTimeoutError,
  collectProgrammableSceneAssets,
  evaluateExecutableComposition,
  getExecutableCompositionStaticMetadata,
  lowerProgrammableSceneToVideoProject,
  type ExecutableProgrammableComposition,
  type HardwareAccelerationPreference,
  type JsonObject,
  type MediaProgress,
  type MediaStorageSource,
  type ProgrammableScene,
  type ResolvedProgrammableCompositionMetadata,
  type StorageResolveOptions
} from "@vexa-video/core";
import {
  FfmpegProgressParser,
  createProjectFrameExecutionPlan,
  createProjectRangeExecutionPlan,
  detectHardwareAcceleration,
  resolveMediaBinaries,
  runProcess,
  type ProjectFrameExecutionPlan,
  type ProjectRangeExecutionPlan
} from "@vexa-video/ffmpeg";
import { Storage } from "@vexa-video/sdk";

export const VEXA_RENDER_PLAN_SCHEMA_VERSION = 1 as const;
export const VEXA_EXECUTABLE_COMPOSITIONS_EXPORT = "vexaExecutableCompositions" as const;

export type VexaRenderTarget = "still" | "frame" | "frame-range" | "video";
export type VexaImageFormat = "png" | "jpeg" | "webp";
export type VexaVideoFormat = "mp4" | "webm";

export type VexaRendererErrorCode =
  | "INVALID_RENDERER_OPTIONS"
  | "RENDER_COMPOSITION_NOT_FOUND"
  | "RENDER_KIND_MISMATCH"
  | "RENDER_FRAME_OUT_OF_RANGE"
  | "INVALID_RENDER_RANGE"
  | "INVALID_RENDER_OUTPUT"
  | "RENDER_EXECUTABLE_BUNDLE_REQUIRED"
  | "RENDER_EXECUTABLE_EXPORT_INVALID"
  | "RENDER_ABORTED"
  | "RENDER_TIMEOUT"
  | "RENDER_HARDWARE_UNAVAILABLE"
  | "RENDER_ASSET_RESOLUTION_FAILED"
  | "RENDER_EXECUTION_FAILED";

export class VexaRendererError extends Error {
  readonly code: VexaRendererErrorCode;
  readonly compositionId?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: VexaRendererErrorCode,
    options: { readonly compositionId?: string; readonly cause?: unknown } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.compositionId !== undefined) this.compositionId = options.compositionId;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface VexaRendererOptions {
  readonly concurrency?: number;
  readonly timeoutMs?: number;
}

export interface VexaRenderPlanOptions extends VexaRendererOptions {
  readonly compositionId: string;
  readonly output: string;
}

export interface VexaFrameRenderPlanOptions extends VexaRenderPlanOptions {
  readonly frame: number;
  readonly format?: VexaImageFormat;
}

export interface VexaStillRenderPlanOptions extends VexaRenderPlanOptions {
  readonly format?: VexaImageFormat;
}

export interface VexaFrameRangeRenderPlanOptions extends VexaRenderPlanOptions {
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly format?: VexaImageFormat;
}

export interface VexaVideoRenderPlanOptions extends VexaRenderPlanOptions {
  readonly startFrame?: number;
  readonly endFrameExclusive?: number;
  readonly format?: VexaVideoFormat;
}

export type VexaRenderProgressPhase = "starting" | "rendering" | "complete";

export interface VexaRenderProgress {
  readonly target: VexaRenderTarget;
  readonly phase: VexaRenderProgressPhase;
  readonly completedFrames: number;
  readonly totalFrames: number;
  readonly percent: number;
  readonly media?: MediaProgress;
}

export interface VexaRenderExecutionOptions {
  readonly inputProps?: JsonObject;
  readonly resolvedAssets?: Readonly<Record<string, string>>;
  readonly overwrite?: boolean;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: VexaRenderProgress) => void;
  readonly hardwareAcceleration?: HardwareAccelerationPreference;
  readonly hardwareFallback?: boolean;
  /** Storage implementation used to materialize programmable-scene storage assets. */
  readonly storage?: Storage;
  /** Per-render storage policy for managed asset acquisition. */
  readonly storageResolveOptions?: StorageResolveOptions;
}

export interface VexaStillRenderOptions
  extends VexaStillRenderPlanOptions,
    VexaRenderExecutionOptions {}

export interface VexaFrameRenderOptions
  extends VexaFrameRenderPlanOptions,
    VexaRenderExecutionOptions {}

export interface VexaFrameRangeRenderOptions
  extends VexaFrameRangeRenderPlanOptions,
    VexaRenderExecutionOptions {}

export interface VexaVideoRenderOptions
  extends VexaVideoRenderPlanOptions,
    VexaRenderExecutionOptions {}

export interface VexaRenderFrameRange {
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly frameCount: number;
}

export interface VexaRenderPlan {
  readonly schemaVersion: typeof VEXA_RENDER_PLAN_SCHEMA_VERSION;
  readonly target: VexaRenderTarget;
  readonly composition: VexaBundledCompositionDescriptor;
  readonly output: string;
  readonly format: VexaImageFormat | VexaVideoFormat;
  readonly frames: VexaRenderFrameRange;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

export interface VexaImageRenderResult {
  readonly target: "still" | "frame";
  readonly output: string;
  readonly frame: number;
  readonly metadata: ResolvedProgrammableCompositionMetadata;
  readonly plan: VexaRenderPlan;
  readonly executionPlan: ProjectFrameExecutionPlan;
}

export interface VexaFrameRangeOutput {
  readonly frame: number;
  readonly output: string;
  readonly executionPlan: ProjectFrameExecutionPlan;
}

export interface VexaFrameRangeRenderResult {
  readonly target: "frame-range";
  readonly outputDirectory: string;
  readonly metadata: ResolvedProgrammableCompositionMetadata;
  readonly plan: VexaRenderPlan;
  readonly frames: readonly VexaFrameRangeOutput[];
}

export interface VexaVideoRenderResult {
  readonly target: "video";
  readonly output: string;
  readonly metadata: ResolvedProgrammableCompositionMetadata;
  readonly plan: VexaRenderPlan;
  readonly executionPlan: ProjectRangeExecutionPlan;
}

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONCURRENCY = 64;

type AnyExecutableComposition = ExecutableProgrammableComposition<any>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertNonEmptyText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VexaRendererError(`${label} must be a non-empty string.`, "INVALID_RENDERER_OPTIONS");
  }
  return value.trim();
}

function normalizeConcurrency(value: number | undefined): number {
  const normalized = value ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_CONCURRENCY) {
    throw new VexaRendererError(
      `concurrency must be a safe integer between 1 and ${MAX_CONCURRENCY}.`,
      "INVALID_RENDERER_OPTIONS"
    );
  }
  return normalized;
}

function normalizeTimeoutMs(value: number | undefined): number {
  const normalized = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new VexaRendererError(
      "timeoutMs must be a positive safe integer.",
      "INVALID_RENDERER_OPTIONS"
    );
  }
  return normalized;
}

function normalizeFrame(frame: number, composition: VexaBundledCompositionDescriptor): number {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new VexaRendererError(
      "frame must be a non-negative safe integer.",
      "RENDER_FRAME_OUT_OF_RANGE",
      { compositionId: composition.id }
    );
  }
  const duration = composition.kind === "video" ? composition.durationInFrames ?? 0 : 1;
  if (frame >= duration) {
    throw new VexaRendererError(
      `frame ${frame} is outside composition "${composition.id}" (duration ${duration}).`,
      "RENDER_FRAME_OUT_OF_RANGE",
      { compositionId: composition.id }
    );
  }
  return frame;
}

function descriptorFromResolvedMetadata(
  metadata: ResolvedProgrammableCompositionMetadata
): VexaBundledCompositionDescriptor {
  if (metadata.kind === "still") {
    return Object.freeze({
      id: metadata.id,
      kind: "still",
      width: metadata.width,
      height: metadata.height
    });
  }
  return Object.freeze({
    id: metadata.id,
    kind: "video",
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    durationInFrames: metadata.durationInFrames
  });
}

function normalizeResolvedFrame(
  frame: number,
  metadata: ResolvedProgrammableCompositionMetadata
): number {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new VexaRendererError(
      "frame must be a non-negative safe integer.",
      "RENDER_FRAME_OUT_OF_RANGE",
      { compositionId: metadata.id }
    );
  }
  const duration = metadata.kind === "video" ? metadata.durationInFrames : 1;
  if (frame >= duration) {
    throw new VexaRendererError(
      `frame ${frame} is outside resolved composition "${metadata.id}" (duration ${duration}).`,
      "RENDER_FRAME_OUT_OF_RANGE",
      { compositionId: metadata.id }
    );
  }
  return frame;
}

function normalizeRange(
  startFrame: number,
  endFrameExclusive: number,
  composition: VexaBundledCompositionDescriptor
): VexaRenderFrameRange {
  if (composition.kind !== "video") {
    throw new VexaRendererError(
      `Composition "${composition.id}" is a still and cannot render a frame range.`,
      "RENDER_KIND_MISMATCH",
      { compositionId: composition.id }
    );
  }
  const duration = composition.durationInFrames ?? 0;
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrameExclusive) ||
    startFrame < 0 ||
    endFrameExclusive <= startFrame ||
    endFrameExclusive > duration
  ) {
    throw new VexaRendererError(
      `Frame range [${startFrame}, ${endFrameExclusive}) must stay inside composition "${composition.id}" duration ${duration}.`,
      "INVALID_RENDER_RANGE",
      { compositionId: composition.id }
    );
  }
  return Object.freeze({
    startFrame,
    endFrameExclusive,
    frameCount: endFrameExclusive - startFrame
  });
}

function normalizeOutput(
  value: string,
  target: VexaRenderTarget,
  format: VexaImageFormat | VexaVideoFormat
): string {
  const output = assertNonEmptyText(value, "output");
  if (target === "frame-range") return output;
  const lower = output.toLowerCase();
  const valid = format === "jpeg"
    ? lower.endsWith(".jpg") || lower.endsWith(".jpeg")
    : lower.endsWith(`.${format}`);
  if (!valid) {
    throw new VexaRendererError(
      `output must use a .${format === "jpeg" ? "jpg or .jpeg" : format} extension for ${target} renders.`,
      "INVALID_RENDER_OUTPUT"
    );
  }
  return output;
}

function makePlan(
  target: VexaRenderTarget,
  composition: VexaBundledCompositionDescriptor,
  output: string,
  format: VexaImageFormat | VexaVideoFormat,
  frames: VexaRenderFrameRange,
  defaults: Required<VexaRendererOptions>,
  overrides: VexaRendererOptions
): VexaRenderPlan {
  return Object.freeze({
    schemaVersion: VEXA_RENDER_PLAN_SCHEMA_VERSION,
    target,
    composition,
    output: normalizeOutput(output, target, format),
    format,
    frames,
    concurrency: normalizeConcurrency(overrides.concurrency ?? defaults.concurrency),
    timeoutMs: normalizeTimeoutMs(overrides.timeoutMs ?? defaults.timeoutMs)
  });
}

function assertPathInsideBundle(bundleRoot: string, target: string): string {
  const absolute = resolve(bundleRoot, target);
  const pathFromRoot = relative(bundleRoot, absolute);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new VexaRendererError(
      `Bundle entry must stay inside the bundle directory: ${target}.`,
      "RENDER_EXECUTABLE_EXPORT_INVALID"
    );
  }
  return absolute;
}

function imageExtension(format: VexaImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

interface VexaRenderAssetWorkspace {
  readonly resolvedAssets: Readonly<Record<string, string>>;
  cleanup(): Promise<void>;
}

function storageSourceExtension(source: MediaStorageSource): string {
  let candidate = "";
  if (source.kind === "local") {
    candidate = extname(source.path);
  } else if (source.kind === "http") {
    try {
      candidate = extname(new URL(source.url).pathname);
    } catch {
      candidate = "";
    }
  } else {
    candidate = extname(source.key);
  }
  return /^\.[a-zA-Z0-9]{1,12}$/u.test(candidate) ? candidate.toLowerCase() : "";
}

function renderAssetFileName(index: number, assetId: string, source: MediaStorageSource): string {
  const safeId = assetId.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 96) || `asset-${index}`;
  return join("assets", `${String(index).padStart(3, "0")}-${safeId}${storageSourceExtension(source)}`);
}

async function createRenderAssetWorkspace(
  scene: ProgrammableScene,
  compositionId: string,
  options: VexaRenderExecutionOptions,
  timeoutMs: number
): Promise<VexaRenderAssetWorkspace> {
  const callerResolvedAssets = options.resolvedAssets ?? {};
  const unresolvedStorageAssets = collectProgrammableSceneAssets(scene).filter((asset) =>
    asset.source.kind === "storage" &&
    !Object.prototype.hasOwnProperty.call(callerResolvedAssets, asset.id)
  );
  const resolvedAssets: Record<string, string> = { ...callerResolvedAssets };
  if (unresolvedStorageAssets.length === 0) {
    return Object.freeze({
      resolvedAssets: Object.freeze(resolvedAssets),
      async cleanup() {}
    });
  }

  const signal = options.signal ?? options.storageResolveOptions?.signal;
  if (signal?.aborted) throw new ProcessAbortedError();

  const storage = options.storage ?? new Storage();
  const workspace = await storage.createWorkspace({
    ...(options.storageResolveOptions?.workspaceRoot
      ? { root: options.storageResolveOptions.workspaceRoot }
      : {}),
    prefix: "vexa-render-"
  });

  try {
    for (let index = 0; index < unresolvedStorageAssets.length; index += 1) {
      if (signal?.aborted) throw new ProcessAbortedError();
      const asset = unresolvedStorageAssets[index]!;
      if (asset.source.kind !== "storage") continue;
      const target = workspace.file(renderAssetFileName(index, asset.id, asset.source.source));
      await storage.download(asset.source.source, target, {
        ...options.storageResolveOptions,
        overwrite: true,
        ...(signal ? { signal } : {}),
        timeoutMs: options.storageResolveOptions?.timeoutMs ?? timeoutMs
      });
      resolvedAssets[asset.id] = target;
    }
  } catch (cause) {
    await workspace.cleanup().catch(() => undefined);
    if (signal?.aborted || cause instanceof ProcessAbortedError) throw new ProcessAbortedError();
    throw new VexaRendererError(
      `Failed to resolve storage assets for composition "${compositionId}": ${cause instanceof Error ? cause.message : String(cause)}.`,
      "RENDER_ASSET_RESOLUTION_FAILED",
      { compositionId, cause }
    );
  }

  return Object.freeze({
    resolvedAssets: Object.freeze(resolvedAssets),
    cleanup: () => workspace.cleanup()
  });
}

async function withRenderAssetWorkspace<T>(
  scene: ProgrammableScene,
  compositionId: string,
  options: VexaRenderExecutionOptions,
  timeoutMs: number,
  callback: (resolvedAssets: Readonly<Record<string, string>>) => Promise<T>
): Promise<T> {
  const workspace = await createRenderAssetWorkspace(scene, compositionId, options, timeoutMs);
  try {
    const result = await callback(workspace.resolvedAssets);
    try {
      await workspace.cleanup();
    } catch (cause) {
      throw new VexaRendererError(
        `Failed to clean the managed render workspace for composition "${compositionId}".`,
        "RENDER_EXECUTION_FAILED",
        { compositionId, cause }
      );
    }
    return result;
  } catch (cause) {
    await workspace.cleanup().catch(() => undefined);
    throw cause;
  }
}

function emitRenderProgress(
  options: VexaRenderExecutionOptions,
  target: VexaRenderTarget,
  phase: VexaRenderProgressPhase,
  completedFrames: number,
  totalFrames: number,
  media?: MediaProgress
): void {
  if (!options.onProgress) return;
  const percent = phase === "complete"
    ? 100
    : media?.percent ?? (totalFrames > 0 ? (completedFrames / totalFrames) * 100 : 0);
  options.onProgress(Object.freeze({
    target,
    phase,
    completedFrames: Math.min(totalFrames, Math.max(0, completedFrames)),
    totalFrames,
    percent: Math.min(100, Math.max(0, percent)),
    ...(media ? { media } : {})
  }));
}

function withFfmpegProgressArgs(args: readonly string[]): readonly string[] {
  if (args.length === 0) return args;
  const output = args.at(-1)!;
  return Object.freeze([
    ...args.slice(0, -1),
    "-progress",
    "pipe:1",
    "-nostats",
    output
  ]);
}

function throwRendererExecutionError(
  target: VexaRenderTarget,
  compositionId: string,
  cause: unknown
): never {
  if (cause instanceof VexaRendererError) throw cause;
  if (cause instanceof ProcessAbortedError) {
    throw new VexaRendererError(
      `Rendering ${target} for composition "${compositionId}" was cancelled.`,
      "RENDER_ABORTED",
      { compositionId, cause }
    );
  }
  if (cause instanceof ProcessTimeoutError) {
    throw new VexaRendererError(
      `Rendering ${target} for composition "${compositionId}" exceeded its timeout.`,
      "RENDER_TIMEOUT",
      { compositionId, cause }
    );
  }
  if (cause instanceof HardwareAccelerationUnavailableError) {
    throw new VexaRendererError(
      `Requested hardware acceleration is unavailable for composition "${compositionId}": ${cause.message}`,
      "RENDER_HARDWARE_UNAVAILABLE",
      { compositionId, cause }
    );
  }
  throw new VexaRendererError(
    `Failed to render ${target} for composition "${compositionId}": ${cause instanceof Error ? cause.message : String(cause)}.`,
    "RENDER_EXECUTION_FAILED",
    { compositionId, cause }
  );
}

async function runBounded<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      await task(values[index]!, index);
    }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

function isExecutableComposition(value: unknown): value is AnyExecutableComposition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    readonly definition?: { readonly id?: unknown };
    readonly createScene?: unknown;
  };
  return Boolean(
    candidate.definition &&
    typeof candidate.definition.id === "string" &&
    candidate.definition.id.trim() !== "" &&
    typeof candidate.createScene === "function"
  );
}

export class VexaCompositionRenderer {
  readonly #manifest: VexaBundleManifest;
  readonly #defaults: Required<VexaRendererOptions>;
  readonly #compositions: readonly VexaBundledCompositionDescriptor[];
  #bundleRoot?: string;
  #executableCompositionsPromise?: Promise<readonly AnyExecutableComposition[]>;

  constructor(manifest: VexaBundleManifest, options: VexaRendererOptions = {}) {
    if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.compositions)) {
      throw new VexaRendererError(
        "A valid Vexa bundle manifest is required.",
        "INVALID_RENDERER_OPTIONS"
      );
    }
    this.#manifest = manifest;
    this.#defaults = Object.freeze({
      concurrency: normalizeConcurrency(options.concurrency),
      timeoutMs: normalizeTimeoutMs(options.timeoutMs)
    });
    this.#compositions = Object.freeze(
      manifest.compositions
        .map((item) => Object.freeze({ ...item }))
        .sort((left, right) => compareText(left.id, right.id))
    );
  }

  static async fromManifest(
    manifestPath: string,
    options: VexaRendererOptions = {}
  ): Promise<VexaCompositionRenderer> {
    const normalizedManifestPath = resolve(assertNonEmptyText(manifestPath, "manifestPath"));
    const manifest = await readBundleManifest(normalizedManifestPath);
    const renderer = new VexaCompositionRenderer(manifest, options);
    renderer.#bundleRoot = dirname(normalizedManifestPath);
    return renderer;
  }

  get manifest(): VexaBundleManifest {
    return this.#manifest;
  }

  listCompositions(): readonly VexaBundledCompositionDescriptor[] {
    return this.#compositions;
  }

  requireComposition(id: string): VexaBundledCompositionDescriptor {
    const normalizedId = assertNonEmptyText(id, "compositionId");
    const composition = this.#compositions.find((item) => item.id === normalizedId);
    if (!composition) {
      throw new VexaRendererError(
        `Composition was not found in the bundle: ${normalizedId}.`,
        "RENDER_COMPOSITION_NOT_FOUND",
        { compositionId: normalizedId }
      );
    }
    return composition;
  }

  planStill(options: VexaStillRenderPlanOptions): VexaRenderPlan {
    const composition = this.requireComposition(options.compositionId);
    if (composition.kind !== "still") {
      throw new VexaRendererError(
        `Composition "${composition.id}" is a video; use planFrame() or planVideo().`,
        "RENDER_KIND_MISMATCH",
        { compositionId: composition.id }
      );
    }
    return makePlan(
      "still",
      composition,
      options.output,
      options.format ?? "png",
      Object.freeze({ startFrame: 0, endFrameExclusive: 1, frameCount: 1 }),
      this.#defaults,
      options
    );
  }

  planFrame(options: VexaFrameRenderPlanOptions): VexaRenderPlan {
    const composition = this.requireComposition(options.compositionId);
    const frame = normalizeFrame(options.frame, composition);
    return makePlan(
      "frame",
      composition,
      options.output,
      options.format ?? "png",
      Object.freeze({ startFrame: frame, endFrameExclusive: frame + 1, frameCount: 1 }),
      this.#defaults,
      options
    );
  }

  planFrameRange(options: VexaFrameRangeRenderPlanOptions): VexaRenderPlan {
    const composition = this.requireComposition(options.compositionId);
    return makePlan(
      "frame-range",
      composition,
      options.output,
      options.format ?? "png",
      normalizeRange(options.startFrame, options.endFrameExclusive, composition),
      this.#defaults,
      options
    );
  }

  planVideo(options: VexaVideoRenderPlanOptions): VexaRenderPlan {
    const composition = this.requireComposition(options.compositionId);
    if (composition.kind !== "video") {
      throw new VexaRendererError(
        `Composition "${composition.id}" is a still and cannot render video.`,
        "RENDER_KIND_MISMATCH",
        { compositionId: composition.id }
      );
    }
    const duration = composition.durationInFrames ?? 0;
    const startFrame = options.startFrame ?? 0;
    const endFrameExclusive = options.endFrameExclusive ?? duration;
    return makePlan(
      "video",
      composition,
      options.output,
      options.format ?? "mp4",
      normalizeRange(startFrame, endFrameExclusive, composition),
      this.#defaults,
      options
    );
  }

  async renderStill(options: VexaStillRenderOptions): Promise<VexaImageRenderResult> {
    const composition = this.requireComposition(options.compositionId);
    if (composition.kind !== "still") {
      throw new VexaRendererError(
        `Composition "${composition.id}" is a video; use renderFrame() for a single video frame.`,
        "RENDER_KIND_MISMATCH",
        { compositionId: composition.id }
      );
    }
    return await this.#renderImage("still", composition, 0, options);
  }

  async renderFrame(options: VexaFrameRenderOptions): Promise<VexaImageRenderResult> {
    const composition = this.requireComposition(options.compositionId);
    const evaluated = await this.#evaluateComposition(composition.id, options.inputProps);
    const frame = normalizeResolvedFrame(options.frame, evaluated.resolved.metadata);
    return await this.#renderEvaluatedImage("frame", composition, frame, options, evaluated);
  }

  async renderFrameRange(
    options: VexaFrameRangeRenderOptions
  ): Promise<VexaFrameRangeRenderResult> {
    const composition = this.requireComposition(options.compositionId);
    if (composition.kind !== "video") {
      throw new VexaRendererError(
        `Composition "${composition.id}" is a still and cannot render a frame range.`,
        "RENDER_KIND_MISMATCH",
        { compositionId: composition.id }
      );
    }

    const evaluated = await this.#evaluateComposition(composition.id, options.inputProps);
    const metadata = evaluated.resolved.metadata;
    if (metadata.kind !== "video") {
      throw new VexaRendererError(
        `Executable composition "${composition.id}" resolved as a still, but the bundle manifest declares video.`,
        "RENDER_EXECUTABLE_EXPORT_INVALID",
        { compositionId: composition.id }
      );
    }

    const resolvedComposition = descriptorFromResolvedMetadata(metadata);
    const range = normalizeRange(
      options.startFrame,
      options.endFrameExclusive,
      resolvedComposition
    );
    const format = options.format ?? "png";
    const plan = makePlan(
      "frame-range",
      resolvedComposition,
      options.output,
      format,
      range,
      this.#defaults,
      options
    );

    emitRenderProgress(options, "frame-range", "starting", 0, range.frameCount);

    try {
      return await withRenderAssetWorkspace(
        evaluated.scene,
        composition.id,
        options,
        plan.timeoutMs,
        async (resolvedAssets) => {
          const project = lowerProgrammableSceneToVideoProject(evaluated.scene, { resolvedAssets });
          const outputDirectory = resolve(plan.output);
          await mkdir(outputDirectory, { recursive: true });
          const binaries = await resolveMediaBinaries({
            ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
            ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {})
          });
          const digits = Math.max(6, String(metadata.durationInFrames - 1).length);
          const frames = Array.from(
            { length: range.frameCount },
            (_, index) => range.startFrame + index
          );
          const outputs: VexaFrameRangeOutput[] = new Array(frames.length);
          let completedFrames = 0;

          await runBounded(frames, plan.concurrency, async (frame, index) => {
            const output = join(
              outputDirectory,
              `frame-${String(frame).padStart(digits, "0")}.${imageExtension(format)}`
            );
            const executionPlan = createProjectFrameExecutionPlan(project, output, frame, {
              ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {})
            });
            await runProcess(binaries.ffmpeg, executionPlan.args, {
              ...(options.signal ? { signal: options.signal } : {}),
              timeoutMs: plan.timeoutMs
            });
            outputs[index] = Object.freeze({ frame, output, executionPlan });
            completedFrames += 1;
            emitRenderProgress(
              options,
              "frame-range",
              completedFrames === range.frameCount ? "complete" : "rendering",
              completedFrames,
              range.frameCount
            );
          });

          return Object.freeze({
            target: "frame-range" as const,
            outputDirectory,
            metadata,
            plan,
            frames: Object.freeze(outputs)
          });
        }
      );
    } catch (cause) {
      throwRendererExecutionError("frame-range", composition.id, cause);
    }
  }

  async renderVideo(options: VexaVideoRenderOptions): Promise<VexaVideoRenderResult> {
    const composition = this.requireComposition(options.compositionId);
    if (composition.kind !== "video") {
      throw new VexaRendererError(
        `Composition "${composition.id}" is a still and cannot render video.`,
        "RENDER_KIND_MISMATCH",
        { compositionId: composition.id }
      );
    }

    const evaluated = await this.#evaluateComposition(composition.id, options.inputProps);
    const metadata = evaluated.resolved.metadata;
    if (metadata.kind !== "video") {
      throw new VexaRendererError(
        `Executable composition "${composition.id}" resolved as a still, but the bundle manifest declares video.`,
        "RENDER_EXECUTABLE_EXPORT_INVALID",
        { compositionId: composition.id }
      );
    }

    const resolvedComposition = descriptorFromResolvedMetadata(metadata);
    const startFrame = options.startFrame ?? 0;
    const endFrameExclusive = options.endFrameExclusive ?? metadata.durationInFrames;
    const range = normalizeRange(startFrame, endFrameExclusive, resolvedComposition);
    const plan = makePlan(
      "video",
      resolvedComposition,
      options.output,
      options.format ?? "mp4",
      range,
      this.#defaults,
      options
    );

    emitRenderProgress(options, "video", "starting", 0, range.frameCount);

    try {
      return await withRenderAssetWorkspace(
        evaluated.scene,
        composition.id,
        options,
        plan.timeoutMs,
        async (resolvedAssets) => {
          const project = lowerProgrammableSceneToVideoProject(evaluated.scene, { resolvedAssets });

          await mkdir(dirname(resolve(plan.output)), { recursive: true });
          const binaries = await resolveMediaBinaries({
            ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
            ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {})
          });
          const hardwareCapabilities =
            options.hardwareAcceleration && options.hardwareAcceleration !== "cpu"
              ? await detectHardwareAcceleration(binaries.ffmpeg, {
                  ...(options.signal ? { signal: options.signal } : {}),
                  timeoutMs: plan.timeoutMs
                })
              : null;
          const executionPlan = createProjectRangeExecutionPlan(
            project,
            plan.output,
            range.startFrame,
            range.endFrameExclusive,
            {
              ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
              ...(options.hardwareAcceleration
                ? { hardwareAcceleration: options.hardwareAcceleration }
                : {}),
              ...(options.hardwareFallback !== undefined
                ? { hardwareFallback: options.hardwareFallback }
                : {})
            },
            {},
            hardwareCapabilities
          );

          const progressParser = new FfmpegProgressParser(executionPlan.durationSeconds);
          let emittedComplete = false;
          await runProcess(binaries.ffmpeg, withFfmpegProgressArgs(executionPlan.args), {
            ...(options.signal ? { signal: options.signal } : {}),
            timeoutMs: plan.timeoutMs,
            onStdoutChunk(chunk) {
              progressParser.push(chunk, (media) => {
                const completedFrames = media.status === "end"
                  ? range.frameCount
                  : Math.round(((media.percent ?? 0) / 100) * range.frameCount);
                const phase = media.status === "end" ? "complete" : "rendering";
                if (phase === "complete") emittedComplete = true;
                emitRenderProgress(
                  options,
                  "video",
                  phase,
                  completedFrames,
                  range.frameCount,
                  media
                );
              });
            }
          });
          if (!emittedComplete) {
            emitRenderProgress(options, "video", "complete", range.frameCount, range.frameCount);
          }

          return Object.freeze({
            target: "video" as const,
            output: plan.output,
            metadata,
            plan,
            executionPlan
          });
        }
      );
    } catch (cause) {
      throwRendererExecutionError("video", composition.id, cause);
    }
  }

  async #renderImage(
    target: "still" | "frame",
    composition: VexaBundledCompositionDescriptor,
    frame: number,
    options: VexaStillRenderOptions | VexaFrameRenderOptions
  ): Promise<VexaImageRenderResult> {
    const evaluated = await this.#evaluateComposition(composition.id, options.inputProps);
    const resolvedFrame = normalizeResolvedFrame(frame, evaluated.resolved.metadata);
    return await this.#renderEvaluatedImage(
      target,
      composition,
      resolvedFrame,
      options,
      evaluated
    );
  }

  async #renderEvaluatedImage(
    target: "still" | "frame",
    composition: VexaBundledCompositionDescriptor,
    frame: number,
    options: VexaStillRenderOptions | VexaFrameRenderOptions,
    evaluated: Awaited<ReturnType<typeof evaluateExecutableComposition>>
  ): Promise<VexaImageRenderResult> {
    if (evaluated.resolved.metadata.kind !== composition.kind) {
      throw new VexaRendererError(
        `Executable composition "${composition.id}" resolved as ${evaluated.resolved.metadata.kind}, but the bundle manifest declares ${composition.kind}.`,
        "RENDER_EXECUTABLE_EXPORT_INVALID",
        { compositionId: composition.id }
      );
    }

    const format = options.format ?? "png";
    const resolvedComposition = descriptorFromResolvedMetadata(evaluated.resolved.metadata);
    const plan = makePlan(
      target,
      resolvedComposition,
      options.output,
      format,
      Object.freeze({ startFrame: frame, endFrameExclusive: frame + 1, frameCount: 1 }),
      this.#defaults,
      options
    );

    emitRenderProgress(options, target, "starting", 0, 1);

    try {
      return await withRenderAssetWorkspace(
        evaluated.scene,
        composition.id,
        options,
        plan.timeoutMs,
        async (resolvedAssets) => {
          const project = lowerProgrammableSceneToVideoProject(evaluated.scene, { resolvedAssets });
          const executionPlan = createProjectFrameExecutionPlan(project, plan.output, frame, {
            ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {})
          });

          await mkdir(dirname(resolve(plan.output)), { recursive: true });
          const binaries = await resolveMediaBinaries({
            ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
            ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {})
          });
          await runProcess(binaries.ffmpeg, executionPlan.args, {
            ...(options.signal ? { signal: options.signal } : {}),
            timeoutMs: plan.timeoutMs
          });
          emitRenderProgress(options, target, "complete", 1, 1);

          return Object.freeze({
            target,
            output: plan.output,
            frame,
            metadata: evaluated.resolved.metadata,
            plan,
            executionPlan
          });
        }
      );
    } catch (cause) {
      throwRendererExecutionError(target, composition.id, cause);
    }
  }

  async #evaluateComposition(
    compositionId: string,
    inputProps: JsonObject | undefined
  ): Promise<Awaited<ReturnType<typeof evaluateExecutableComposition>>> {
    const executable = await this.#requireExecutableComposition(compositionId);
    try {
      return await evaluateExecutableComposition(
        executable,
        inputProps as Partial<JsonObject> | undefined
      );
    } catch (cause) {
      throw new VexaRendererError(
        `Failed to evaluate executable composition "${compositionId}": ${cause instanceof Error ? cause.message : String(cause)}.`,
        "RENDER_EXECUTION_FAILED",
        { compositionId, cause }
      );
    }
  }

  async #requireExecutableComposition(compositionId: string): Promise<AnyExecutableComposition> {
    const compositions = await this.#loadExecutableCompositions();
    const executable = compositions.find((entry) => entry.definition.id === compositionId);
    if (!executable) {
      throw new VexaRendererError(
        `Bundle executable export does not contain composition "${compositionId}".`,
        "RENDER_EXECUTABLE_EXPORT_INVALID",
        { compositionId }
      );
    }

    try {
      const manifestComposition = this.requireComposition(compositionId);
      const staticMetadata = getExecutableCompositionStaticMetadata(executable);
      const timingMatches = manifestComposition.kind === "still" ||
        (staticMetadata.kind === "video" &&
          manifestComposition.fps === staticMetadata.fps &&
          manifestComposition.durationInFrames === staticMetadata.durationInFrames);
      if (
        manifestComposition.kind !== staticMetadata.kind ||
        manifestComposition.width !== staticMetadata.width ||
        manifestComposition.height !== staticMetadata.height ||
        !timingMatches
      ) {
        throw new VexaRendererError(
          `Executable composition "${compositionId}" does not match the bundle manifest metadata.`,
          "RENDER_EXECUTABLE_EXPORT_INVALID",
          { compositionId }
        );
      }
    } catch (cause) {
      if (cause instanceof VexaRendererError) throw cause;
      throw new VexaRendererError(
        `Executable composition "${compositionId}" metadata is invalid: ${cause instanceof Error ? cause.message : String(cause)}.`,
        "RENDER_EXECUTABLE_EXPORT_INVALID",
        { compositionId, cause }
      );
    }
    return executable;
  }

  async #loadExecutableCompositions(): Promise<readonly AnyExecutableComposition[]> {
    if (!this.#bundleRoot) {
      throw new VexaRendererError(
        "Executable rendering requires VexaCompositionRenderer.fromManifest() so the browser bundle location is known.",
        "RENDER_EXECUTABLE_BUNDLE_REQUIRED"
      );
    }
    this.#executableCompositionsPromise ??= this.#importExecutableCompositions(this.#bundleRoot);
    return await this.#executableCompositionsPromise;
  }

  async #importExecutableCompositions(
    bundleRoot: string
  ): Promise<readonly AnyExecutableComposition[]> {
    const browserEntry = assertNonEmptyText(this.#manifest.browserEntry, "manifest.browserEntry");
    const entryPath = assertPathInsideBundle(bundleRoot, browserEntry);

    let moduleNamespace: Record<string, unknown>;
    try {
      moduleNamespace = await import(pathToFileURL(entryPath).href) as Record<string, unknown>;
    } catch (cause) {
      throw new VexaRendererError(
        `Failed to load executable browser bundle "${browserEntry}": ${cause instanceof Error ? cause.message : String(cause)}.`,
        "RENDER_EXECUTION_FAILED",
        { cause }
      );
    }

    const exported = moduleNamespace[VEXA_EXECUTABLE_COMPOSITIONS_EXPORT];
    if (!Array.isArray(exported) || !exported.every(isExecutableComposition)) {
      throw new VexaRendererError(
        `Browser bundle must export a ${VEXA_EXECUTABLE_COMPOSITIONS_EXPORT} array of executable compositions.`,
        "RENDER_EXECUTABLE_EXPORT_INVALID"
      );
    }

    const seen = new Set<string>();
    for (const entry of exported) {
      if (seen.has(entry.definition.id)) {
        throw new VexaRendererError(
          `Executable composition id "${entry.definition.id}" is duplicated in the browser bundle.`,
          "RENDER_EXECUTABLE_EXPORT_INVALID",
          { compositionId: entry.definition.id }
        );
      }
      seen.add(entry.definition.id);
    }

    return Object.freeze([...exported].sort((left, right) =>
      compareText(left.definition.id, right.definition.id)
    ));
  }
}

export function createCompositionRenderer(
  manifest: VexaBundleManifest,
  options: VexaRendererOptions = {}
): VexaCompositionRenderer {
  return new VexaCompositionRenderer(manifest, options);
}

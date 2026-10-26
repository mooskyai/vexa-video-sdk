import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  fingerprintHostedCompositionPublication,
  type HostedCompositionPublicationReceipt
} from "./publication-recovery.js";
export type { HostedCompositionPublicationReceipt } from "./publication-recovery.js";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { readBundleManifest } from "@vexa-video/bundler";
import type {
  VexaBundleManifest,
  VexaBundledCompositionDescriptor
} from "@vexa-video/bundler";
import {
  HOSTED_COMPOSITION_RENDER_TYPE,
  HardwareAccelerationUnavailableError,
  JobCancelledError,
  ProgrammableCompositionError,
  ProcessAbortedError,
  ProcessTimeoutError,
  collectProgrammableSceneAssets,
  createHostedCompositionRenderRequest,
  createProgrammableSceneRenderGraph,
  defineProgrammableScene,
  evaluateExecutableComposition,
  getExecutableCompositionStaticMetadata,
  lowerProgrammableSceneToVideoProject,
  programmableShapeToSvgPath,
  resolveProgrammableComposition,
  type ExecutableProgrammableComposition,
  type HardwareAccelerationPreference,
  type HostedCompositionBundleReference,
  type HostedCompositionOutputReference,
  type HostedCompositionRenderPayload,
  type HostedCompositionRenderTarget,
  type HostedRenderArtifact,
  type JsonObject,
  type MediaProgress,
  type MediaStorageSource,
  type ProgrammableCompositionStaticMetadata,
  type ProgrammableScene,
  type ProgrammableSceneAsset,
  type ProgrammableSceneFillNode,
  type ProgrammableSceneNode,
  type ProgrammableSceneRenderItem,
  type ProgrammableSceneShapeNode,
  type ProgrammableSceneSolidNode,
  type ProgrammableSceneSurfaceDescriptor,
  type ProgrammableSceneSurfaceNode,
  type ProgrammableSceneTransform,
  type ProgrammableShape,
  type ProgrammableShapeStyle,
  type RemoteFontReference,
  type ResolvedProgrammableComposition,
  type ResolvedProgrammableCompositionMetadata,
  type StorageResolveOptions,
  type StorageTransferOptions,
  type VideoProjectAst
} from "@vexa-video/core";
import {
  FfmpegProgressParser,
  ProjectFontResolutionError,
  createProjectFrameExecutionPlan,
  createProjectRangeExecutionPlan,
  detectHardwareAcceleration,
  resolveMediaBinaries,
  resolveProjectFontFiles,
  runProcess,
  type ProjectFrameExecutionPlan,
  type ProjectRangeExecutionPlan
} from "@vexa-video/ffmpeg";
import { Storage, type JobHandler, type JobHandlerContext, type JobHandlerOptions } from "@vexa-video/sdk";

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
  | "RENDER_INPUT_PROPS_INVALID"
  | "RENDER_COMPOSITION_METADATA_FAILED"
  | "RENDER_ABORTED"
  | "RENDER_TIMEOUT"
  | "RENDER_HARDWARE_UNAVAILABLE"
  | "RENDER_ASSET_RESOLUTION_FAILED"
  | "RENDER_FONT_UNAVAILABLE"
  | "RENDER_SHAPE_UNSUPPORTED"
  | "RENDER_PRIMITIVE_UNSUPPORTED"
  | "RENDER_SURFACE_UNAVAILABLE"
  | "RENDER_SURFACE_UNSUPPORTED"
  | "RENDER_SURFACE_FAILED"
  | "RENDER_ARTIFACT_PUBLISH_FAILED"
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

export interface VexaRemoteFontAdapterContext {
  readonly compositionId: string;
  readonly clipId: string;
  readonly signal?: AbortSignal;
}

export interface VexaRemoteFontAdapter {
  readonly provider: string;
  /**
   * Resolve/cache a remote font reference and return an absolute local font path.
   * The adapter owns acquisition/caching and must keep the file readable for the render.
   */
  resolveFont(
    reference: RemoteFontReference,
    context: VexaRemoteFontAdapterContext
  ): Promise<string> | string;
}

export interface VexaSurfaceRendererAdapterContext {
  readonly compositionId: string;
  readonly nodeId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly absoluteStartFrame: number;
  readonly durationInFrames: number;
  readonly signal?: AbortSignal;
}

export interface VexaSurfaceFrameRendererAdapterContext
  extends VexaSurfaceRendererAdapterContext {
  /** Zero-based frame relative to the authored surface start. */
  readonly localFrame: number;
  /** Composition frame represented by localFrame. */
  readonly absoluteFrame: number;
  /** Deterministic 0..1 progress across the authored surface duration. */
  readonly progress: number;
}

export interface VexaSurfaceSvgRenderResult {
  readonly kind: "svg";
  readonly svg: string;
}

export interface VexaSurfacePngRenderResult {
  readonly kind: "png";
  readonly png: Uint8Array;
}

export type VexaSurfaceRenderResult =
  | VexaSurfaceSvgRenderResult
  | VexaSurfacePngRenderResult;

export interface VexaSurfaceRendererAdapter {
  readonly rendererId: string;
  /**
   * Materialize one static surface result. An adapter must expose exactly one of
   * renderSurface() or renderFrame().
   */
  renderSurface?(
    surface: ProgrammableSceneSurfaceDescriptor,
    context: VexaSurfaceRendererAdapterContext
  ): Promise<VexaSurfaceRenderResult> | VexaSurfaceRenderResult;
  /**
   * Materialize one local animation frame. Vexa calls this for the complete
   * authored surface duration and owns the generated frame/video files.
   */
  renderFrame?(
    surface: ProgrammableSceneSurfaceDescriptor,
    context: VexaSurfaceFrameRendererAdapterContext
  ): Promise<VexaSurfaceRenderResult> | VexaSurfaceRenderResult;
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
  /** Optional provider adapters used to materialize serializable remoteFont references. */
  readonly fontAdapters?: readonly VexaRemoteFontAdapter[];
  /** Optional renderer adapters used to materialize serializable surface nodes. */
  readonly surfaceAdapters?: readonly VexaSurfaceRendererAdapter[];
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
  readonly scene: ProgrammableScene;
  readonly resolvedAssets: Readonly<Record<string, string>>;
  cleanup(): Promise<void>;
}

type ProgrammableShapeRenderItem = ProgrammableSceneRenderItem & {
  readonly node: ProgrammableSceneShapeNode;
};

type ProgrammablePrimitiveRenderItem = ProgrammableSceneRenderItem & {
  readonly node: ProgrammableSceneFillNode | ProgrammableSceneSolidNode;
};

type ProgrammableSurfaceRenderItem = ProgrammableSceneRenderItem & {
  readonly node: ProgrammableSceneSurfaceNode;
};

function collectShapeRenderItems(scene: ProgrammableScene): readonly ProgrammableShapeRenderItem[] {
  const items = createProgrammableSceneRenderGraph(scene).items.filter(
    (item): item is ProgrammableShapeRenderItem => item.node.kind === "shape"
  );
  items.sort((left, right) => left.declarationOrder - right.declarationOrder);
  return Object.freeze(items);
}

function collectPrimitiveRenderItems(scene: ProgrammableScene): readonly ProgrammablePrimitiveRenderItem[] {
  const items = createProgrammableSceneRenderGraph(scene).items.filter(
    (item): item is ProgrammablePrimitiveRenderItem =>
      item.node.kind === "solid" ||
      (
        item.node.kind === "fill" &&
        Boolean(item.node.effects?.length || item.node.transitions !== undefined)
      )
  );
  items.sort((left, right) => left.declarationOrder - right.declarationOrder);
  return Object.freeze(items);
}

function collectSurfaceRenderItems(scene: ProgrammableScene): readonly ProgrammableSurfaceRenderItem[] {
  const items = createProgrammableSceneRenderGraph(scene).items.filter(
    (item): item is ProgrammableSurfaceRenderItem => item.node.kind === "surface"
  );
  items.sort((left, right) => left.declarationOrder - right.declarationOrder);
  return Object.freeze(items);
}

function normalizeSurfaceAdapters(
  adapters: readonly VexaSurfaceRendererAdapter[] | undefined
): ReadonlyMap<string, VexaSurfaceRendererAdapter> {
  const byRendererId = new Map<string, VexaSurfaceRendererAdapter>();
  for (const adapter of adapters ?? []) {
    if (!adapter || typeof adapter.rendererId !== "string" || !adapter.rendererId.trim()) {
      throw new VexaRendererError(
        "Every surface renderer adapter requires a non-empty rendererId.",
        "INVALID_RENDERER_OPTIONS"
      );
    }
    const hasStaticRenderer = typeof adapter.renderSurface === "function";
    const hasFrameRenderer = typeof adapter.renderFrame === "function";
    if (hasStaticRenderer === hasFrameRenderer) {
      throw new VexaRendererError(
        `Surface renderer adapter "${adapter.rendererId.trim()}" requires exactly one of renderSurface() or renderFrame().`,
        "INVALID_RENDERER_OPTIONS"
      );
    }
    const rendererId = adapter.rendererId.trim();
    if (byRendererId.has(rendererId)) {
      throw new VexaRendererError(
        `Surface renderer adapter rendererId "${rendererId}" is duplicated.`,
        "INVALID_RENDERER_OPTIONS"
      );
    }
    byRendererId.set(rendererId, adapter);
  }
  return byRendererId;
}

function assertShapeTransformSupported(item: ProgrammableShapeRenderItem): void {
  const unsupported = new Set<string>();
  const check = (transform: ProgrammableSceneTransform): void => {
    if (transform.width !== undefined) unsupported.add("width");
    if (transform.height !== undefined) unsupported.add("height");
    if (transform.rotation !== undefined) unsupported.add("rotation");
    if (transform.scaleX !== undefined) unsupported.add("scaleX");
    if (transform.scaleY !== undefined) unsupported.add("scaleY");
    if (transform.anchorX !== undefined) unsupported.add("anchorX");
    if (transform.anchorY !== undefined) unsupported.add("anchorY");
  };
  for (const transform of item.transformChain) check(transform);
  if (unsupported.size === 0) return;
  throw new VexaRendererError(
    `Shape node "${item.node.id}" currently supports translation-only scene transforms; unsupported transform fields: ${[...unsupported].sort(compareText).join(", ")}.`,
    "RENDER_SHAPE_UNSUPPORTED"
  );
}

function assertPrimitiveTransformSupported(item: ProgrammablePrimitiveRenderItem): void {
  const unsupported = new Set<string>();
  const check = (transform: ProgrammableSceneTransform): void => {
    if (transform.width !== undefined) unsupported.add("width");
    if (transform.height !== undefined) unsupported.add("height");
    if (transform.rotation !== undefined) unsupported.add("rotation");
    if (transform.scaleX !== undefined) unsupported.add("scaleX");
    if (transform.scaleY !== undefined) unsupported.add("scaleY");
    if (transform.anchorX !== undefined) unsupported.add("anchorX");
    if (transform.anchorY !== undefined) unsupported.add("anchorY");
  };
  for (const transform of item.transformChain) check(transform);
  if (unsupported.size === 0) return;
  throw new VexaRendererError(
    `${item.node.kind === "fill" ? "Fill" : "Solid"} node "${item.node.id}" currently supports translation-only scene transforms; unsupported transform fields: ${[...unsupported].sort(compareText).join(", ")}.`,
    "RENDER_PRIMITIVE_UNSUPPORTED"
  );
}

function assertSurfaceTransformSupported(item: ProgrammableSurfaceRenderItem): void {
  const unsupported = new Set<string>();
  const check = (transform: ProgrammableSceneTransform): void => {
    if (transform.width !== undefined) unsupported.add("width");
    if (transform.height !== undefined) unsupported.add("height");
    if (transform.rotation !== undefined) unsupported.add("rotation");
    if (transform.scaleX !== undefined) unsupported.add("scaleX");
    if (transform.scaleY !== undefined) unsupported.add("scaleY");
    if (transform.anchorX !== undefined) unsupported.add("anchorX");
    if (transform.anchorY !== undefined) unsupported.add("anchorY");
  };
  for (const transform of item.transformChain) check(transform);
  if (unsupported.size === 0) return;
  throw new VexaRendererError(
    `Surface node "${item.node.id}" currently supports translation-only scene transforms; unsupported transform fields: ${[...unsupported].sort(compareText).join(", ")}.`,
    "RENDER_SURFACE_UNSUPPORTED"
  );
}

function formatShapeNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.isInteger(normalized)
    ? String(normalized)
    : String(Number(normalized.toFixed(6)));
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeShapePaint(value: string, label: string): string {
  if (/url\s*\(/iu.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new VexaRendererError(
      `${label} contains a paint value that is not supported by the renderer-owned SVG path.`,
      "RENDER_SHAPE_UNSUPPORTED"
    );
  }
  return escapeXmlAttribute(value);
}

function safePrimitivePaint(value: string, label: string): string {
  if (/url\s*\(/iu.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new VexaRendererError(
      `${label} contains a paint value that is not supported by the renderer-owned SVG primitive path.`,
      "RENDER_PRIMITIVE_UNSUPPORTED"
    );
  }
  return escapeXmlAttribute(value);
}

function primitiveSvgDocument(
  node: ProgrammableSceneFillNode | ProgrammableSceneSolidNode,
  width: number,
  height: number
): string {
  const primitiveWidth = node.kind === "fill" ? width : node.width;
  const primitiveHeight = node.kind === "fill" ? height : node.height;
  const fill = safePrimitivePaint(node.color, `${node.kind} ${node.id} color`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect x="0" y="0" width="${formatShapeNumber(primitiveWidth)}" height="${formatShapeNumber(primitiveHeight)}" fill="${fill}" />`,
    "</svg>",
    ""
  ].join("\n");
}

function shapeSvgDocument(shape: ProgrammableShape, width: number, height: number): string {
  const style: ProgrammableShapeStyle | undefined = shape.style;
  const isOpenGeometry = shape.geometry.kind === "line" || shape.geometry.kind === "arc";
  const fill = style?.fill ?? (style === undefined && !isOpenGeometry ? "#000000" : "none");
  const defaultStroke: ProgrammableShapeStyle["stroke"] = style === undefined && isOpenGeometry
    ? Object.freeze({
        color: "#000000",
        width: 1,
        lineCap: "butt" as const,
        lineJoin: "miter" as const
      })
    : undefined;
  const stroke = style?.stroke ?? defaultStroke;
  const attributes = [
    `d="${escapeXmlAttribute(programmableShapeToSvgPath(shape))}"`,
    `fill="${safeShapePaint(fill, "shape fill")}"`,
    `fill-rule="${style?.fillRule ?? "nonzero"}"`
  ];

  if (stroke) {
    attributes.push(
      `stroke="${safeShapePaint(stroke.color, "shape stroke")}"`,
      `stroke-width="${formatShapeNumber(stroke.width)}"`,
      `stroke-linecap="${stroke.lineCap ?? "butt"}"`,
      `stroke-linejoin="${stroke.lineJoin ?? "miter"}"`
    );
    if (stroke.dash?.length) {
      attributes.push(`stroke-dasharray="${stroke.dash.map(formatShapeNumber).join(" ")}"`);
    }
  } else {
    attributes.push('stroke="none"');
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <path ${attributes.join(" ")} />`,
    "</svg>",
    ""
  ].join("\n");
}

function renderShapeFileName(index: number, nodeId: string): string {
  const safeId = nodeId.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 96) || `shape-${index}`;
  return join("shapes", `${String(index).padStart(3, "0")}-${safeId}.png`);
}

function allocateShapeAssetId(index: number, usedAssetIds: Set<string>): string {
  let candidate = `__vexa_renderer_shape_${String(index).padStart(4, "0")}`;
  while (usedAssetIds.has(candidate)) candidate = `_${candidate}`;
  usedAssetIds.add(candidate);
  return candidate;
}

function replaceShapeNodes(
  nodes: readonly ProgrammableSceneNode[],
  shapeAssetIds: ReadonlyMap<string, string>
): readonly ProgrammableSceneNode[] {
  return Object.freeze(nodes.map((node) => {
    if (node.kind === "group" || node.kind === "layer") {
      return Object.freeze({
        ...node,
        children: replaceShapeNodes(node.children, shapeAssetIds)
      });
    }
    if (node.kind !== "shape") return node;

    const assetId = shapeAssetIds.get(node.id);
    if (!assetId) {
      throw new VexaRendererError(
        `Renderer shape asset was not materialized for node "${node.id}".`,
        "RENDER_EXECUTION_FAILED"
      );
    }
    return Object.freeze({
      kind: "image",
      id: node.id,
      ...(node.startFrame !== undefined ? { startFrame: node.startFrame } : {}),
      ...(node.durationInFrames !== undefined ? { durationInFrames: node.durationInFrames } : {}),
      ...(node.zIndex !== undefined ? { zIndex: node.zIndex } : {}),
      ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
      ...(node.transform !== undefined ? { transform: node.transform } : {}),
      ...(node.effects !== undefined ? { effects: node.effects } : {}),
      ...(node.transitions !== undefined ? { transitions: node.transitions } : {}),
      assetId
    });
  }));
}

async function materializeProgrammableSceneShapes(
  scene: ProgrammableScene,
  items: readonly ProgrammableShapeRenderItem[],
  fileFor: (relativePath: string) => string,
  reservedAssetIds: readonly string[],
  signal?: AbortSignal
): Promise<ProgrammableScene> {
  if (items.length === 0) return scene;
  for (const item of items) assertShapeTransformSupported(item);

  const usedAssetIds = new Set<string>([
    ...scene.assets.map((asset) => asset.id),
    ...reservedAssetIds
  ]);
  const shapeAssetIds = new Map<string, string>();
  const generatedAssets: ProgrammableSceneAsset[] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) throw new ProcessAbortedError();
    const item = items[index]!;
    const assetId = allocateShapeAssetId(index, usedAssetIds);
    const target = fileFor(renderShapeFileName(index, item.node.id));
    await mkdir(dirname(target), { recursive: true });
    const png = new Resvg(
      shapeSvgDocument(item.node.shape, scene.width, scene.height),
      { font: { loadSystemFonts: false } }
    ).render().asPng();
    await writeFile(
      target,
      png,
      {
        ...(signal ? { signal } : {})
      }
    );
    shapeAssetIds.set(item.node.id, assetId);
    generatedAssets.push(Object.freeze({
      id: assetId,
      kind: "image",
      source: Object.freeze({ kind: "static", src: target })
    }));
  }

  return defineProgrammableScene({
    schemaVersion: scene.schemaVersion,
    id: scene.id,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    durationInFrames: scene.durationInFrames,
    ...(scene.background !== undefined ? { background: scene.background } : {}),
    ...(scene.captions !== undefined ? { captions: scene.captions } : {}),
    assets: Object.freeze([...scene.assets, ...generatedAssets]),
    children: replaceShapeNodes(scene.children, shapeAssetIds)
  });
}

function renderPrimitiveFileName(index: number, nodeId: string): string {
  const safeId = nodeId.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 96) || `primitive-${index}`;
  return join("primitives", `${String(index).padStart(3, "0")}-${safeId}.png`);
}

function allocatePrimitiveAssetId(index: number, usedAssetIds: Set<string>): string {
  let candidate = `__vexa_renderer_primitive_${String(index).padStart(4, "0")}`;
  while (usedAssetIds.has(candidate)) candidate = `_${candidate}`;
  usedAssetIds.add(candidate);
  return candidate;
}

function replacePrimitiveNodes(
  nodes: readonly ProgrammableSceneNode[],
  primitiveAssetIds: ReadonlyMap<string, string>
): readonly ProgrammableSceneNode[] {
  return Object.freeze(nodes.map((node) => {
    if (node.kind === "group" || node.kind === "layer") {
      return Object.freeze({
        ...node,
        children: replacePrimitiveNodes(node.children, primitiveAssetIds)
      });
    }
    if (node.kind !== "fill" && node.kind !== "solid") return node;

    const assetId = primitiveAssetIds.get(node.id);
    if (!assetId) return node;
    return Object.freeze({
      kind: "image",
      id: node.id,
      ...(node.startFrame !== undefined ? { startFrame: node.startFrame } : {}),
      ...(node.durationInFrames !== undefined ? { durationInFrames: node.durationInFrames } : {}),
      ...(node.zIndex !== undefined ? { zIndex: node.zIndex } : {}),
      ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
      ...(node.transform !== undefined ? { transform: node.transform } : {}),
      ...(node.effects !== undefined ? { effects: node.effects } : {}),
      ...(node.transitions !== undefined ? { transitions: node.transitions } : {}),
      assetId
    });
  }));
}

async function materializeProgrammableScenePrimitives(
  scene: ProgrammableScene,
  items: readonly ProgrammablePrimitiveRenderItem[],
  fileFor: (relativePath: string) => string,
  reservedAssetIds: readonly string[],
  signal?: AbortSignal
): Promise<ProgrammableScene> {
  if (items.length === 0) return scene;
  for (const item of items) assertPrimitiveTransformSupported(item);

  const usedAssetIds = new Set<string>([
    ...scene.assets.map((asset) => asset.id),
    ...reservedAssetIds
  ]);
  const primitiveAssetIds = new Map<string, string>();
  const generatedAssets: ProgrammableSceneAsset[] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) throw new ProcessAbortedError();
    const item = items[index]!;
    const assetId = allocatePrimitiveAssetId(index, usedAssetIds);
    const target = fileFor(renderPrimitiveFileName(index, item.node.id));
    await mkdir(dirname(target), { recursive: true });
    const png = new Resvg(
      primitiveSvgDocument(item.node, scene.width, scene.height),
      { font: { loadSystemFonts: false } }
    ).render().asPng();
    await writeFile(
      target,
      png,
      {
        ...(signal ? { signal } : {})
      }
    );
    primitiveAssetIds.set(item.node.id, assetId);
    generatedAssets.push(Object.freeze({
      id: assetId,
      kind: "image",
      source: Object.freeze({ kind: "static", src: target })
    }));
  }

  return defineProgrammableScene({
    schemaVersion: scene.schemaVersion,
    id: scene.id,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    durationInFrames: scene.durationInFrames,
    ...(scene.background !== undefined ? { background: scene.background } : {}),
    ...(scene.captions !== undefined ? { captions: scene.captions } : {}),
    assets: Object.freeze([...scene.assets, ...generatedAssets]),
    children: replacePrimitiveNodes(scene.children, primitiveAssetIds)
  });
}

function renderSurfaceBaseName(index: number, nodeId: string): string {
  const safeId = nodeId.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 96) || `surface-${index}`;
  return `${String(index).padStart(3, "0")}-${safeId}`;
}

function renderSurfaceFileName(index: number, nodeId: string): string {
  return join("surfaces", `${renderSurfaceBaseName(index, nodeId)}.png`);
}

function renderSurfaceFrameFileName(index: number, nodeId: string, localFrame: number): string {
  return join(
    "surfaces",
    `${renderSurfaceBaseName(index, nodeId)}-frames`,
    `frame-${String(localFrame).padStart(6, "0")}.png`
  );
}

function renderSurfaceFramePattern(index: number, nodeId: string): string {
  return join("surfaces", `${renderSurfaceBaseName(index, nodeId)}-frames`, "frame-%06d.png");
}

function renderSurfaceAnimationFileName(index: number, nodeId: string): string {
  return join("surfaces", `${renderSurfaceBaseName(index, nodeId)}.mov`);
}

function allocateSurfaceAssetId(index: number, usedAssetIds: Set<string>): string {
  let candidate = `__vexa_renderer_surface_${String(index).padStart(4, "0")}`;
  while (usedAssetIds.has(candidate)) candidate = `_${candidate}`;
  usedAssetIds.add(candidate);
  return candidate;
}

interface MaterializedSurfaceAsset {
  readonly assetId: string;
  readonly kind: "image" | "video";
}

function replaceSurfaceNodes(
  nodes: readonly ProgrammableSceneNode[],
  surfaceAssets: ReadonlyMap<string, MaterializedSurfaceAsset>
): readonly ProgrammableSceneNode[] {
  return Object.freeze(nodes.map((node) => {
    if (node.kind === "group" || node.kind === "layer") {
      return Object.freeze({
        ...node,
        children: replaceSurfaceNodes(node.children, surfaceAssets)
      });
    }
    if (node.kind !== "surface") return node;

    const materialized = surfaceAssets.get(node.id);
    if (!materialized) {
      throw new VexaRendererError(
        `Renderer surface asset was not materialized for node "${node.id}".`,
        "RENDER_SURFACE_FAILED"
      );
    }
    const common = {
      id: node.id,
      ...(node.startFrame !== undefined ? { startFrame: node.startFrame } : {}),
      ...(node.durationInFrames !== undefined ? { durationInFrames: node.durationInFrames } : {}),
      ...(node.zIndex !== undefined ? { zIndex: node.zIndex } : {}),
      ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
      ...(node.transform !== undefined ? { transform: node.transform } : {}),
      ...(node.effects !== undefined ? { effects: node.effects } : {}),
      ...(node.transitions !== undefined ? { transitions: node.transitions } : {}),
      assetId: materialized.assetId
    };
    return materialized.kind === "video"
      ? Object.freeze({ kind: "video" as const, ...common, muted: true })
      : Object.freeze({ kind: "image" as const, ...common });
  }));
}

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10] as const);

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  );
}

function invalidSurfacePng(
  rendererId: string,
  nodeId: string,
  compositionId: string,
  detail: string
): VexaRendererError {
  return new VexaRendererError(
    `Surface renderer adapter "${rendererId}" returned invalid PNG bytes for node "${nodeId}": ${detail}.`,
    "RENDER_SURFACE_FAILED",
    { compositionId }
  );
}

function validateSurfacePng(
  png: Uint8Array,
  rendererId: string,
  nodeId: string,
  compositionId: string
): Uint8Array {
  if (!(png instanceof Uint8Array) || png.byteLength < 45) {
    throw invalidSurfacePng(rendererId, nodeId, compositionId, "the PNG container is too short");
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (png[index] !== PNG_SIGNATURE[index]) {
      throw invalidSurfacePng(rendererId, nodeId, compositionId, "the PNG signature is invalid");
    }
  }

  let offset: number = PNG_SIGNATURE.length;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset + 12 <= png.byteLength) {
    const length = readPngUint32(png, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > png.byteLength) {
      throw invalidSurfacePng(rendererId, nodeId, compositionId, "a PNG chunk exceeds the byte buffer");
    }

    const type = pngChunkType(png, offset + 4);
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) {
        throw invalidSurfacePng(rendererId, nodeId, compositionId, "the first PNG chunk must be IHDR");
      }
      const width = readPngUint32(png, offset + 8);
      const height = readPngUint32(png, offset + 12);
      if (width === 0 || height === 0) {
        throw invalidSurfacePng(rendererId, nodeId, compositionId, "PNG dimensions must be positive");
      }
      sawHeader = true;
    }

    if (type === "acTL") {
      throw invalidSurfacePng(
        rendererId,
        nodeId,
        compositionId,
        "animated PNG is not supported by the static surface result"
      );
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== png.byteLength) {
        throw invalidSurfacePng(rendererId, nodeId, compositionId, "IEND must terminate the PNG");
      }
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawHeader || !sawImageData || !sawEnd) {
    throw invalidSurfacePng(
      rendererId,
      nodeId,
      compositionId,
      "PNG requires IHDR, image data, and a terminal IEND chunk"
    );
  }
  return png;
}

function rasterizeSurfaceResult(
  rendered: VexaSurfaceRenderResult,
  rendererId: string,
  nodeId: string,
  compositionId: string
): Uint8Array {
  if (rendered?.kind === "svg") {
    if (typeof rendered.svg !== "string" || !rendered.svg.trim()) {
      throw new VexaRendererError(
        `Surface renderer adapter "${rendererId}" returned an invalid SVG result for node "${nodeId}".`,
        "RENDER_SURFACE_FAILED",
        { compositionId }
      );
    }
    try {
      return new Resvg(rendered.svg, { font: { loadSystemFonts: false } }).render().asPng();
    } catch (cause) {
      throw new VexaRendererError(
        `Surface renderer adapter "${rendererId}" returned SVG that could not be rasterized for node "${nodeId}": ${cause instanceof Error ? cause.message : String(cause)}.`,
        "RENDER_SURFACE_FAILED",
        { compositionId, cause }
      );
    }
  }
  if (rendered?.kind === "png") {
    return validateSurfacePng(rendered.png, rendererId, nodeId, compositionId);
  }
  throw new VexaRendererError(
    `Surface renderer adapter "${rendererId}" returned an unsupported surface result for node "${nodeId}".`,
    "RENDER_SURFACE_FAILED",
    { compositionId }
  );
}

async function materializeProgrammableSceneSurfaces(
  scene: ProgrammableScene,
  items: readonly ProgrammableSurfaceRenderItem[],
  fileFor: (relativePath: string) => string,
  reservedAssetIds: readonly string[],
  adapters: ReadonlyMap<string, VexaSurfaceRendererAdapter>,
  compositionId: string,
  ffmpegPath: string | undefined,
  ffprobePath: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ProgrammableScene> {
  if (items.length === 0) return scene;
  for (const item of items) assertSurfaceTransformSupported(item);

  const usedAssetIds = new Set<string>([
    ...scene.assets.map((asset) => asset.id),
    ...reservedAssetIds
  ]);
  const surfaceAssets = new Map<string, MaterializedSurfaceAsset>();
  const generatedAssets: ProgrammableSceneAsset[] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) throw new ProcessAbortedError();
    const item = items[index]!;
    const rendererId = item.node.surface.rendererId;
    const adapter = adapters.get(rendererId);
    if (!adapter) {
      throw new VexaRendererError(
        `No surface renderer adapter is registered for rendererId "${rendererId}" required by surface node "${item.node.id}".`,
        "RENDER_SURFACE_UNAVAILABLE",
        { compositionId }
      );
    }

    const adapterContext: VexaSurfaceRendererAdapterContext = {
      compositionId,
      nodeId: item.node.id,
      width: scene.width,
      height: scene.height,
      fps: scene.fps,
      absoluteStartFrame: item.absoluteStartFrame,
      durationInFrames: item.durationInFrames,
      ...(signal ? { signal } : {})
    };
    const assetId = allocateSurfaceAssetId(index, usedAssetIds);

    if (typeof adapter.renderFrame === "function") {
      for (let localFrame = 0; localFrame < item.durationInFrames; localFrame += 1) {
        if (signal?.aborted) throw new ProcessAbortedError();
        let rendered: VexaSurfaceRenderResult;
        try {
          rendered = await adapter.renderFrame(item.node.surface, {
            ...adapterContext,
            localFrame,
            absoluteFrame: item.absoluteStartFrame + localFrame,
            progress: item.durationInFrames <= 1
              ? 0
              : localFrame / (item.durationInFrames - 1)
          });
        } catch (cause) {
          if (signal?.aborted || cause instanceof ProcessAbortedError) throw new ProcessAbortedError();
          if (cause instanceof ProcessTimeoutError) throw cause;
          throw new VexaRendererError(
            `Surface renderer adapter "${rendererId}" failed for node "${item.node.id}" at local frame ${localFrame}: ${cause instanceof Error ? cause.message : String(cause)}.`,
            "RENDER_SURFACE_FAILED",
            { compositionId, cause }
          );
        }
        const frameTarget = fileFor(renderSurfaceFrameFileName(index, item.node.id, localFrame));
        await mkdir(dirname(frameTarget), { recursive: true });
        await writeFile(
          frameTarget,
          rasterizeSurfaceResult(rendered, rendererId, item.node.id, compositionId),
          { ...(signal ? { signal } : {}) }
        );
      }

      const animationTarget = fileFor(renderSurfaceAnimationFileName(index, item.node.id));
      const framePattern = fileFor(renderSurfaceFramePattern(index, item.node.id));
      try {
        const binaries = await resolveMediaBinaries({
          ...(ffmpegPath ? { ffmpegPath } : {}),
          ...(ffprobePath ? { ffprobePath } : {})
        });
        await runProcess(
          binaries.ffmpeg,
          [
            "-y",
            "-framerate",
            formatShapeNumber(scene.fps),
            "-start_number",
            "0",
            "-i",
            framePattern,
            "-frames:v",
            String(item.durationInFrames),
            "-an",
            "-c:v",
            "qtrle",
            "-pix_fmt",
            "argb",
            animationTarget
          ],
          {
            ...(signal ? { signal } : {}),
            timeoutMs
          }
        );
      } catch (cause) {
        if (signal?.aborted || cause instanceof ProcessAbortedError) throw new ProcessAbortedError();
        if (cause instanceof ProcessTimeoutError) throw cause;
        throw new VexaRendererError(
          `Surface renderer adapter "${rendererId}" frames could not be encoded for node "${item.node.id}": ${cause instanceof Error ? cause.message : String(cause)}.`,
          "RENDER_SURFACE_FAILED",
          { compositionId, cause }
        );
      }

      surfaceAssets.set(item.node.id, Object.freeze({ assetId, kind: "video" }));
      generatedAssets.push(Object.freeze({
        id: assetId,
        kind: "video",
        source: Object.freeze({ kind: "static", src: animationTarget })
      }));
      continue;
    }

    if (typeof adapter.renderSurface !== "function") {
      throw new VexaRendererError(
        `Surface renderer adapter "${rendererId}" has no executable renderer for node "${item.node.id}".`,
        "RENDER_SURFACE_FAILED",
        { compositionId }
      );
    }
    let rendered: VexaSurfaceRenderResult;
    try {
      rendered = await adapter.renderSurface(item.node.surface, adapterContext);
    } catch (cause) {
      if (signal?.aborted || cause instanceof ProcessAbortedError) throw new ProcessAbortedError();
      if (cause instanceof ProcessTimeoutError) throw cause;
      throw new VexaRendererError(
        `Surface renderer adapter "${rendererId}" failed for node "${item.node.id}": ${cause instanceof Error ? cause.message : String(cause)}.`,
        "RENDER_SURFACE_FAILED",
        { compositionId, cause }
      );
    }

    const target = fileFor(renderSurfaceFileName(index, item.node.id));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      rasterizeSurfaceResult(rendered, rendererId, item.node.id, compositionId),
      { ...(signal ? { signal } : {}) }
    );
    surfaceAssets.set(item.node.id, Object.freeze({ assetId, kind: "image" }));
    generatedAssets.push(Object.freeze({
      id: assetId,
      kind: "image",
      source: Object.freeze({ kind: "static", src: target })
    }));
  }

  return defineProgrammableScene({
    schemaVersion: scene.schemaVersion,
    id: scene.id,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    durationInFrames: scene.durationInFrames,
    ...(scene.background !== undefined ? { background: scene.background } : {}),
    ...(scene.captions !== undefined ? { captions: scene.captions } : {}),
    assets: Object.freeze([...scene.assets, ...generatedAssets]),
    children: replaceSurfaceNodes(scene.children, surfaceAssets)
  });
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
  const shapeItems = collectShapeRenderItems(scene);
  const primitiveItems = collectPrimitiveRenderItems(scene);
  const surfaceItems = collectSurfaceRenderItems(scene);
  const surfaceAdapters = normalizeSurfaceAdapters(options.surfaceAdapters);
  const resolvedAssets: Record<string, string> = { ...callerResolvedAssets };
  if (
    unresolvedStorageAssets.length === 0 &&
    shapeItems.length === 0 &&
    primitiveItems.length === 0 &&
    surfaceItems.length === 0
  ) {
    return Object.freeze({
      scene,
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

  let renderScene = scene;
  try {
    renderScene = await materializeProgrammableSceneShapes(
      renderScene,
      shapeItems,
      (relativePath) => workspace.file(relativePath),
      Object.keys(resolvedAssets),
      signal
    );
    renderScene = await materializeProgrammableScenePrimitives(
      renderScene,
      primitiveItems,
      (relativePath) => workspace.file(relativePath),
      Object.keys(resolvedAssets),
      signal
    );
    renderScene = await materializeProgrammableSceneSurfaces(
      renderScene,
      surfaceItems,
      (relativePath) => workspace.file(relativePath),
      Object.keys(resolvedAssets),
      surfaceAdapters,
      compositionId,
      options.ffmpegPath,
      options.ffprobePath,
      timeoutMs,
      signal
    );
  } catch (cause) {
    await workspace.cleanup().catch(() => undefined);
    if (signal?.aborted || cause instanceof ProcessAbortedError) throw new ProcessAbortedError();
    if (cause instanceof ProcessTimeoutError) throw cause;
    if (cause instanceof VexaRendererError) throw cause;
    throw new VexaRendererError(
      `Failed to materialize programmable raster nodes for composition "${compositionId}": ${cause instanceof Error ? cause.message : String(cause)}.`,
      "RENDER_EXECUTION_FAILED",
      { compositionId, cause }
    );
  }

  return Object.freeze({
    scene: renderScene,
    resolvedAssets: Object.freeze(resolvedAssets),
    cleanup: () => workspace.cleanup()
  });
}

async function withRenderAssetWorkspace<T>(
  scene: ProgrammableScene,
  compositionId: string,
  options: VexaRenderExecutionOptions,
  timeoutMs: number,
  callback: (
    renderScene: ProgrammableScene,
    resolvedAssets: Readonly<Record<string, string>>
  ) => Promise<T>
): Promise<T> {
  const workspace = await createRenderAssetWorkspace(scene, compositionId, options, timeoutMs);
  try {
    const result = await callback(workspace.scene, workspace.resolvedAssets);
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

function normalizeRemoteFontAdapters(
  adapters: readonly VexaRemoteFontAdapter[] | undefined
): ReadonlyMap<string, VexaRemoteFontAdapter> {
  const byProvider = new Map<string, VexaRemoteFontAdapter>();
  for (const adapter of adapters ?? []) {
    if (!adapter || typeof adapter.provider !== "string" || !adapter.provider.trim()) {
      throw new VexaRendererError(
        "Every remote font adapter requires a non-empty provider.",
        "INVALID_RENDERER_OPTIONS"
      );
    }
    if (typeof adapter.resolveFont !== "function") {
      throw new VexaRendererError(
        `Remote font adapter "${adapter.provider.trim()}" requires resolveFont().`,
        "INVALID_RENDERER_OPTIONS"
      );
    }
    const provider = adapter.provider.trim();
    if (byProvider.has(provider)) {
      throw new VexaRendererError(
        `Remote font adapter provider "${provider}" is duplicated.`,
        "INVALID_RENDERER_OPTIONS"
      );
    }
    byProvider.set(provider, adapter);
  }
  return byProvider;
}

async function materializeRemoteProjectFonts(
  project: VideoProjectAst,
  compositionId: string,
  adapters: readonly VexaRemoteFontAdapter[] | undefined,
  signal?: AbortSignal
): Promise<VideoProjectAst> {
  const byProvider = normalizeRemoteFontAdapters(adapters);
  const resolvedFonts = new Map<string, string>();
  let projectChanged = false;
  const tracks: VideoProjectAst["tracks"][number][] = [];

  for (const track of project.tracks) {
    if (track.hidden === true) {
      tracks.push(track);
      continue;
    }

    let trackChanged = false;
    const clips: VideoProjectAst["tracks"][number]["clips"][number][] = [];
    for (const clip of track.clips) {
      if (clip.kind !== "text" || clip.enabled === false) {
        clips.push(clip);
        continue;
      }

      const reference = clip.style?.remoteFont;
      if (!reference) {
        clips.push(clip);
        continue;
      }
      if (signal?.aborted) throw new ProcessAbortedError();

      const adapter = byProvider.get(reference.provider);
      if (!adapter) {
        throw new VexaRendererError(
          `No remote font adapter is registered for provider "${reference.provider}" required by text clip "${clip.id}".`,
          "RENDER_FONT_UNAVAILABLE",
          { compositionId }
        );
      }

      const cacheKey = [
        reference.provider,
        reference.family,
        reference.weight ?? "",
        reference.style ?? ""
      ].join("\u0000");
      let fontFile = resolvedFonts.get(cacheKey);
      if (!fontFile) {
        try {
          const candidate = await adapter.resolveFont(reference, {
            compositionId,
            clipId: clip.id,
            ...(signal ? { signal } : {})
          });
          if (typeof candidate !== "string" || !candidate.trim()) {
            throw new Error("adapter returned an empty font path");
          }
          if (!isAbsolute(candidate.trim())) {
            throw new Error(`adapter must return an absolute local font path: ${candidate.trim()}`);
          }
          fontFile = resolve(candidate.trim());
          resolvedFonts.set(cacheKey, fontFile);
        } catch (cause) {
          if (cause instanceof ProcessAbortedError || signal?.aborted) {
            throw new ProcessAbortedError();
          }
          throw new VexaRendererError(
            `Remote font adapter "${reference.provider}" failed for text clip "${clip.id}": ${cause instanceof Error ? cause.message : String(cause)}.`,
            "RENDER_FONT_UNAVAILABLE",
            { compositionId, cause }
          );
        }
      }

      const style = { ...clip.style, fontFile };
      delete style.remoteFont;
      trackChanged = true;
      clips.push({ ...clip, style });
    }

    if (trackChanged) {
      projectChanged = true;
      tracks.push({ ...track, clips });
    } else {
      tracks.push(track);
    }
  }

  return projectChanged ? { ...project, tracks } : project;
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

function compositionResolutionError(
  compositionId: string,
  cause: unknown
): VexaRendererError {
  if (cause instanceof ProgrammableCompositionError) {
    if (cause.code === "INVALID_COMPOSITION_PROPS") {
      return new VexaRendererError(
        cause.message,
        "RENDER_INPUT_PROPS_INVALID",
        { compositionId, cause }
      );
    }
    if (cause.code === "COMPOSITION_METADATA_FAILED") {
      return new VexaRendererError(
        cause.message,
        "RENDER_COMPOSITION_METADATA_FAILED",
        { compositionId, cause }
      );
    }
  }

  return new VexaRendererError(
    `Failed to resolve executable composition "${compositionId}": ${cause instanceof Error ? cause.message : String(cause)}.`,
    "RENDER_EXECUTION_FAILED",
    { compositionId, cause }
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

  async inspectComposition(id: string): Promise<ProgrammableCompositionStaticMetadata> {
    const composition = this.requireComposition(id);
    const executable = await this.#requireExecutableComposition(composition.id);
    return getExecutableCompositionStaticMetadata(executable);
  }

  async resolveComposition(
    id: string,
    inputProps?: JsonObject
  ): Promise<ResolvedProgrammableComposition> {
    const composition = this.requireComposition(id);
    const executable = await this.#requireExecutableComposition(composition.id);
    try {
      return await resolveProgrammableComposition(
        executable.definition,
        inputProps as Partial<JsonObject> | undefined
      );
    } catch (cause) {
      throw compositionResolutionError(composition.id, cause);
    }
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
        async (renderScene, resolvedAssets) => {
          const project = await this.#prepareProjectFonts(
            lowerProgrammableSceneToVideoProject(renderScene, { resolvedAssets }),
            composition.id,
            options
          );
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
        async (renderScene, resolvedAssets) => {
          const project = await this.#prepareProjectFonts(
            lowerProgrammableSceneToVideoProject(renderScene, { resolvedAssets }),
            composition.id,
            options
          );

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
        async (renderScene, resolvedAssets) => {
          const project = await this.#prepareProjectFonts(
            lowerProgrammableSceneToVideoProject(renderScene, { resolvedAssets }),
            composition.id,
            options
          );
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

  async #prepareProjectFonts(
    project: VideoProjectAst,
    compositionId: string,
    options: VexaRenderExecutionOptions
  ): Promise<VideoProjectAst> {
    try {
      const remotePrepared = await materializeRemoteProjectFonts(
        project,
        compositionId,
        options.fontAdapters,
        options.signal
      );
      return await resolveProjectFontFiles(remotePrepared, {
        ...(this.#bundleRoot ? { baseDirectory: this.#bundleRoot } : {})
      });
    } catch (cause) {
      if (cause instanceof ProjectFontResolutionError) {
        throw new VexaRendererError(
          `Font readiness failed for composition "${compositionId}": ${cause.message}`,
          "RENDER_FONT_UNAVAILABLE",
          { compositionId, cause }
        );
      }
      throw cause;
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
      if (cause instanceof ProgrammableCompositionError) {
        throw compositionResolutionError(compositionId, cause);
      }
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

export interface HostedCompositionWorkerContext {
  readonly jobId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export type HostedCompositionManifestResolver = (
  bundle: HostedCompositionBundleReference,
  context: HostedCompositionWorkerContext
) => string | Promise<string>;

export type HostedCompositionOutputResolver = (
  output: HostedCompositionOutputReference,
  payload: HostedCompositionRenderPayload,
  context: HostedCompositionWorkerContext
) => string | Promise<string>;

export interface HostedCompositionPublicationContext extends HostedCompositionWorkerContext {
  /** Request-derived identity, independent of attempt number or worker ID. */
  readonly fingerprint: string;
}

export interface HostedCompositionArtifactPublishContext
  extends HostedCompositionPublicationContext {
  readonly localOutput: string;
  readonly contentType: string;
}

export type HostedCompositionArtifactPublisher = (
  output: HostedCompositionOutputReference,
  payload: HostedCompositionRenderPayload,
  context: HostedCompositionArtifactPublishContext
) => HostedRenderArtifact | Promise<HostedRenderArtifact>;

export type HostedCompositionWorkerRenderer = Pick<
  VexaCompositionRenderer,
  "renderStill" | "renderFrame" | "renderFrameRange" | "renderVideo"
>;

export interface HostedCompositionWorkerRegistry {
  register<TPayload, TResult>(
    type: string,
    handler: JobHandler<TPayload, TResult>,
    options?: JobHandlerOptions<TPayload, TResult>
  ): unknown;
}

export interface HostedCompositionWorkerOptions {
  readonly resolveManifest: HostedCompositionManifestResolver;
  readonly resolveOutput: HostedCompositionOutputResolver;
  readonly rendererOptions?: VexaRendererOptions;
  readonly executionOptions?: Omit<
    VexaRenderExecutionOptions,
    "inputProps" | "signal" | "onProgress"
  >;
  /** Upload single-file outputs through the existing Vexa Storage abstraction. */
  readonly artifactStorage?: Storage;
  /** Transfer options for artifactStorage; the worker always supplies its cancellation signal. */
  readonly artifactUploadOptions?: Omit<StorageTransferOptions, "signal">;
  /**
   * General publication hook. Required for frame-range destinations because the render output is
   * a directory; hosts can package/upload it however their provider requires.
   */
  readonly publishArtifact?: HostedCompositionArtifactPublisher;
  /**
   * Optional provider-backed receipt lookup before rendering. Null means no published artifact;
   * errors and mismatched fingerprints fail closed rather than overwriting a remote destination.
   */
  readonly lookupPublishedArtifact?: (
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext
  ) => HostedCompositionPublicationReceipt | null | Promise<HostedCompositionPublicationReceipt | null>;
  /**
   * Optional durable receipt writer, invoked after publication but before job completion.
   * This is not atomic with the upload or the Redis job result; provider writes must be idempotent.
   */
  readonly recordPublishedArtifact?: (
    receipt: HostedCompositionPublicationReceipt,
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext
  ) => void | Promise<void>;
  /** Test/provider seam; normal execution uses VexaCompositionRenderer.fromManifest(). */
  readonly createRenderer?: (
    manifestPath: string,
    options: VexaRendererOptions
  ) => HostedCompositionWorkerRenderer | Promise<HostedCompositionWorkerRenderer>;
}

export interface HostedCompositionWorkerResult {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly bundleId: string;
  readonly compositionId: string;
  readonly target: HostedCompositionRenderTarget["kind"];
  readonly output: string;
  readonly contentType: string;
  readonly artifact?: HostedRenderArtifact;
}

function hostedWorkerText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VexaRendererError(
      `${label} must resolve to a non-empty string.`,
      "INVALID_RENDERER_OPTIONS"
    );
  }
  return value.trim();
}

function hostedWorkerContentType(payload: HostedCompositionRenderPayload): string {
  if (payload.output.contentType) return payload.output.contentType;
  switch (payload.target.kind) {
    case "still":
    case "frame": {
      const format = payload.target.format ?? "png";
      return format === "jpeg" ? "image/jpeg" : `image/${format}`;
    }
    case "frame-range":
      return "application/vnd.vexa.frame-sequence";
    case "video":
      return payload.target.container === "webm" ? "video/webm" : "video/mp4";
  }
}

function hostedWorkerPublicationError(
  payload: HostedCompositionRenderPayload,
  message: string,
  cause?: unknown
): VexaRendererError {
  return new VexaRendererError(
    message,
    "RENDER_ARTIFACT_PUBLISH_FAILED",
    {
      compositionId: payload.compositionId,
      ...(cause === undefined ? {} : { cause })
    }
  );
}

function normalizeHostedWorkerArtifact(
  artifact: HostedRenderArtifact,
  payload: HostedCompositionRenderPayload,
  contentType: string
): HostedRenderArtifact {
  if (!artifact || typeof artifact !== "object") {
    throw hostedWorkerPublicationError(
      payload,
      "Hosted composition artifact publisher must return an artifact object."
    );
  }
  if (typeof artifact.url !== "string" || artifact.url.trim() === "") {
    throw hostedWorkerPublicationError(
      payload,
      "Hosted composition artifact publisher must return a non-empty artifact url."
    );
  }
  if (
    artifact.sizeBytes !== undefined &&
    (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0)
  ) {
    throw hostedWorkerPublicationError(
      payload,
      "Hosted composition artifact sizeBytes must be a non-negative safe integer."
    );
  }

  const name = artifact.name?.trim() || payload.output.artifactId;
  const normalizedContentType = artifact.contentType?.trim() || contentType;
  return Object.freeze({
    url: artifact.url.trim(),
    name,
    contentType: normalizedContentType,
    ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
    ...(artifact.metadata ? { metadata: Object.freeze({ ...artifact.metadata }) } : {})
  });
}

async function publishHostedWorkerArtifact(
  localOutput: string,
  payload: HostedCompositionRenderPayload,
  context: HostedCompositionWorkerContext,
  options: HostedCompositionWorkerOptions,
  contentType: string,
  fingerprint: string
): Promise<HostedRenderArtifact | undefined> {
  const destination = payload.output.destination;
  if (!destination) return undefined;
  if (context.signal.aborted) throw new JobCancelledError(context.jobId);

  const publishContext: HostedCompositionArtifactPublishContext = Object.freeze({
    ...context,
    localOutput,
    contentType,
    fingerprint
  });

  const publishWithProvider = async (): Promise<HostedRenderArtifact> => {
    const publisher = options.publishArtifact;
    if (!publisher) {
      throw hostedWorkerPublicationError(
        payload,
        "Hosted composition output.destination requires artifactStorage or publishArtifact."
      );
    }
    try {
      const artifact = await publisher(
        payload.output,
        payload,
        publishContext
      );
      if (context.signal.aborted) throw new JobCancelledError(context.jobId);
      return normalizeHostedWorkerArtifact(artifact, payload, contentType);
    } catch (cause) {
      if (cause instanceof JobCancelledError || context.signal.aborted) throw cause;
      if (
        cause instanceof VexaRendererError &&
        cause.code === "RENDER_ARTIFACT_PUBLISH_FAILED"
      ) {
        throw cause;
      }
      throw hostedWorkerPublicationError(
        payload,
        `Failed to publish hosted composition artifact "${payload.output.artifactId}".`,
        cause
      );
    }
  };

  if (payload.target.kind === "frame-range") {
    if (!options.publishArtifact) {
      throw hostedWorkerPublicationError(
        payload,
        "Frame-range hosted outputs require publishArtifact() because the local render output is a directory."
      );
    }
    return await publishWithProvider();
  }

  const artifactStorage = options.artifactStorage;
  if (artifactStorage) {
    try {
      const transfer = await artifactStorage.upload(localOutput, destination, {
        ...(options.artifactUploadOptions ?? {}),
        overwrite: options.artifactUploadOptions?.overwrite ?? true,
        signal: context.signal
      });
      if (context.signal.aborted) throw new JobCancelledError(context.jobId);
      return Object.freeze({
        url: destination,
        name: payload.output.artifactId,
        contentType: transfer.contentType?.trim() || contentType,
        ...(typeof transfer.bytesTransferred === "number"
          ? { sizeBytes: transfer.bytesTransferred }
          : {}),
        metadata: Object.freeze({
          artifactId: payload.output.artifactId,
          bundleId: payload.bundle.id,
          compositionId: payload.compositionId,
          target: payload.target.kind
        })
      });
    } catch (cause) {
      if (cause instanceof JobCancelledError || context.signal.aborted) throw cause;
      throw hostedWorkerPublicationError(
        payload,
        `Failed to upload hosted composition artifact "${payload.output.artifactId}" to "${destination}".`,
        cause
      );
    }
  }

  return await publishWithProvider();
}

function hostedWorkerContext(
  context: JobHandlerContext<HostedCompositionRenderPayload, HostedCompositionWorkerResult>
): HostedCompositionWorkerContext {
  return Object.freeze({
    jobId: context.job.descriptor.id,
    attempt: context.job.attempt,
    signal: context.signal
  });
}

export function registerHostedCompositionRenderWorker<
  TRegistry extends HostedCompositionWorkerRegistry
>(
  registry: TRegistry,
  options: HostedCompositionWorkerOptions
): TRegistry {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError(
      "registerHostedCompositionRenderWorker requires an existing Vexa job registry."
    );
  }
  if (!options || typeof options.resolveManifest !== "function") {
    throw new TypeError("Hosted composition workers require resolveManifest().");
  }
  if (typeof options.resolveOutput !== "function") {
    throw new TypeError("Hosted composition workers require resolveOutput().");
  }
  if (options.artifactUploadOptions && !options.artifactStorage) {
    throw new TypeError(
      "Hosted composition artifactUploadOptions require artifactStorage."
    );
  }

  registry.register<HostedCompositionRenderPayload, HostedCompositionWorkerResult>(
    HOSTED_COMPOSITION_RENDER_TYPE,
    async (rawPayload, jobContext) => {
      const payload = createHostedCompositionRenderRequest(rawPayload).payload;
      const context = hostedWorkerContext(jobContext);
      if (context.signal.aborted) throw new JobCancelledError(context.jobId);

      if (payload.output.destination) {
        if (payload.target.kind === "frame-range" && !options.publishArtifact) {
          throw hostedWorkerPublicationError(
            payload,
            "Frame-range hosted outputs require publishArtifact() because the local render output is a directory."
          );
        }
        if (
          payload.target.kind !== "frame-range" &&
          !options.artifactStorage &&
          !options.publishArtifact
        ) {
          throw hostedWorkerPublicationError(
            payload,
            "Hosted composition output.destination requires artifactStorage or publishArtifact."
          );
        }
      }

      await jobContext.reportProgress({
        percent: 0,
        phase: "preparing",
        message: "Resolving hosted composition inputs."
      });

      const [manifestValue, outputValue] = await Promise.all([
        options.resolveManifest(payload.bundle, context),
        options.resolveOutput(payload.output, payload, context)
      ]);
      if (context.signal.aborted) throw new JobCancelledError(context.jobId);

      const manifestPath = hostedWorkerText(
        manifestValue,
        "Hosted composition manifest resolver"
      );
      const output = hostedWorkerText(
        outputValue,
        "Hosted composition output resolver"
      );
      const contentType = hostedWorkerContentType(payload);
      const fingerprint = fingerprintHostedCompositionPublication(payload);
      const publicationContext: HostedCompositionPublicationContext = Object.freeze({
        ...context,
        fingerprint
      });
      if (payload.output.destination && options.lookupPublishedArtifact) {
        let receipt: HostedCompositionPublicationReceipt | null;
        try {
          receipt = await options.lookupPublishedArtifact(payload.output, payload, publicationContext);
        } catch (cause) {
          if (context.signal.aborted) throw new JobCancelledError(context.jobId);
          throw hostedWorkerPublicationError(payload, "Hosted artifact receipt lookup failed.", cause);
        }
        if (context.signal.aborted) throw new JobCancelledError(context.jobId);
        if (receipt !== null) {
          if (!receipt || receipt.fingerprint !== fingerprint) {
            throw hostedWorkerPublicationError(payload, "Hosted artifact receipt fingerprint mismatch.");
          }
          const artifact = normalizeHostedWorkerArtifact(receipt.artifact, payload, contentType);
          await jobContext.reportProgress({
            percent: 100,
            phase: "complete",
            message: "Reused previously published hosted composition artifact.",
            data: { artifactId: payload.output.artifactId, url: artifact.url }
          });
          return Object.freeze({
            schemaVersion: 1 as const,
            artifactId: payload.output.artifactId,
            bundleId: payload.bundle.id,
            compositionId: payload.compositionId,
            target: payload.target.kind,
            output,
            contentType,
            artifact
          });
        }
      }
      const renderer = await (
        options.createRenderer?.(manifestPath, options.rendererOptions ?? {}) ??
        VexaCompositionRenderer.fromManifest(manifestPath, options.rendererOptions)
      );

      let progressChain = Promise.resolve();
      const onProgress = (progress: VexaRenderProgress): void => {
        progressChain = progressChain.then(() =>
          jobContext.reportProgress({
            percent: progress.percent,
            phase: progress.phase,
            message: `Rendering ${progress.target}.`,
            data: {
              target: progress.target,
              completedFrames: progress.completedFrames,
              totalFrames: progress.totalFrames
            }
          })
        );
      };

      const execution = {
        ...(options.executionOptions ?? {}),
        overwrite: options.executionOptions?.overwrite ?? true,
        ...(payload.inputProps ? { inputProps: payload.inputProps } : {}),
        signal: context.signal,
        onProgress
      } satisfies VexaRenderExecutionOptions;

      let artifact: HostedRenderArtifact | undefined;

      try {
        switch (payload.target.kind) {
          case "still":
            await renderer.renderStill({
              ...execution,
              compositionId: payload.compositionId,
              output,
              ...(payload.target.format ? { format: payload.target.format } : {})
            });
            break;
          case "frame":
            await renderer.renderFrame({
              ...execution,
              compositionId: payload.compositionId,
              output,
              frame: payload.target.frame,
              ...(payload.target.format ? { format: payload.target.format } : {})
            });
            break;
          case "frame-range":
            await renderer.renderFrameRange({
              ...execution,
              compositionId: payload.compositionId,
              output,
              startFrame: payload.target.startFrame,
              endFrameExclusive: payload.target.endFrameExclusive,
              ...(payload.target.format ? { format: payload.target.format } : {})
            });
            break;
          case "video":
            await renderer.renderVideo({
              ...execution,
              compositionId: payload.compositionId,
              output,
              ...(payload.target.startFrame === undefined
                ? {}
                : {
                    startFrame: payload.target.startFrame,
                    endFrameExclusive: payload.target.endFrameExclusive!
                  }),
              ...(payload.target.container ? { format: payload.target.container } : {})
            });
            break;
        }
        await progressChain;

        if (payload.output.destination) {
          await jobContext.reportProgress({
            percent: 100,
            phase: "publishing",
            message: "Publishing hosted composition artifact.",
            data: {
              artifactId: payload.output.artifactId,
              destination: payload.output.destination
            }
          });
          artifact = await publishHostedWorkerArtifact(
            output,
            payload,
            context,
            options,
            contentType,
            fingerprint
          );
          if (artifact && options.recordPublishedArtifact) {
            try {
              await options.recordPublishedArtifact(
                Object.freeze({ fingerprint, artifact }),
                payload.output,
                payload,
                publicationContext
              );
            } catch (cause) {
              if (context.signal.aborted) throw new JobCancelledError(context.jobId);
              throw hostedWorkerPublicationError(payload, "Hosted artifact receipt recording failed.", cause);
            }
            if (context.signal.aborted) throw new JobCancelledError(context.jobId);
          }
          await jobContext.reportProgress({
            percent: 100,
            phase: "complete",
            message: "Hosted composition artifact is ready.",
            data: {
              artifactId: payload.output.artifactId,
              ...(artifact ? { url: artifact.url } : {})
            }
          });
        }
      } catch (cause) {
        await progressChain.catch(() => undefined);
        const value = cause as { readonly code?: unknown; readonly name?: unknown } | null;
        if (
          context.signal.aborted ||
          value?.code === "RENDER_ABORTED" ||
          value?.code === "PROCESS_ABORTED" ||
          value?.code === "JOB_CANCELLED" ||
          value?.name === "AbortError"
        ) {
          throw new JobCancelledError(context.jobId);
        }
        throw cause;
      }

      return Object.freeze({
        schemaVersion: 1 as const,
        artifactId: payload.output.artifactId,
        bundleId: payload.bundle.id,
        compositionId: payload.compositionId,
        target: payload.target.kind,
        output,
        contentType,
        ...(artifact ? { artifact } : {})
      });
    }
  );

  return registry;
}

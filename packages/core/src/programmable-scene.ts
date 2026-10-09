import type { ClipTransform, ProjectTrack, TextStyle, TimelineClip, VideoProjectAst } from "./composition.js";
import type { ResizeFit } from "./editing.js";
import type { JsonObject, JsonValue } from "./programmable-composition.js";
import { InvalidProgrammableShapeError, normalizeProgrammableShape, type ProgrammableShape } from "./programmable-shapes.js";
import { frameToSeconds } from "./programmable-timing.js";
import type { MediaStorageSource } from "./storage.js";

export const PROGRAMMABLE_SCENE_SCHEMA_VERSION = 1 as const;

export type ProgrammableSceneSchemaVersion = typeof PROGRAMMABLE_SCENE_SCHEMA_VERSION;
export type ProgrammableSceneAssetKind = "image" | "video" | "audio";
export type ProgrammableScenePreloadMode = "auto" | "metadata" | "none";
export type ProgrammableSceneSurfaceKind = "svg" | "canvas";
export type ProgrammableSceneAssetReadinessStatus = "idle" | "loading" | "ready" | "error";

export type ProgrammableSceneErrorCode =
  | "INVALID_SCENE"
  | "SCENE_ASSET_POLICY_VIOLATION"
  | "SCENE_ASSET_UNRESOLVED"
  | "UNSUPPORTED_SCENE_LOWERING";

export class ProgrammableSceneError extends Error {
  readonly code: ProgrammableSceneErrorCode;
  readonly nodeId?: string;
  readonly assetId?: string;

  constructor(
    message: string,
    code: ProgrammableSceneErrorCode,
    details: { nodeId?: string; assetId?: string } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details.nodeId !== undefined) this.nodeId = details.nodeId;
    if (details.assetId !== undefined) this.assetId = details.assetId;
  }
}

export class InvalidProgrammableSceneError extends ProgrammableSceneError {
  constructor(message: string, details: { nodeId?: string; assetId?: string } = {}) {
    super(message, "INVALID_SCENE", details);
  }
}

export class ProgrammableSceneAssetPolicyError extends ProgrammableSceneError {
  constructor(assetId: string, message: string) {
    super(`Asset "${assetId}" violates the scene asset policy: ${message}`, "SCENE_ASSET_POLICY_VIOLATION", {
      assetId
    });
  }
}

export class ProgrammableSceneAssetUnresolvedError extends ProgrammableSceneError {
  constructor(assetId: string) {
    super(
      `Asset "${assetId}" must be resolved through the Vexa storage layer before VideoProject lowering.`,
      "SCENE_ASSET_UNRESOLVED",
      { assetId }
    );
  }
}

export class UnsupportedProgrammableSceneLoweringError extends ProgrammableSceneError {
  constructor(nodeId: string, message: string) {
    super(
      `Scene node "${nodeId}" cannot be lowered to VideoProjectAst: ${message}`,
      "UNSUPPORTED_SCENE_LOWERING",
      { nodeId }
    );
  }
}

export interface ProgrammableStaticAssetSource {
  readonly kind: "static";
  /** Browser/public-path or already-resolved local path. */
  readonly src: string;
}

export interface ProgrammableStorageAssetSource {
  readonly kind: "storage";
  readonly source: MediaStorageSource;
}

export type ProgrammableSceneAssetSource =
  | ProgrammableStaticAssetSource
  | ProgrammableStorageAssetSource;

export interface ProgrammableSceneAsset {
  readonly id: string;
  readonly kind: ProgrammableSceneAssetKind;
  readonly source: ProgrammableSceneAssetSource;
  readonly preload?: ProgrammableScenePreloadMode;
}

export interface ProgrammableSceneAssetPolicy {
  readonly allowStatic?: boolean;
  readonly allowLocal?: boolean;
  readonly allowHttp?: boolean;
  readonly allowObjectStorage?: boolean;
}

export interface ProgrammableSceneCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ProgrammableSceneTransform {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
}

export interface ProgrammableSceneNodeBase {
  readonly id: string;
  /** Frame offset relative to the containing group/layer. Defaults to 0. */
  readonly startFrame?: number;
  /** Defaults to the remaining duration of the containing group/layer. */
  readonly durationInFrames?: number;
  /** Added to ancestor z-index values. Ties preserve declaration order. */
  readonly zIndex?: number;
  /** Multiplied by ancestor opacity. */
  readonly opacity?: number;
  readonly transform?: ProgrammableSceneTransform;
}

export interface ProgrammableSceneGroupNode extends ProgrammableSceneNodeBase {
  readonly kind: "group";
  readonly children: readonly ProgrammableSceneNode[];
}

export interface ProgrammableSceneLayerNode extends ProgrammableSceneNodeBase {
  readonly kind: "layer";
  readonly children: readonly ProgrammableSceneNode[];
}

export interface ProgrammableSceneFillNode extends ProgrammableSceneNodeBase {
  readonly kind: "fill";
  readonly color: string;
}

export interface ProgrammableSceneSolidNode extends ProgrammableSceneNodeBase {
  readonly kind: "solid";
  readonly color: string;
  readonly width: number;
  readonly height: number;
}

export interface ProgrammableSceneShapeNode extends ProgrammableSceneNodeBase {
  readonly kind: "shape";
  readonly shape: ProgrammableShape;
}

export interface ProgrammableSceneTextStyle {
  readonly fontSize?: number;
  readonly color?: string;
  readonly fontFile?: string;
  readonly boxColor?: string;
  readonly boxPadding?: number;
}

export interface ProgrammableSceneTextNode extends ProgrammableSceneNodeBase {
  readonly kind: "text";
  readonly text: string;
  readonly style?: ProgrammableSceneTextStyle;
}

export interface ProgrammableSceneImageNode extends ProgrammableSceneNodeBase {
  readonly kind: "image";
  readonly assetId: string;
  readonly fit?: ResizeFit;
  readonly crop?: ProgrammableSceneCrop;
}

export interface ProgrammableSceneVideoNode extends ProgrammableSceneNodeBase {
  readonly kind: "video";
  readonly assetId: string;
  readonly fit?: ResizeFit;
  readonly crop?: ProgrammableSceneCrop;
  readonly sourceStartSeconds?: number;
  readonly playbackRate?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

export interface ProgrammableSceneAudioNode extends ProgrammableSceneNodeBase {
  readonly kind: "audio";
  readonly assetId: string;
  readonly sourceStartSeconds?: number;
  readonly playbackRate?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

export interface ProgrammableSceneSurfaceDescriptor {
  readonly kind: ProgrammableSceneSurfaceKind;
  /** Application-owned renderer registration key. */
  readonly rendererId: string;
  /** Serializable renderer input; functions/DOM objects are intentionally excluded. */
  readonly data?: JsonObject;
}

export interface ProgrammableSceneSurfaceNode extends ProgrammableSceneNodeBase {
  readonly kind: "surface";
  readonly surface: ProgrammableSceneSurfaceDescriptor;
}

export type ProgrammableSceneContainerNode = ProgrammableSceneGroupNode | ProgrammableSceneLayerNode;
export type ProgrammableSceneLeafNode =
  | ProgrammableSceneFillNode
  | ProgrammableSceneSolidNode
  | ProgrammableSceneShapeNode
  | ProgrammableSceneTextNode
  | ProgrammableSceneImageNode
  | ProgrammableSceneVideoNode
  | ProgrammableSceneAudioNode
  | ProgrammableSceneSurfaceNode;
export type ProgrammableSceneNode = ProgrammableSceneContainerNode | ProgrammableSceneLeafNode;

export interface ProgrammableScene {
  readonly schemaVersion: ProgrammableSceneSchemaVersion;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly background?: string;
  readonly assets: readonly ProgrammableSceneAsset[];
  readonly children: readonly ProgrammableSceneNode[];
}

export interface DefineProgrammableSceneOptions {
  readonly schemaVersion?: number;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly background?: string;
  readonly assets?: readonly ProgrammableSceneAsset[];
  readonly children?: readonly ProgrammableSceneNode[];
  readonly assetPolicy?: ProgrammableSceneAssetPolicy;
}

export interface ProgrammableSceneRenderItem {
  readonly node: ProgrammableSceneLeafNode;
  readonly path: readonly string[];
  readonly absoluteStartFrame: number;
  readonly absoluteEndFrame: number;
  readonly durationInFrames: number;
  readonly zIndex: number;
  readonly opacity: number;
  readonly transformChain: readonly ProgrammableSceneTransform[];
  readonly declarationOrder: number;
}

export interface ProgrammableSceneRenderGraph {
  readonly sceneId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly background?: string;
  readonly assets: readonly ProgrammableSceneAsset[];
  readonly items: readonly ProgrammableSceneRenderItem[];
}

export interface ProgrammableSceneAssetReadiness {
  readonly assetId: string;
  readonly status: ProgrammableSceneAssetReadinessStatus;
  readonly error?: string;
}

export interface ProgrammableSceneVideoProjectLoweringOptions {
  /**
   * Pre-resolved local/direct paths by asset id. Remote storage references require
   * an entry here so lowering cannot bypass the SDK storage/security policy.
   */
  readonly resolvedAssets?: Readonly<Record<string, string>>;
  readonly projectId?: string;
  readonly projectName?: string;
}

interface NormalizeContext {
  readonly parentDuration: number;
  readonly nodeIds: Set<string>;
  readonly assets: ReadonlyMap<string, ProgrammableSceneAsset>;
  readonly policy: Required<ProgrammableSceneAssetPolicy>;
}

const DEFAULT_ASSET_POLICY: Required<ProgrammableSceneAssetPolicy> = Object.freeze({
  allowStatic: true,
  allowLocal: true,
  allowHttp: true,
  allowObjectStorage: true
});

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}


function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidProgrammableSceneError(`${path} must contain finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`)));
  }
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(
      Object.keys(value)
        .sort(compareStableText)
        .map((key) => [key, normalizeJsonValue(value[key], `${path}.${key}`)])
    )) as JsonObject;
  }
  throw new InvalidProgrammableSceneError(`${path} must contain JSON-compatible values only.`);
}

function normalizeJsonObject(value: JsonObject, path: string): JsonObject {
  const normalized = normalizeJsonValue(value, path);
  if (!isPlainObject(normalized)) throw new InvalidProgrammableSceneError(`${path} must be a JSON object.`);
  return normalized as JsonObject;
}

function assertNonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new InvalidProgrammableSceneError(`${label} cannot be empty.`);
  return value;
}

function assertIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new InvalidProgrammableSceneError(`${label} cannot be empty.`);
  if (value !== trimmed) {
    throw new InvalidProgrammableSceneError(`${label} cannot contain leading or trailing whitespace.`);
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidProgrammableSceneError(`${label} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidProgrammableSceneError(`${label} must be an integer greater than or equal to 0.`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidProgrammableSceneError(`${label} must be finite.`);
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidProgrammableSceneError(`${label} must be a finite number greater than 0.`);
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidProgrammableSceneError(`${label} must be a finite number greater than or equal to 0.`);
  }
}

function normalizePolicy(policy: ProgrammableSceneAssetPolicy | undefined): Required<ProgrammableSceneAssetPolicy> {
  return Object.freeze({
    allowStatic: policy?.allowStatic ?? DEFAULT_ASSET_POLICY.allowStatic,
    allowLocal: policy?.allowLocal ?? DEFAULT_ASSET_POLICY.allowLocal,
    allowHttp: policy?.allowHttp ?? DEFAULT_ASSET_POLICY.allowHttp,
    allowObjectStorage: policy?.allowObjectStorage ?? DEFAULT_ASSET_POLICY.allowObjectStorage
  });
}

function normalizeStorageSource(assetId: string, source: MediaStorageSource): MediaStorageSource {
  if (source.kind === "local") {
    if (!source.path.trim()) throw new InvalidProgrammableSceneError(`asset ${assetId}.source.path cannot be empty.`, { assetId });
    return Object.freeze({ kind: "local", path: source.path });
  }

  if (source.kind === "http") {
    const url = assertNonEmpty(source.url, `asset ${assetId}.source.url`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InvalidProgrammableSceneError(`asset ${assetId}.source.url must be a valid URL.`, { assetId });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new InvalidProgrammableSceneError(`asset ${assetId}.source.url must use http or https.`, { assetId });
    }
    const headers = source.headers
      ? Object.freeze(Object.fromEntries(Object.entries(source.headers).sort(([a], [b]) => compareStableText(a, b))))
      : undefined;
    return Object.freeze({ kind: "http", url, ...(headers ? { headers } : {}) });
  }

  if (!["s3", "gcs", "azure", "custom"].includes(source.provider)) {
    throw new InvalidProgrammableSceneError(`asset ${assetId}.source.provider is not supported.`, { assetId });
  }
  if (!source.key.trim()) {
    throw new InvalidProgrammableSceneError(`asset ${assetId}.source.key cannot be empty.`, { assetId });
  }
  const metadata = source.metadata
    ? Object.freeze(Object.fromEntries(Object.entries(source.metadata).sort(([a], [b]) => compareStableText(a, b))))
    : undefined;
  return Object.freeze({
    kind: "object",
    provider: source.provider,
    ...(source.bucket !== undefined ? { bucket: source.bucket } : {}),
    ...(source.container !== undefined ? { container: source.container } : {}),
    key: source.key,
    ...(source.endpoint !== undefined ? { endpoint: source.endpoint } : {}),
    ...(metadata ? { metadata } : {})
  });
}

function assertAssetAllowed(
  assetId: string,
  source: ProgrammableSceneAssetSource,
  policy: Required<ProgrammableSceneAssetPolicy>
): void {
  if (source.kind === "static") {
    if (!policy.allowStatic) throw new ProgrammableSceneAssetPolicyError(assetId, "static assets are disabled.");
    return;
  }
  if (source.source.kind === "local") {
    if (!policy.allowLocal) throw new ProgrammableSceneAssetPolicyError(assetId, "local assets are disabled.");
    return;
  }
  if (source.source.kind === "http") {
    if (!policy.allowHttp) throw new ProgrammableSceneAssetPolicyError(assetId, "HTTP/HTTPS assets are disabled.");
    return;
  }
  if (!policy.allowObjectStorage) {
    throw new ProgrammableSceneAssetPolicyError(assetId, "object-storage assets are disabled.");
  }
}

function normalizeAsset(
  asset: ProgrammableSceneAsset,
  policy: Required<ProgrammableSceneAssetPolicy>
): ProgrammableSceneAsset {
  const id = assertIdentifier(asset.id, "scene asset id");
  if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") {
    throw new InvalidProgrammableSceneError(`asset ${id}.kind is not supported.`, { assetId: id });
  }
  let source: ProgrammableSceneAssetSource;
  if (asset.source.kind === "static") {
    const src = assertNonEmpty(asset.source.src, `asset ${id}.source.src`);
    if (/^https?:\/\//i.test(src)) {
      throw new InvalidProgrammableSceneError(
        `asset ${id}.source.src cannot be an HTTP URL; use a storage/http source so Vexa storage policy is enforced.`,
        { assetId: id }
      );
    }
    source = Object.freeze({ kind: "static", src });
  } else if (asset.source.kind === "storage") {
    source = Object.freeze({ kind: "storage", source: normalizeStorageSource(id, asset.source.source) });
  } else {
    throw new InvalidProgrammableSceneError(`asset ${id}.source kind is not supported.`, { assetId: id });
  }
  assertAssetAllowed(id, source, policy);
  const preload = asset.preload ?? "auto";
  if (preload !== "auto" && preload !== "metadata" && preload !== "none") {
    throw new InvalidProgrammableSceneError(`asset ${id}.preload is not supported.`, { assetId: id });
  }
  return Object.freeze({ id, kind: asset.kind, source, preload });
}

function normalizeCrop(crop: ProgrammableSceneCrop | undefined, nodeId: string): ProgrammableSceneCrop | undefined {
  if (!crop) return undefined;
  assertFiniteNonNegative(crop.x, `node ${nodeId}.crop.x`);
  assertFiniteNonNegative(crop.y, `node ${nodeId}.crop.y`);
  assertFinitePositive(crop.width, `node ${nodeId}.crop.width`);
  assertFinitePositive(crop.height, `node ${nodeId}.crop.height`);
  return Object.freeze({ x: crop.x, y: crop.y, width: crop.width, height: crop.height });
}

function normalizeTransform(
  transform: ProgrammableSceneTransform | undefined,
  nodeId: string
): ProgrammableSceneTransform | undefined {
  if (!transform) return undefined;
  const allowed = new Set([
    "x", "y", "width", "height", "rotation", "scaleX", "scaleY", "anchorX", "anchorY"
  ]);
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(transform)) {
    if (!allowed.has(key)) {
      throw new InvalidProgrammableSceneError(`node ${nodeId}.transform.${key} is not supported.`, { nodeId });
    }
    if (value === undefined) continue;
    assertFinite(value, `node ${nodeId}.transform.${key}`);
    if ((key === "width" || key === "height" || key === "scaleX" || key === "scaleY") && value <= 0) {
      throw new InvalidProgrammableSceneError(`node ${nodeId}.transform.${key} must be greater than 0.`, { nodeId });
    }
    normalized[key] = value;
  }
  return Object.keys(normalized).length ? Object.freeze(normalized) as ProgrammableSceneTransform : undefined;
}

function normalizeTextStyle(
  style: ProgrammableSceneTextStyle | undefined,
  nodeId: string
): ProgrammableSceneTextStyle | undefined {
  if (!style) return undefined;
  if (style.fontSize !== undefined) assertFinitePositive(style.fontSize, `node ${nodeId}.style.fontSize`);
  if (style.boxPadding !== undefined) assertFiniteNonNegative(style.boxPadding, `node ${nodeId}.style.boxPadding`);
  if (style.color !== undefined) assertNonEmpty(style.color, `node ${nodeId}.style.color`);
  if (style.fontFile !== undefined) assertNonEmpty(style.fontFile, `node ${nodeId}.style.fontFile`);
  if (style.boxColor !== undefined) assertNonEmpty(style.boxColor, `node ${nodeId}.style.boxColor`);
  return Object.freeze({
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.fontFile !== undefined ? { fontFile: style.fontFile } : {}),
    ...(style.boxColor !== undefined ? { boxColor: style.boxColor } : {}),
    ...(style.boxPadding !== undefined ? { boxPadding: style.boxPadding } : {})
  });
}

function normalizeFit(fit: ResizeFit | undefined, nodeId: string): ResizeFit | undefined {
  if (fit === undefined) return undefined;
  if (fit !== "contain" && fit !== "cover" && fit !== "fill") {
    throw new InvalidProgrammableSceneError(`node ${nodeId}.fit is not supported.`, { nodeId });
  }
  return fit;
}

function assertMediaAsset(
  nodeId: string,
  assetId: string,
  expectedKind: ProgrammableSceneAssetKind,
  assets: ReadonlyMap<string, ProgrammableSceneAsset>
): void {
  const asset = assets.get(assetId);
  if (!asset) {
    throw new InvalidProgrammableSceneError(`node ${nodeId} references missing asset "${assetId}".`, {
      nodeId,
      assetId
    });
  }
  if (asset.kind !== expectedKind) {
    throw new InvalidProgrammableSceneError(
      `node ${nodeId} requires a ${expectedKind} asset, but "${assetId}" is ${asset.kind}.`,
      { nodeId, assetId }
    );
  }
}

function normalizeNode(node: ProgrammableSceneNode, context: NormalizeContext): ProgrammableSceneNode {
  const id = assertIdentifier(node.id, "scene node id");
  if (context.nodeIds.has(id)) {
    throw new InvalidProgrammableSceneError(`Duplicate scene node id: ${id}.`, { nodeId: id });
  }
  context.nodeIds.add(id);

  const startFrame = node.startFrame ?? 0;
  assertNonNegativeInteger(startFrame, `node ${id}.startFrame`);
  if (startFrame >= context.parentDuration) {
    throw new InvalidProgrammableSceneError(`node ${id}.startFrame must be inside its parent duration.`, { nodeId: id });
  }
  const durationInFrames = node.durationInFrames ?? (context.parentDuration - startFrame);
  assertPositiveInteger(durationInFrames, `node ${id}.durationInFrames`);
  if (startFrame + durationInFrames > context.parentDuration) {
    throw new InvalidProgrammableSceneError(`node ${id} extends beyond its parent duration.`, { nodeId: id });
  }

  const zIndex = node.zIndex ?? 0;
  assertFinite(zIndex, `node ${id}.zIndex`);
  const opacity = node.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new InvalidProgrammableSceneError(`node ${id}.opacity must be between 0 and 1.`, { nodeId: id });
  }
  const transform = normalizeTransform(node.transform, id);
  const base = {
    id,
    startFrame,
    durationInFrames,
    zIndex,
    opacity,
    ...(transform ? { transform } : {})
  };

  if (node.kind === "group" || node.kind === "layer") {
    const children = node.children.map((child) => normalizeNode(child, {
      parentDuration: durationInFrames,
      nodeIds: context.nodeIds,
      assets: context.assets,
      policy: context.policy
    }));
    return Object.freeze({ ...base, kind: node.kind, children: Object.freeze(children) });
  }

  if (node.kind === "fill") {
    return Object.freeze({ ...base, kind: "fill", color: assertNonEmpty(node.color, `node ${id}.color`) });
  }

  if (node.kind === "solid") {
    assertFinitePositive(node.width, `node ${id}.width`);
    assertFinitePositive(node.height, `node ${id}.height`);
    return Object.freeze({
      ...base,
      kind: "solid",
      color: assertNonEmpty(node.color, `node ${id}.color`),
      width: node.width,
      height: node.height
    });
  }

  if (node.kind === "shape") {
    try {
      return Object.freeze({
        ...base,
        kind: "shape",
        shape: normalizeProgrammableShape(node.shape)
      });
    } catch (error) {
      if (error instanceof InvalidProgrammableShapeError) {
        throw new InvalidProgrammableSceneError(`node ${id}.shape is invalid: ${error.message}`, { nodeId: id });
      }
      throw error;
    }
  }

  if (node.kind === "text") {
    const style = normalizeTextStyle(node.style, id);
    return Object.freeze({
      ...base,
      kind: "text",
      text: assertNonEmpty(node.text, `node ${id}.text`),
      ...(style ? { style } : {})
    });
  }

  if (node.kind === "image") {
    const assetId = assertIdentifier(node.assetId, `node ${id}.assetId`);
    assertMediaAsset(id, assetId, "image", context.assets);
    const crop = normalizeCrop(node.crop, id);
    const fit = normalizeFit(node.fit, id);
    return Object.freeze({
      ...base,
      kind: "image",
      assetId,
      ...(fit !== undefined ? { fit } : {}),
      ...(crop ? { crop } : {})
    });
  }

  if (node.kind === "video" || node.kind === "audio") {
    const assetId = assertIdentifier(node.assetId, `node ${id}.assetId`);
    assertMediaAsset(id, assetId, node.kind, context.assets);
    const sourceStartSeconds = node.sourceStartSeconds ?? 0;
    assertFiniteNonNegative(sourceStartSeconds, `node ${id}.sourceStartSeconds`);
    const playbackRate = node.playbackRate ?? 1;
    assertFinitePositive(playbackRate, `node ${id}.playbackRate`);
    const volume = node.volume ?? 1;
    assertFiniteNonNegative(volume, `node ${id}.volume`);
    const muted = node.muted ?? false;

    if (node.kind === "audio") {
      return Object.freeze({
        ...base,
        kind: "audio",
        assetId,
        sourceStartSeconds,
        playbackRate,
        volume,
        muted
      });
    }

    const crop = normalizeCrop(node.crop, id);
    const fit = normalizeFit(node.fit, id);
    return Object.freeze({
      ...base,
      kind: "video",
      assetId,
      ...(fit !== undefined ? { fit } : {}),
      ...(crop ? { crop } : {}),
      sourceStartSeconds,
      playbackRate,
      volume,
      muted
    });
  }

  if (node.kind === "surface") {
    const rendererId = assertIdentifier(node.surface.rendererId, `node ${id}.surface.rendererId`);
    if (node.surface.kind !== "svg" && node.surface.kind !== "canvas") {
      throw new InvalidProgrammableSceneError(`node ${id}.surface.kind is not supported.`, { nodeId: id });
    }
    return Object.freeze({
      ...base,
      kind: "surface",
      surface: Object.freeze({
        kind: node.surface.kind,
        rendererId,
        ...(node.surface.data !== undefined
          ? { data: normalizeJsonObject(node.surface.data, `node ${id}.surface.data`) }
          : {})
      })
    });
  }

  const exhaustive: never = node;
  return exhaustive;
}

export function defineProgrammableScene(options: DefineProgrammableSceneOptions): ProgrammableScene {
  if ((options.schemaVersion ?? PROGRAMMABLE_SCENE_SCHEMA_VERSION) !== PROGRAMMABLE_SCENE_SCHEMA_VERSION) {
    throw new InvalidProgrammableSceneError(
      `Unsupported programmable scene schema version: ${String(options.schemaVersion)}.`
    );
  }
  const id = assertIdentifier(options.id, "scene id");
  assertPositiveInteger(options.width, `scene ${id}.width`);
  assertPositiveInteger(options.height, `scene ${id}.height`);
  assertFinitePositive(options.fps, `scene ${id}.fps`);
  assertPositiveInteger(options.durationInFrames, `scene ${id}.durationInFrames`);
  if (options.background !== undefined) assertNonEmpty(options.background, `scene ${id}.background`);

  const policy = normalizePolicy(options.assetPolicy);
  const assets = (options.assets ?? []).map((asset) => normalizeAsset(asset, policy));
  assets.sort((left, right) => compareStableText(left.id, right.id));
  const assetMap = new Map<string, ProgrammableSceneAsset>();
  for (const asset of assets) {
    if (assetMap.has(asset.id)) {
      throw new InvalidProgrammableSceneError(`Duplicate scene asset id: ${asset.id}.`, { assetId: asset.id });
    }
    assetMap.set(asset.id, asset);
  }

  const nodeIds = new Set<string>();
  const children = (options.children ?? []).map((node) => normalizeNode(node, {
    parentDuration: options.durationInFrames,
    nodeIds,
    assets: assetMap,
    policy
  }));

  return Object.freeze({
    schemaVersion: PROGRAMMABLE_SCENE_SCHEMA_VERSION,
    id,
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationInFrames: options.durationInFrames,
    ...(options.background !== undefined ? { background: options.background } : {}),
    assets: Object.freeze(assets),
    children: Object.freeze(children)
  });
}

export function normalizeProgrammableScene(scene: ProgrammableScene): ProgrammableScene {
  return defineProgrammableScene({
    schemaVersion: scene.schemaVersion,
    id: scene.id,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    durationInFrames: scene.durationInFrames,
    ...(scene.background !== undefined ? { background: scene.background } : {}),
    assets: scene.assets,
    children: scene.children
  });
}

export function serializeProgrammableScene(scene: ProgrammableScene): string {
  return JSON.stringify(normalizeProgrammableScene(scene));
}

export function createProgrammableSceneRenderGraph(scene: ProgrammableScene): ProgrammableSceneRenderGraph {
  const normalized = normalizeProgrammableScene(scene);
  const items: ProgrammableSceneRenderItem[] = [];
  let declarationOrder = 0;

  const visit = (
    nodes: readonly ProgrammableSceneNode[],
    parentStartFrame: number,
    parentZIndex: number,
    parentOpacity: number,
    path: readonly string[],
    transformChain: readonly ProgrammableSceneTransform[]
  ): void => {
    for (const node of nodes) {
      const absoluteStartFrame = parentStartFrame + (node.startFrame ?? 0);
      const durationInFrames = node.durationInFrames!;
      const nodeZIndex = parentZIndex + (node.zIndex ?? 0);
      const nodeOpacity = parentOpacity * (node.opacity ?? 1);
      const nodePath = Object.freeze([...path, node.id]);
      const nextTransformChain = node.transform
        ? Object.freeze([...transformChain, node.transform])
        : transformChain;

      if (node.kind === "group" || node.kind === "layer") {
        visit(
          node.children,
          absoluteStartFrame,
          nodeZIndex,
          nodeOpacity,
          nodePath,
          nextTransformChain
        );
        continue;
      }

      items.push(Object.freeze({
        node,
        path: nodePath,
        absoluteStartFrame,
        absoluteEndFrame: absoluteStartFrame + durationInFrames,
        durationInFrames,
        zIndex: nodeZIndex,
        opacity: nodeOpacity,
        transformChain: nextTransformChain,
        declarationOrder
      }));
      declarationOrder += 1;
    }
  };

  visit(normalized.children, 0, 0, 1, Object.freeze([]), Object.freeze([]));
  items.sort((left, right) => left.zIndex - right.zIndex || left.declarationOrder - right.declarationOrder);

  return Object.freeze({
    sceneId: normalized.id,
    width: normalized.width,
    height: normalized.height,
    fps: normalized.fps,
    durationInFrames: normalized.durationInFrames,
    ...(normalized.background !== undefined ? { background: normalized.background } : {}),
    assets: normalized.assets,
    items: Object.freeze(items)
  });
}

export function collectProgrammableSceneAssets(scene: ProgrammableScene): readonly ProgrammableSceneAsset[] {
  return normalizeProgrammableScene(scene).assets;
}

export function createProgrammableSceneAssetReadiness(
  scene: ProgrammableScene
): readonly ProgrammableSceneAssetReadiness[] {
  return Object.freeze(
    normalizeProgrammableScene(scene).assets.map((asset) => Object.freeze({
      assetId: asset.id,
      status: "idle" as const
    }))
  );
}

export function updateProgrammableSceneAssetReadiness(
  states: readonly ProgrammableSceneAssetReadiness[],
  assetId: string,
  status: ProgrammableSceneAssetReadinessStatus,
  error?: string
): readonly ProgrammableSceneAssetReadiness[] {
  let found = false;
  const updated = states.map((state) => {
    if (state.assetId !== assetId) return state;
    found = true;
    if (status === "error") {
      const message = assertNonEmpty(error ?? "Unknown asset loading error.", `asset ${assetId}.error`);
      return Object.freeze({ assetId, status, error: message });
    }
    return Object.freeze({ assetId, status });
  });
  if (!found) throw new InvalidProgrammableSceneError(`Asset readiness state was not found: ${assetId}.`, { assetId });
  return Object.freeze(updated);
}

export function programmableSceneAssetsReady(
  states: readonly ProgrammableSceneAssetReadiness[],
  requiredAssetIds?: readonly string[]
): boolean {
  const required = requiredAssetIds ? new Set(requiredAssetIds) : null;
  return states.every((state) => (required && !required.has(state.assetId)) || state.status === "ready");
}

function assetById(scene: ProgrammableScene, assetId: string): ProgrammableSceneAsset {
  const asset = scene.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new InvalidProgrammableSceneError(`Missing scene asset: ${assetId}.`, { assetId });
  return asset;
}

function resolveAssetForProject(
  asset: ProgrammableSceneAsset,
  options: ProgrammableSceneVideoProjectLoweringOptions
): string {
  const resolved = options.resolvedAssets?.[asset.id];
  if (resolved !== undefined) return assertNonEmpty(resolved, `resolved asset ${asset.id}`);
  if (asset.source.kind === "static") return asset.source.src;
  if (asset.source.source.kind === "local") return asset.source.source.path;
  throw new ProgrammableSceneAssetUnresolvedError(asset.id);
}

function lowerTransform(
  item: ProgrammableSceneRenderItem,
  fit?: ResizeFit
): ClipTransform | undefined {
  let x = 0;
  let y = 0;
  let hasExplicitX = false;
  let hasExplicitY = false;
  let rotation: number | undefined;
  let width: number | undefined;
  let height: number | undefined;

  for (let index = 0; index < item.transformChain.length; index += 1) {
    const transform = item.transformChain[index]!;
    const isLeafTransform =
      item.node.transform !== undefined &&
      transform === item.node.transform &&
      index === item.transformChain.length - 1;
    if (
      transform.scaleX !== undefined ||
      transform.scaleY !== undefined ||
      transform.anchorX !== undefined ||
      transform.anchorY !== undefined
    ) {
      throw new UnsupportedProgrammableSceneLoweringError(
        item.node.id,
        "scale/anchor transforms require the frame-render path."
      );
    }
    if (!isLeafTransform && (transform.width !== undefined || transform.height !== undefined || transform.rotation !== undefined)) {
      throw new UnsupportedProgrammableSceneLoweringError(
        item.node.id,
        "ancestor width/height/rotation transforms cannot be represented by VideoProjectAst."
      );
    }
    if (transform.x !== undefined) {
      x += transform.x;
      hasExplicitX = true;
    }
    if (transform.y !== undefined) {
      y += transform.y;
      hasExplicitY = true;
    }
    if (transform.rotation !== undefined) rotation = transform.rotation;
    if (transform.width !== undefined) width = transform.width;
    if (transform.height !== undefined) height = transform.height;
  }

  const result = {
    ...(hasExplicitX ? { x } : {}),
    ...(hasExplicitY ? { y } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(fit !== undefined ? { fit } : {})
  };
  return Object.keys(result).length ? result : undefined;
}

function lowerTextStyle(style: ProgrammableSceneTextStyle | undefined): TextStyle | undefined {
  if (!style) return undefined;
  const result: TextStyle = {
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.fontFile !== undefined ? { fontFile: style.fontFile } : {}),
    ...(style.boxColor !== undefined ? { boxColor: style.boxColor } : {}),
    ...(style.boxPadding !== undefined ? { boxPadding: style.boxPadding } : {})
  };
  return Object.keys(result).length ? result : undefined;
}

function assertProjectRepresentable(item: ProgrammableSceneRenderItem): void {
  const node = item.node;
  if (node.kind === "solid" || node.kind === "shape" || node.kind === "surface") {
    throw new UnsupportedProgrammableSceneLoweringError(node.id, `${node.kind} nodes require the frame-render path.`);
  }
  if ((node.kind === "image" || node.kind === "video") && node.crop) {
    throw new UnsupportedProgrammableSceneLoweringError(node.id, "crop requires a scene/frame render backend before project lowering.");
  }
  if ((node.kind === "video" || node.kind === "audio") && node.playbackRate !== 1) {
    throw new UnsupportedProgrammableSceneLoweringError(node.id, "playbackRate values other than 1 are not supported by VideoProjectAst yet.");
  }
}

export function lowerProgrammableSceneToVideoProject(
  scene: ProgrammableScene,
  options: ProgrammableSceneVideoProjectLoweringOptions = {}
): VideoProjectAst {
  const normalized = normalizeProgrammableScene(scene);
  const graph = createProgrammableSceneRenderGraph(normalized);
  const tracks: ProjectTrack[] = [];
  let background = normalized.background;
  let backgroundFillNodeId: string | undefined;

  for (const item of graph.items) {
    assertProjectRepresentable(item);
    const node = item.node;

    if (node.kind === "fill") {
      if (
        item.path.length !== 1 ||
        item.absoluteStartFrame !== 0 ||
        item.durationInFrames !== normalized.durationInFrames ||
        item.opacity !== 1 ||
        item.transformChain.length !== 0
      ) {
        throw new UnsupportedProgrammableSceneLoweringError(
          node.id,
          "only a root, full-duration, fully opaque fill can lower to the project background."
        );
      }
      const earlierVisual = graph.items.some((candidate) =>
        candidate !== item &&
        candidate.node.kind !== "audio" &&
        (candidate.zIndex < item.zIndex ||
          (candidate.zIndex === item.zIndex && candidate.declarationOrder < item.declarationOrder))
      );
      if (earlierVisual) {
        throw new UnsupportedProgrammableSceneLoweringError(
          node.id,
          "a fill can lower to the project background only when it is the bottom-most visual node."
        );
      }
      if (backgroundFillNodeId !== undefined) {
        throw new UnsupportedProgrammableSceneLoweringError(
          node.id,
          `multiple fill nodes (${backgroundFillNodeId}, ${node.id}) cannot collapse into one project background.`
        );
      }
      if (background !== undefined && background !== node.color) {
        throw new UnsupportedProgrammableSceneLoweringError(
          node.id,
          "the fill conflicts with scene.background."
        );
      }
      backgroundFillNodeId = node.id;
      background = node.color;
      continue;
    }

    const start = frameToSeconds(item.absoluteStartFrame, normalized.fps);
    const duration = frameToSeconds(item.durationInFrames, normalized.fps);
    const common = {
      id: node.id,
      start,
      duration,
      opacity: item.opacity
    };

    let track: ProjectTrack;
    if (node.kind === "text") {
      const transform = lowerTransform(item);
      const style = lowerTextStyle(node.style);
      const clip: TimelineClip = {
        ...common,
        kind: "text",
        text: node.text,
        ...(transform ? { transform } : {}),
        ...(style ? { style } : {})
      };
      track = { id: `scene:${node.id}`, type: "text", clips: [clip] };
    } else if (node.kind === "image") {
      const asset = assetById(normalized, node.assetId);
      const transform = lowerTransform(item, node.fit);
      const clip: TimelineClip = {
        ...common,
        kind: "image",
        source: resolveAssetForProject(asset, options),
        ...(transform ? { transform } : {})
      };
      track = { id: `scene:${node.id}`, type: "image", clips: [clip] };
    } else if (node.kind === "video") {
      const asset = assetById(normalized, node.assetId);
      const transform = lowerTransform(item, node.fit);
      const clip: TimelineClip = {
        ...common,
        kind: "video",
        source: resolveAssetForProject(asset, options),
        sourceStart: node.sourceStartSeconds ?? 0,
        includeAudio: !(node.muted ?? false),
        volume: (node.muted ?? false) ? 0 : (node.volume ?? 1),
        ...(transform ? { transform } : {})
      };
      track = { id: `scene:${node.id}`, type: "video", clips: [clip] };
    } else if (node.kind === "audio") {
      const asset = assetById(normalized, node.assetId);
      const clip: TimelineClip = {
        id: node.id,
        kind: "audio",
        source: resolveAssetForProject(asset, options),
        start,
        duration,
        sourceStart: node.sourceStartSeconds ?? 0,
        volume: (node.muted ?? false) ? 0 : (node.volume ?? 1)
      };
      track = { id: `scene:${node.id}`, type: "audio", muted: node.muted ?? false, clips: [clip] };
    } else if (node.kind === "solid" || node.kind === "shape" || node.kind === "surface") {
      throw new UnsupportedProgrammableSceneLoweringError(node.id, `${node.kind} nodes require the frame-render path.`);
    } else {
      const exhaustive: never = node;
      return exhaustive;
    }
    tracks.push(Object.freeze(track));
  }

  return Object.freeze({
    schemaVersion: 1,
    id: options.projectId ?? `scene:${normalized.id}`,
    ...(options.projectName !== undefined ? { name: options.projectName } : {}),
    canvas: Object.freeze({
      width: normalized.width,
      height: normalized.height,
      fps: normalized.fps,
      duration: frameToSeconds(normalized.durationInFrames, normalized.fps),
      ...(background !== undefined ? { background } : {})
    }),
    tracks: Object.freeze(tracks)
  });
}

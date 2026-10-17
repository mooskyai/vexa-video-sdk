import type { JsonObject, JsonValue } from "./programmable-composition.js";

export type HostedRenderState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface HostedRenderRequest<TPayload = unknown> {
  schemaVersion: 1;
  type: string;
  payload: TPayload;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HostedRenderProgress {
  percent?: number;
  phase?: string;
  message?: string;
  updatedAt?: string;
}

export interface HostedRenderArtifact {
  url: string;
  name?: string;
  contentType?: string;
  sizeBytes?: number;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HostedRenderFailure {
  message: string;
  code?: string;
  retryable?: boolean;
}

export interface HostedRenderJob<TResult = unknown> {
  id: string;
  state: HostedRenderState;
  createdAt?: string;
  updatedAt?: string;
  progress?: HostedRenderProgress;
  result?: TResult;
  artifacts?: readonly HostedRenderArtifact[];
  error?: HostedRenderFailure;
}

export interface HostedRenderCallOptions {
  signal?: AbortSignal;
}

export interface HostedRenderWaitOptions extends HostedRenderCallOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export const HOSTED_COMPOSITION_RENDER_TYPE = "composition.render" as const;

export interface HostedCompositionBundleReference {
  readonly id: string;
  /** Provider-resolved bundle manifest reference; Vexa does not interpret it as a local path. */
  readonly manifest: string;
  readonly integrity?: string;
}

export type HostedCompositionImageFormat = "png" | "jpeg" | "webp";
export type HostedCompositionVideoContainer = "mp4" | "webm";

export type HostedCompositionRenderTarget =
  | { readonly kind: "still"; readonly format?: HostedCompositionImageFormat }
  | { readonly kind: "frame"; readonly frame: number; readonly format?: HostedCompositionImageFormat }
  | {
      readonly kind: "frame-range";
      readonly startFrame: number;
      readonly endFrameExclusive: number;
      readonly format?: HostedCompositionImageFormat;
    }
  | {
      readonly kind: "video";
      readonly startFrame?: number;
      readonly endFrameExclusive?: number;
      readonly container?: HostedCompositionVideoContainer;
    };

export interface HostedCompositionOutputReference {
  /** Stable caller/provider identity used to make retries idempotent. */
  readonly artifactId: string;
  /** Optional provider-owned remote destination reference. */
  readonly destination?: string;
  readonly contentType?: string;
}

export interface HostedCompositionRenderPayload {
  readonly schemaVersion: 1;
  readonly bundle: HostedCompositionBundleReference;
  readonly compositionId: string;
  readonly target: HostedCompositionRenderTarget;
  readonly inputProps?: JsonObject;
  readonly output: HostedCompositionOutputReference;
}

export interface HostedCompositionRenderRequestOptions {
  readonly idempotencyKey?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export type HostedCompositionRenderRequest = HostedRenderRequest<HostedCompositionRenderPayload> & {
  readonly type: typeof HOSTED_COMPOSITION_RENDER_TYPE;
};

function hostedText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function hostedOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return hostedText(value, label);
}

function hostedImageFormat(value: unknown): HostedCompositionImageFormat | undefined {
  if (value === undefined) return undefined;
  if (value !== "png" && value !== "jpeg" && value !== "webp") {
    throw new TypeError("hosted composition image format must be png, jpeg, or webp.");
  }
  return value;
}

function hostedVideoContainer(value: unknown): HostedCompositionVideoContainer | undefined {
  if (value === undefined) return undefined;
  if (value !== "mp4" && value !== "webm") {
    throw new TypeError("hosted composition video container must be mp4 or webm.");
  }
  return value;
}

function hostedFrame(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeHostedJson(
  value: unknown,
  path: string,
  seen = new WeakSet<object>()
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite numbers only.`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain JSON-compatible values only.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} must not contain circular references.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item, index) => normalizeHostedJson(item, `${path}[${index}]`, seen))
      );
    }
    if (isPlainJsonObject(value)) {
      const normalized = Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, normalizeHostedJson(value[key], `${path}.${key}`, seen)])
      ) as Record<string, JsonValue>;
      return Object.freeze(normalized);
    }
  } finally {
    seen.delete(value);
  }
  throw new TypeError(`${path} must contain plain JSON objects only.`);
}

function normalizeTarget(target: HostedCompositionRenderTarget): HostedCompositionRenderTarget {
  if (!target || typeof target !== "object") throw new TypeError("hosted composition target is required.");
  switch (target.kind) {
    case "still": {
      const format = hostedImageFormat(target.format);
      return Object.freeze({ kind: "still", ...(format ? { format } : {}) });
    }
    case "frame": {
      const format = hostedImageFormat(target.format);
      return Object.freeze({
        kind: "frame",
        frame: hostedFrame(target.frame, "hosted composition target.frame"),
        ...(format ? { format } : {})
      });
    }
    case "frame-range": {
      const startFrame = hostedFrame(target.startFrame, "hosted composition target.startFrame");
      const endFrameExclusive = hostedFrame(
        target.endFrameExclusive,
        "hosted composition target.endFrameExclusive"
      );
      if (endFrameExclusive <= startFrame) {
        throw new TypeError("hosted composition target.endFrameExclusive must be greater than startFrame.");
      }
      const format = hostedImageFormat(target.format);
      return Object.freeze({
        kind: "frame-range",
        startFrame,
        endFrameExclusive,
        ...(format ? { format } : {})
      });
    }
    case "video": {
      const hasStart = target.startFrame !== undefined;
      const hasEnd = target.endFrameExclusive !== undefined;
      if (hasStart !== hasEnd) {
        throw new TypeError("hosted composition video ranges require both startFrame and endFrameExclusive.");
      }
      const range = hasStart
        ? (() => {
            const startFrame = hostedFrame(target.startFrame!, "hosted composition target.startFrame");
            const endFrameExclusive = hostedFrame(
              target.endFrameExclusive!,
              "hosted composition target.endFrameExclusive"
            );
            if (endFrameExclusive <= startFrame) {
              throw new TypeError("hosted composition target.endFrameExclusive must be greater than startFrame.");
            }
            return { startFrame, endFrameExclusive };
          })()
        : {};
      const container = hostedVideoContainer(target.container);
      return Object.freeze({
        kind: "video",
        ...range,
        ...(container ? { container } : {})
      });
    }
    default:
      throw new TypeError("Unsupported hosted composition render target.");
  }
}

export function createHostedCompositionRenderRequest(
  payload: HostedCompositionRenderPayload,
  options: HostedCompositionRenderRequestOptions = {}
): HostedCompositionRenderRequest {
  if (!payload || payload.schemaVersion !== 1) {
    throw new TypeError("Hosted composition render payloads require schemaVersion 1.");
  }
  const inputProps = payload.inputProps === undefined
    ? undefined
    : normalizeHostedJson(payload.inputProps, "hosted composition inputProps");
  if (inputProps !== undefined && !isPlainJsonObject(inputProps)) {
    throw new TypeError("hosted composition inputProps must be a JSON object.");
  }
  const idempotencyKey = options.idempotencyKey === undefined
    ? undefined
    : hostedText(options.idempotencyKey, "hosted composition idempotencyKey");
  if (idempotencyKey !== undefined && idempotencyKey.length > 256) {
    throw new TypeError("hosted composition idempotencyKey must be 256 characters or less.");
  }
  const metadata = options.metadata === undefined
    ? undefined
    : Object.freeze(
        Object.fromEntries(
          Object.entries(options.metadata)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => {
              if (typeof value === "number" && !Number.isFinite(value)) {
                throw new TypeError(`hosted composition metadata.${key} must be finite.`);
              }
              return [key, value] as const;
            })
        )
      );

  return Object.freeze({
    schemaVersion: 1,
    type: HOSTED_COMPOSITION_RENDER_TYPE,
    payload: Object.freeze({
      schemaVersion: 1,
      bundle: Object.freeze({
        id: hostedText(payload.bundle?.id, "hosted composition bundle.id"),
        manifest: hostedText(payload.bundle?.manifest, "hosted composition bundle.manifest"),
        ...(() => {
          const integrity = hostedOptionalText(payload.bundle?.integrity, "hosted composition bundle.integrity");
          return integrity ? { integrity } : {};
        })()
      }),
      compositionId: hostedText(payload.compositionId, "hosted composition compositionId"),
      target: normalizeTarget(payload.target),
      ...(inputProps === undefined ? {} : { inputProps: inputProps as JsonObject }),
      output: Object.freeze({
        artifactId: hostedText(payload.output?.artifactId, "hosted composition output.artifactId"),
        ...(() => {
          const destination = hostedOptionalText(
            payload.output?.destination,
            "hosted composition output.destination"
          );
          return destination ? { destination } : {};
        })(),
        ...(() => {
          const contentType = hostedOptionalText(
            payload.output?.contentType,
            "hosted composition output.contentType"
          );
          return contentType ? { contentType } : {};
        })()
      })
    }),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(metadata ? { metadata } : {})
  });
}

export interface HostedRenderAdapter {
  submit<TPayload = unknown, TResult = unknown>(
    request: HostedRenderRequest<TPayload>,
    options?: HostedRenderCallOptions
  ): Promise<HostedRenderJob<TResult>>;

  get<TResult = unknown>(
    jobId: string,
    options?: HostedRenderCallOptions
  ): Promise<HostedRenderJob<TResult>>;

  cancel<TResult = unknown>(
    jobId: string,
    options?: HostedRenderCallOptions
  ): Promise<HostedRenderJob<TResult>>;
}

export function isHostedRenderTerminal(state: HostedRenderState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

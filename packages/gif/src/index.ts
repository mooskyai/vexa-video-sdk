import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ProcessAbortedError, ProcessTimeoutError } from "@vexa-video/core";
import {
  probeMedia,
  resolveMediaBinaries,
  runProcess,
  type MediaBinaries
} from "@vexa-video/ffmpeg";
import type {
  VexaSurfaceFrameRendererAdapterContext,
  VexaSurfaceRendererAdapter
} from "@vexa-video/renderer";

export const VEXA_GIF_SURFACE_RENDERER_ID = "vexa.gif" as const;

export type VexaGifFit = "contain" | "cover" | "stretch";

export type VexaGifAdapterErrorCode =
  | "INVALID_GIF_ADAPTER_OPTIONS"
  | "INVALID_GIF_SURFACE_DATA"
  | "GIF_SOURCE_UNAVAILABLE"
  | "GIF_SOURCE_UNSUPPORTED"
  | "GIF_FRAME_RENDER_FAILED";

export class VexaGifAdapterError extends Error {
  readonly code: VexaGifAdapterErrorCode;
  readonly sourceId?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: VexaGifAdapterErrorCode,
    options: { readonly sourceId?: string; readonly cause?: unknown } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.sourceId !== undefined) this.sourceId = options.sourceId;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface VexaGifSource {
  readonly path: string;
  /** Loop the GIF timeline when the authored surface lasts longer than the source. */
  readonly loop?: boolean;
}

export interface VexaGifSurfaceData {
  readonly sourceId: string;
  readonly fit?: VexaGifFit;
  /** Per-surface override for the configured source loop behavior. */
  readonly loop?: boolean;
}

export interface VexaGifSurfaceAdapterOptions {
  readonly rendererId?: string;
  readonly sources: Readonly<Record<string, string | VexaGifSource>>;
  readonly baseDirectory?: string;
  readonly workspaceRoot?: string;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly timeoutMs?: number;
}

type SurfaceDescriptor = Parameters<NonNullable<VexaSurfaceRendererAdapter["renderFrame"]>>[0];

interface NormalizedGifSource {
  readonly path: string;
  readonly loop: boolean;
}

interface NormalizedGifSurfaceData {
  readonly sourceId: string;
  readonly fit: VexaGifFit;
  readonly loop?: boolean;
}

interface GifSourceMetadata {
  readonly durationSeconds: number;
  readonly fps: number | null;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VexaGifAdapterError(
      `${label} must be a non-empty string.`,
      "INVALID_GIF_ADAPTER_OPTIONS"
    );
  }
  return value.trim();
}

function normalizeTimeoutMs(value: number | undefined): number {
  const normalized = value ?? 30_000;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new VexaGifAdapterError(
      "timeoutMs must be a positive safe integer.",
      "INVALID_GIF_ADAPTER_OPTIONS"
    );
  }
  return normalized;
}

function normalizeSources(
  sources: Readonly<Record<string, string | VexaGifSource>>,
  baseDirectory: string
): ReadonlyMap<string, NormalizedGifSource> {
  if (!sources || typeof sources !== "object") {
    throw new VexaGifAdapterError(
      "sources must be a sourceId-to-file map.",
      "INVALID_GIF_ADAPTER_OPTIONS"
    );
  }

  const normalized = new Map<string, NormalizedGifSource>();
  for (const [rawSourceId, value] of Object.entries(sources)) {
    const sourceId = assertNonEmptyText(rawSourceId, "GIF sourceId");
    if (normalized.has(sourceId)) {
      throw new VexaGifAdapterError(
        `GIF sourceId "${sourceId}" is duplicated after normalization.`,
        "INVALID_GIF_ADAPTER_OPTIONS"
      );
    }
    const rawPath = typeof value === "string" ? value : value?.path;
    const sourcePath = assertNonEmptyText(rawPath, `GIF source "${sourceId}" path`);
    const rawLoop = typeof value === "string" ? undefined : value?.loop;
    if (rawLoop !== undefined && typeof rawLoop !== "boolean") {
      throw new VexaGifAdapterError(
        `GIF source "${sourceId}" loop must be boolean when provided.`,
        "INVALID_GIF_ADAPTER_OPTIONS"
      );
    }
    const absolutePath = isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(baseDirectory, sourcePath);
    normalized.set(sourceId, Object.freeze({
      path: absolutePath,
      loop: rawLoop ?? true
    }));
  }

  if (normalized.size === 0) {
    throw new VexaGifAdapterError(
      "sources must contain at least one GIF source.",
      "INVALID_GIF_ADAPTER_OPTIONS"
    );
  }
  return normalized;
}

function normalizeSurfaceData(surface: SurfaceDescriptor): NormalizedGifSurfaceData {
  const data = surface.data;
  const sourceId = data?.sourceId;
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    throw new VexaGifAdapterError(
      "GIF surface data requires a non-empty sourceId.",
      "INVALID_GIF_SURFACE_DATA"
    );
  }
  const fit = data?.fit ?? "contain";
  if (fit !== "contain" && fit !== "cover" && fit !== "stretch") {
    throw new VexaGifAdapterError(
      `GIF surface fit must be contain, cover, or stretch; received ${String(fit)}.`,
      "INVALID_GIF_SURFACE_DATA",
      { sourceId: sourceId.trim() }
    );
  }
  const loop = data?.loop;
  if (loop !== undefined && typeof loop !== "boolean") {
    throw new VexaGifAdapterError(
      "GIF surface loop must be boolean when provided.",
      "INVALID_GIF_SURFACE_DATA",
      { sourceId: sourceId.trim() }
    );
  }
  return Object.freeze({
    sourceId: sourceId.trim(),
    fit,
    ...(loop !== undefined ? { loop } : {})
  });
}

function validateGifProbe(
  sourceId: string,
  result: Awaited<ReturnType<typeof probeMedia>>
): GifSourceMetadata {
  const formatNames = (result.format ?? "").split(",").map((value) => value.trim());
  if (!formatNames.includes("gif") && result.video?.codec !== "gif") {
    throw new VexaGifAdapterError(
      `Configured source "${sourceId}" is not a GIF media source.`,
      "GIF_SOURCE_UNSUPPORTED",
      { sourceId }
    );
  }
  const durationSeconds = result.durationSeconds;
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new VexaGifAdapterError(
      `GIF source "${sourceId}" does not expose a positive duration.`,
      "GIF_SOURCE_UNSUPPORTED",
      { sourceId }
    );
  }
  const fps = result.video?.fps;
  return Object.freeze({
    durationSeconds,
    fps: fps !== null && fps !== undefined && Number.isFinite(fps) && fps > 0 ? fps : null
  });
}

function frameTimeSeconds(
  context: VexaSurfaceFrameRendererAdapterContext,
  metadata: GifSourceMetadata,
  loop: boolean
): number {
  const requested = context.localFrame / context.fps;
  if (loop) return requested % metadata.durationSeconds;
  const sourceFrameDuration = 1 / (metadata.fps ?? context.fps);
  const lastFrameStart = Math.max(0, metadata.durationSeconds - sourceFrameDuration);
  return Math.min(requested, lastFrameStart);
}

function formatSeconds(value: number): string {
  return String(Number(value.toFixed(9)));
}

function scaleFilter(width: number, height: number, fit: VexaGifFit): string {
  if (fit === "stretch") {
    return `scale=${width}:${height}:flags=lanczos,format=rgba`;
  }
  if (fit === "cover") {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},format=rgba`;
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba`;
}

export function createGifSurfaceAdapter(
  options: VexaGifSurfaceAdapterOptions
): VexaSurfaceRendererAdapter {
  if (!options || typeof options !== "object") {
    throw new VexaGifAdapterError(
      "GIF adapter options are required.",
      "INVALID_GIF_ADAPTER_OPTIONS"
    );
  }

  const rendererId = options.rendererId === undefined
    ? VEXA_GIF_SURFACE_RENDERER_ID
    : assertNonEmptyText(options.rendererId, "rendererId");
  const baseDirectory = resolve(options.baseDirectory ?? process.cwd());
  const workspaceRoot = resolve(options.workspaceRoot ?? tmpdir());
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const sources = normalizeSources(options.sources, baseDirectory);
  let binariesPromise: Promise<MediaBinaries> | undefined;
  const metadataByPath = new Map<string, GifSourceMetadata>();

  const resolveBinaries = (): Promise<MediaBinaries> => {
    binariesPromise ??= resolveMediaBinaries({
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {})
    });
    return binariesPromise;
  };

  const metadataFor = async (
    sourceId: string,
    source: NormalizedGifSource,
    context: VexaSurfaceFrameRendererAdapterContext
  ): Promise<GifSourceMetadata> => {
    const cached = metadataByPath.get(source.path);
    if (cached) return cached;
    const binaries = await resolveBinaries();
    try {
      const result = await probeMedia(source.path, binaries.ffprobe, {
        ...(context.signal ? { signal: context.signal } : {}),
        timeoutMs
      });
      const metadata = validateGifProbe(sourceId, result);
      metadataByPath.set(source.path, metadata);
      return metadata;
    } catch (cause) {
      if (
        cause instanceof VexaGifAdapterError ||
        cause instanceof ProcessAbortedError ||
        cause instanceof ProcessTimeoutError
      ) throw cause;
      throw new VexaGifAdapterError(
        `GIF source "${sourceId}" could not be probed: ${cause instanceof Error ? cause.message : String(cause)}.`,
        "GIF_SOURCE_UNAVAILABLE",
        { sourceId, cause }
      );
    }
  };

  return Object.freeze({
    rendererId,
    async renderFrame(
      surface: SurfaceDescriptor,
      context: VexaSurfaceFrameRendererAdapterContext
    ) {
      if (context.signal?.aborted) throw new ProcessAbortedError();
      const data = normalizeSurfaceData(surface);
      const source = sources.get(data.sourceId);
      if (!source) {
        throw new VexaGifAdapterError(
          `GIF sourceId "${data.sourceId}" is not configured for renderer "${rendererId}".`,
          "GIF_SOURCE_UNAVAILABLE",
          { sourceId: data.sourceId }
        );
      }

      const metadata = await metadataFor(data.sourceId, source, context);
      const binaries = await resolveBinaries();
      await mkdir(workspaceRoot, { recursive: true });
      const workspace = await mkdtemp(join(workspaceRoot, "vexa-gif-"));
      const target = join(workspace, "frame.png");
      const seconds = frameTimeSeconds(context, metadata, data.loop ?? source.loop);

      try {
        await runProcess(
          binaries.ffmpeg,
          [
            "-v",
            "error",
            "-y",
            "-ignore_loop",
            "1",
            "-i",
            source.path,
            "-ss",
            formatSeconds(seconds),
            "-frames:v",
            "1",
            "-an",
            "-vf",
            scaleFilter(context.width, context.height, data.fit),
            "-c:v",
            "png",
            "-pix_fmt",
            "rgba",
            target
          ],
          {
            ...(context.signal ? { signal: context.signal } : {}),
            timeoutMs
          }
        );
        const png = await readFile(target);
        return Object.freeze({ kind: "png" as const, png });
      } catch (cause) {
        if (
          context.signal?.aborted ||
          cause instanceof ProcessAbortedError ||
          cause instanceof ProcessTimeoutError
        ) throw cause;
        throw new VexaGifAdapterError(
          `GIF source "${data.sourceId}" could not render local frame ${context.localFrame}: ${cause instanceof Error ? cause.message : String(cause)}.`,
          "GIF_FRAME_RENDER_FAILED",
          { sourceId: data.sourceId, cause }
        );
      } finally {
        await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });
}

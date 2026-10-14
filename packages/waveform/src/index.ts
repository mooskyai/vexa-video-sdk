import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  InvalidOperationError,
  ProcessAbortedError,
  ProcessTimeoutError
} from "@vexa-video/core";
import {
  compileWaveformArgs,
  generateWaveform,
  probeMedia,
  resolveMediaBinaries,
  type MediaBinaries
} from "@vexa-video/ffmpeg";
import type {
  VexaSurfaceRendererAdapter,
  VexaSurfaceRendererAdapterContext
} from "@vexa-video/renderer";

export const VEXA_WAVEFORM_SURFACE_RENDERER_ID = "vexa.waveform" as const;

export type VexaWaveformAdapterErrorCode =
  | "INVALID_WAVEFORM_ADAPTER_OPTIONS"
  | "INVALID_WAVEFORM_SURFACE_DATA"
  | "WAVEFORM_SOURCE_UNAVAILABLE"
  | "WAVEFORM_SOURCE_UNSUPPORTED"
  | "WAVEFORM_RENDER_FAILED";

export class VexaWaveformAdapterError extends Error {
  readonly code: VexaWaveformAdapterErrorCode;
  readonly sourceId?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: VexaWaveformAdapterErrorCode,
    options: { readonly sourceId?: string; readonly cause?: unknown } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.sourceId !== undefined) this.sourceId = options.sourceId;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface VexaWaveformSource {
  readonly path: string;
}

export interface VexaWaveformSurfaceData {
  readonly sourceId: string;
  readonly color?: string;
  readonly background?: string;
}

export interface VexaWaveformSurfaceAdapterOptions {
  readonly rendererId?: string;
  readonly sources: Readonly<Record<string, string | VexaWaveformSource>>;
  readonly baseDirectory?: string;
  readonly workspaceRoot?: string;
  readonly color?: string;
  readonly background?: string;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly timeoutMs?: number;
}

type SurfaceDescriptor = Parameters<NonNullable<VexaSurfaceRendererAdapter["renderSurface"]>>[0];

interface NormalizedWaveformSource {
  readonly path: string;
}

interface NormalizedWaveformSurfaceData {
  readonly sourceId: string;
  readonly color?: string;
  readonly background?: string;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VexaWaveformAdapterError(
      `${label} must be a non-empty string.`,
      "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );
  }
  return value.trim();
}

function normalizeTimeoutMs(value: number | undefined): number {
  const normalized = value ?? 30_000;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new VexaWaveformAdapterError(
      "timeoutMs must be a positive safe integer.",
      "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );
  }
  return normalized;
}

function normalizeSources(
  sources: Readonly<Record<string, string | VexaWaveformSource>>,
  baseDirectory: string
): ReadonlyMap<string, NormalizedWaveformSource> {
  if (!sources || typeof sources !== "object") {
    throw new VexaWaveformAdapterError(
      "sources must be a sourceId-to-file map.",
      "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );
  }

  const normalized = new Map<string, NormalizedWaveformSource>();
  for (const [rawSourceId, value] of Object.entries(sources)) {
    const sourceId = assertNonEmptyText(rawSourceId, "waveform sourceId");
    if (normalized.has(sourceId)) {
      throw new VexaWaveformAdapterError(
        `Waveform sourceId "${sourceId}" is duplicated after normalization.`,
        "INVALID_WAVEFORM_ADAPTER_OPTIONS"
      );
    }
    const rawPath = typeof value === "string" ? value : value?.path;
    const sourcePath = assertNonEmptyText(rawPath, `Waveform source "${sourceId}" path`);
    normalized.set(sourceId, Object.freeze({
      path: isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(baseDirectory, sourcePath)
    }));
  }

  if (normalized.size === 0) {
    throw new VexaWaveformAdapterError(
      "sources must contain at least one waveform source.",
      "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );
  }
  return normalized;
}

function normalizeSurfaceData(surface: SurfaceDescriptor): NormalizedWaveformSurfaceData {
  const data = surface.data;
  const sourceId = data?.sourceId;
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    throw new VexaWaveformAdapterError(
      "Waveform surface data requires a non-empty sourceId.",
      "INVALID_WAVEFORM_SURFACE_DATA"
    );
  }

  const color = data?.color;
  if (color !== undefined && (typeof color !== "string" || color.trim() === "")) {
    throw new VexaWaveformAdapterError(
      "Waveform surface color must be a non-empty string when provided.",
      "INVALID_WAVEFORM_SURFACE_DATA",
      { sourceId: sourceId.trim() }
    );
  }
  const background = data?.background;
  if (background !== undefined && (typeof background !== "string" || background.trim() === "")) {
    throw new VexaWaveformAdapterError(
      "Waveform surface background must be a non-empty string when provided.",
      "INVALID_WAVEFORM_SURFACE_DATA",
      { sourceId: sourceId.trim() }
    );
  }

  return Object.freeze({
    sourceId: sourceId.trim(),
    ...(typeof color === "string" ? { color: color.trim() } : {}),
    ...(typeof background === "string" ? { background: background.trim() } : {})
  });
}

function validateWaveformArgs(
  source: string,
  width: number,
  height: number,
  color: string,
  background: string,
  code: Extract<VexaWaveformAdapterErrorCode, "INVALID_WAVEFORM_ADAPTER_OPTIONS" | "INVALID_WAVEFORM_SURFACE_DATA">,
  sourceId?: string
): void {
  try {
    compileWaveformArgs(source, "waveform.png", {
      width,
      height,
      color,
      background
    });
  } catch (cause) {
    if (cause instanceof InvalidOperationError) {
      throw new VexaWaveformAdapterError(
        cause.message,
        code,
        {
          ...(sourceId ? { sourceId } : {}),
          cause
        }
      );
    }
    throw cause;
  }
}

export function createWaveformSurfaceAdapter(
  options: VexaWaveformSurfaceAdapterOptions
): VexaSurfaceRendererAdapter {
  if (!options || typeof options !== "object") {
    throw new VexaWaveformAdapterError(
      "Waveform adapter options are required.",
      "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );
  }

  const rendererId = options.rendererId === undefined
    ? VEXA_WAVEFORM_SURFACE_RENDERER_ID
    : assertNonEmptyText(options.rendererId, "rendererId");
  const baseDirectory = resolve(options.baseDirectory ?? process.cwd());
  const workspaceRoot = resolve(options.workspaceRoot ?? tmpdir());
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const defaultColor = options.color === undefined
    ? "white"
    : assertNonEmptyText(options.color, "color");
  const defaultBackground = options.background === undefined
    ? "#0b1220"
    : assertNonEmptyText(options.background, "background");
  validateWaveformArgs(
    "waveform-source",
    1,
    1,
    defaultColor,
    defaultBackground,
    "INVALID_WAVEFORM_ADAPTER_OPTIONS"
  );
  const sources = normalizeSources(options.sources, baseDirectory);
  const supportedPaths = new Set<string>();
  let binariesPromise: Promise<MediaBinaries> | undefined;

  const resolveBinaries = (): Promise<MediaBinaries> => {
    binariesPromise ??= resolveMediaBinaries({
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {})
    });
    return binariesPromise;
  };

  const verifySource = async (
    sourceId: string,
    source: NormalizedWaveformSource,
    context: VexaSurfaceRendererAdapterContext
  ): Promise<void> => {
    if (supportedPaths.has(source.path)) return;
    const binaries = await resolveBinaries();
    try {
      const result = await probeMedia(source.path, binaries.ffprobe, {
        ...(context.signal ? { signal: context.signal } : {}),
        timeoutMs
      });
      if (!result.audio) {
        throw new VexaWaveformAdapterError(
          `Waveform source "${sourceId}" does not expose an audio stream.`,
          "WAVEFORM_SOURCE_UNSUPPORTED",
          { sourceId }
        );
      }
      supportedPaths.add(source.path);
    } catch (cause) {
      if (
        cause instanceof VexaWaveformAdapterError ||
        cause instanceof ProcessAbortedError ||
        cause instanceof ProcessTimeoutError
      ) throw cause;
      throw new VexaWaveformAdapterError(
        `Waveform source "${sourceId}" could not be probed: ${cause instanceof Error ? cause.message : String(cause)}.`,
        "WAVEFORM_SOURCE_UNAVAILABLE",
        { sourceId, cause }
      );
    }
  };

  return Object.freeze({
    rendererId,
    async renderSurface(surface: SurfaceDescriptor, context: VexaSurfaceRendererAdapterContext) {
      if (context.signal?.aborted) throw new ProcessAbortedError();
      const data = normalizeSurfaceData(surface);
      const source = sources.get(data.sourceId);
      if (!source) {
        throw new VexaWaveformAdapterError(
          `Waveform sourceId "${data.sourceId}" is not configured for renderer "${rendererId}".`,
          "WAVEFORM_SOURCE_UNAVAILABLE",
          { sourceId: data.sourceId }
        );
      }

      const color = data.color ?? defaultColor;
      const background = data.background ?? defaultBackground;
      validateWaveformArgs(
        source.path,
        context.width,
        context.height,
        color,
        background,
        "INVALID_WAVEFORM_SURFACE_DATA",
        data.sourceId
      );
      await verifySource(data.sourceId, source, context);

      const binaries = await resolveBinaries();
      await mkdir(workspaceRoot, { recursive: true });
      const workspace = await mkdtemp(join(workspaceRoot, "vexa-waveform-"));
      const target = join(workspace, "waveform.png");

      try {
        await generateWaveform(binaries.ffmpeg, source.path, target, {
          width: context.width,
          height: context.height,
          color,
          background,
          overwrite: true,
          ...(context.signal ? { signal: context.signal } : {}),
          timeoutMs
        });
        const png = await readFile(target);
        return Object.freeze({ kind: "png" as const, png });
      } catch (cause) {
        if (
          context.signal?.aborted ||
          cause instanceof ProcessAbortedError ||
          cause instanceof ProcessTimeoutError
        ) throw cause;
        if (cause instanceof InvalidOperationError) {
          throw new VexaWaveformAdapterError(
            cause.message,
            "INVALID_WAVEFORM_SURFACE_DATA",
            { sourceId: data.sourceId, cause }
          );
        }
        throw new VexaWaveformAdapterError(
          `Waveform source "${data.sourceId}" could not render: ${cause instanceof Error ? cause.message : String(cause)}.`,
          "WAVEFORM_RENDER_FAILED",
          { sourceId: data.sourceId, cause }
        );
      } finally {
        await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });
}

import { access } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type {
  HardwareAccelerationPreference,
  JsonObject
} from "@vexa-video/core";
import {
  VexaCompositionRenderer,
  type VexaImageFormat,
  type VexaImageRenderResult,
  type VexaRenderProgress,
  type VexaVideoFormat,
  type VexaVideoRenderResult
} from "@vexa-video/renderer";

const DEFAULT_COMPOSITION_MANIFEST = ".vexa/bundle/vexa.bundle.json";

interface CompositionCliCommonOptions {
  readonly compositionId: string;
  readonly output: string;
  readonly manifestPath?: string;
  readonly inputProps?: JsonObject;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly hardwareAcceleration?: HardwareAccelerationPreference;
  readonly hardwareFallback?: boolean;
  readonly onProgress?: (progress: VexaRenderProgress) => void;
}

export interface CompositionCliVideoOptions extends CompositionCliCommonOptions {
  readonly startFrame?: number;
  readonly endFrameExclusive?: number;
}

export interface CompositionCliStillOptions extends CompositionCliCommonOptions {
  readonly frame?: number;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

function isRemoteMediaSource(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(value);
}

function imageFormatForOutput(output: string): VexaImageFormat {
  switch (extname(output).toLowerCase()) {
    case ".png":
      return "png";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".webp":
      return "webp";
    default:
      throw new Error("Composition still output must use .png, .jpg, .jpeg, or .webp.");
  }
}

function videoFormatForOutput(output: string): VexaVideoFormat {
  switch (extname(output).toLowerCase()) {
    case ".mp4":
      return "mp4";
    case ".webm":
      return "webm";
    default:
      throw new Error("Composition video output must use .mp4 or .webm.");
  }
}

async function loadRenderer(
  options: CompositionCliCommonOptions
): Promise<VexaCompositionRenderer> {
  return await VexaCompositionRenderer.fromManifest(
    resolve(options.manifestPath ?? DEFAULT_COMPOSITION_MANIFEST),
    {
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    }
  );
}

function renderExecutionOptions(options: CompositionCliCommonOptions) {
  return {
    overwrite: true,
    ...(options.inputProps !== undefined ? { inputProps: options.inputProps } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.hardwareAcceleration !== undefined
      ? { hardwareAcceleration: options.hardwareAcceleration }
      : {}),
    ...(options.hardwareFallback !== undefined
      ? { hardwareFallback: options.hardwareFallback }
      : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {})
  };
}

export async function tryRenderCompositionVideo(
  options: CompositionCliVideoOptions
): Promise<VexaVideoRenderResult | null> {
  const forceComposition = options.manifestPath !== undefined;
  if (!forceComposition) {
    if (isRemoteMediaSource(options.compositionId)) return null;
    if (await pathExists(options.compositionId)) return null;
    if (extname(options.compositionId) !== "") return null;
    if (!(await pathExists(resolve(DEFAULT_COMPOSITION_MANIFEST)))) return null;
  }

  const renderer = await loadRenderer(options);
  renderer.requireComposition(options.compositionId);
  return await renderer.renderVideo({
    compositionId: options.compositionId,
    output: options.output,
    format: videoFormatForOutput(options.output),
    ...renderExecutionOptions(options),
    ...(options.startFrame !== undefined ? { startFrame: options.startFrame } : {}),
    ...(options.endFrameExclusive !== undefined
      ? { endFrameExclusive: options.endFrameExclusive }
      : {})
  });
}

export async function renderCompositionStill(
  options: CompositionCliStillOptions
): Promise<VexaImageRenderResult> {
  const renderer = await loadRenderer(options);
  const composition = renderer.requireComposition(options.compositionId);
  const format = imageFormatForOutput(options.output);
  const execution = renderExecutionOptions(options);

  if (composition.kind === "still") {
    if (options.frame !== undefined && options.frame !== 0) {
      throw new Error(`--frame must be 0 for still composition "${composition.id}".`);
    }
    return await renderer.renderStill({
      compositionId: composition.id,
      output: options.output,
      format,
      ...execution
    });
  }

  return await renderer.renderFrame({
    compositionId: composition.id,
    output: options.output,
    frame: options.frame ?? 0,
    format,
    ...execution
  });
}

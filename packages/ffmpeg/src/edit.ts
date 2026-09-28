import type {
  ExportOptions,
  ExtractAudioOptions,
  MediaExecutionPlan,
  MediaOutputResult,
  ThumbnailOptions,
  VideoOperation
} from "@vexa-video/core";
import { FfmpegProgressParser } from "./progress.js";
import { runProcess } from "./process.js";
import {
  createExportExecutionPlan,
  createExtractAudioExecutionPlan,
  createThumbnailExecutionPlan
} from "./plan.js";

export function compileExportArgs(
  source: string,
  operations: readonly VideoOperation[],
  output: string,
  options: ExportOptions = {}
): string[] {
  return [...createExportExecutionPlan(source, operations, output, options).args];
}

export function compileThumbnailArgs(
  source: string,
  operations: readonly VideoOperation[],
  output: string,
  options: ThumbnailOptions = {}
): string[] {
  return [...createThumbnailExecutionPlan(source, operations, output, options).args];
}

export function compileExtractAudioArgs(
  source: string,
  operations: readonly VideoOperation[],
  output: string,
  options: ExtractAudioOptions = {}
): string[] {
  return [...createExtractAudioExecutionPlan(source, operations, output, options).args];
}

export interface RunFfmpegOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  durationSeconds?: number | null;
  onProgress?: ExportOptions["onProgress"];
}

export async function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  options: RunFfmpegOptions = {}
): Promise<MediaOutputResult> {
  const progressParser = options.onProgress
    ? new FfmpegProgressParser(options.durationSeconds ?? null)
    : null;

  const result = await runProcess(
    ffmpegPath,
    ["-hide_banner", "-nostats", ...(progressParser ? ["-progress", "pipe:1"] : []), ...args],
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(progressParser && options.onProgress
        ? {
            onStdoutChunk: (chunk: string) => progressParser.push(chunk, options.onProgress!)
          }
        : {})
    }
  );

  return {
    output: args.at(-1) ?? "",
    exitCode: result.exitCode
  };
}

export async function runFfmpegPlan(
  ffmpegPath: string,
  plan: MediaExecutionPlan,
  options: Omit<RunFfmpegOptions, "durationSeconds"> = {}
): Promise<MediaOutputResult> {
  return await runFfmpeg(ffmpegPath, plan.args, {
    ...options,
    durationSeconds: plan.expectedDurationSeconds
  });
}

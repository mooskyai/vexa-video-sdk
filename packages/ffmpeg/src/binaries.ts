import { BinaryNotFoundError } from "@vexa-video/core";
import { runProcess } from "./process.js";

export interface MediaBinaries {
  ffmpeg: string;
  ffprobe: string;
}

export interface ResolveBinariesOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}

async function assertBinary(binary: string): Promise<void> {
  try {
    await runProcess(binary, ["-version"], { timeoutMs: 5_000 });
  } catch (cause) {
    throw new BinaryNotFoundError(binary, { cause });
  }
}

export async function resolveMediaBinaries(
  options: ResolveBinariesOptions = {}
): Promise<MediaBinaries> {
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";

  await Promise.all([assertBinary(ffmpeg), assertBinary(ffprobe)]);

  return { ffmpeg, ffprobe };
}

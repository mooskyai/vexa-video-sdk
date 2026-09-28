import type { HardwareAccelerationOptions } from "./hardware.js";

export type ResizeFit = "contain" | "cover" | "fill";

export interface TrimOptions {
  start: number;
  duration?: number;
}

export interface ResizeOptions {
  width: number;
  height: number;
  fit?: ResizeFit;
}

export interface CropOptions {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface RotateOptions {
  degrees: number;
}

export type VideoOperation =
  | { type: "trim"; options: TrimOptions }
  | { type: "resize"; options: ResizeOptions }
  | { type: "crop"; options: CropOptions }
  | { type: "rotate"; options: RotateOptions };

export type VideoCodec = "h264" | "h265" | "av1" | "vp9" | "copy";
export type AudioCodec = "aac" | "opus" | "mp3" | "copy" | "none";

export type EncoderPreset =
  | "ultrafast"
  | "superfast"
  | "veryfast"
  | "faster"
  | "fast"
  | "medium"
  | "slow"
  | "slower"
  | "veryslow";

export interface MediaProgress {
  frame: number | null;
  fps: number | null;
  speed: number | null;
  processedSeconds: number;
  durationSeconds: number | null;
  percent: number | null;
  status: "continue" | "end";
}

export interface ProcessControlOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ExportOptions extends ProcessControlOptions, HardwareAccelerationOptions {
  overwrite?: boolean;
  videoCodec?: VideoCodec;
  audioCodec?: AudioCodec;
  crf?: number;
  preset?: EncoderPreset;
  pixelFormat?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  onProgress?: (progress: MediaProgress) => void;
}

export interface ThumbnailOptions extends ProcessControlOptions {
  at?: number;
  overwrite?: boolean;
  quality?: number;
}

export interface ExtractAudioOptions extends ProcessControlOptions {
  overwrite?: boolean;
  codec?: Exclude<AudioCodec, "none">;
  bitrate?: string;
  onProgress?: (progress: MediaProgress) => void;
}

export interface MediaOutputResult {
  output: string;
  exitCode: number;
}

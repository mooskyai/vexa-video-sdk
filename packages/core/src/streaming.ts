import type { MediaProgress, ProcessControlOptions } from "./editing.js";
import type { HardwareAccelerationDecision, HardwareAccelerationOptions } from "./hardware.js";
import { InvalidStreamingError } from "./errors.js";

export type StreamingProtocol = "hls" | "dash";
export type StreamingPresetName = "mobile" | "balanced" | "hd";
export type HlsPlaylistType = "vod" | "event";

export interface StreamingRendition {
  id: string;
  width: number;
  height: number;
  videoBitrate: string;
  maxRate?: string;
  bufferSize?: string;
  audioBitrate?: string;
  fps?: number;
}

export interface StreamingPackageOptions extends ProcessControlOptions, HardwareAccelerationOptions {
  protocol: StreamingProtocol;
  preset?: StreamingPresetName;
  renditions?: readonly StreamingRendition[];
  segmentDuration?: number;
  hlsPlaylistType?: HlsPlaylistType;
  overwrite?: boolean;
  onProgress?: (progress: MediaProgress) => void;
}

export interface StreamingExecutionPlan {
  schemaVersion: 1;
  backend: "ffmpeg";
  task: "streaming-package";
  protocol: StreamingProtocol;
  source: string;
  outputDirectory: string;
  manifestPath: string;
  durationSeconds: number | null;
  hasAudio: boolean;
  segmentDuration: number;
  renditions: readonly StreamingRendition[];
  args: readonly string[];
  optimizations: readonly string[];
  hardware: HardwareAccelerationDecision | null;
}

export interface StreamingPackageResult {
  protocol: StreamingProtocol;
  outputDirectory: string;
  manifestPath: string;
  files: readonly string[];
  renditions: readonly StreamingRendition[];
}

export interface PreviewSpriteOptions extends ProcessControlOptions {
  intervalSeconds?: number;
  tileWidth?: number;
  columns?: number;
  quality?: number;
  overwrite?: boolean;
}

export interface PreviewSpriteCue {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewSpritePlan {
  schemaVersion: 1;
  backend: "ffmpeg";
  task: "preview-sprite";
  source: string;
  outputDirectory: string;
  imagePath: string;
  vttPath: string;
  durationSeconds: number;
  intervalSeconds: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  cues: readonly PreviewSpriteCue[];
  args: readonly string[];
}

export interface PreviewSpriteResult {
  imagePath: string;
  vttPath: string;
  cues: readonly PreviewSpriteCue[];
}

const PRESETS: Record<StreamingPresetName, readonly StreamingRendition[]> = {
  mobile: [
    { id: "240p", width: 426, height: 240, videoBitrate: "400k", maxRate: "460k", bufferSize: "800k", audioBitrate: "64k" },
    { id: "360p", width: 640, height: 360, videoBitrate: "800k", maxRate: "920k", bufferSize: "1600k", audioBitrate: "96k" }
  ],
  balanced: [
    { id: "240p", width: 426, height: 240, videoBitrate: "400k", maxRate: "460k", bufferSize: "800k", audioBitrate: "64k" },
    { id: "360p", width: 640, height: 360, videoBitrate: "800k", maxRate: "920k", bufferSize: "1600k", audioBitrate: "96k" },
    { id: "720p", width: 1280, height: 720, videoBitrate: "2800k", maxRate: "3220k", bufferSize: "5600k", audioBitrate: "128k" }
  ],
  hd: [
    { id: "360p", width: 640, height: 360, videoBitrate: "800k", maxRate: "920k", bufferSize: "1600k", audioBitrate: "96k" },
    { id: "720p", width: 1280, height: 720, videoBitrate: "2800k", maxRate: "3220k", bufferSize: "5600k", audioBitrate: "128k" },
    { id: "1080p", width: 1920, height: 1080, videoBitrate: "5000k", maxRate: "5750k", bufferSize: "10000k", audioBitrate: "160k" }
  ]
};

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidStreamingError(`${label} must be a finite number greater than 0.`);
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidStreamingError(`${label} must be a positive integer.`);
  }
}

function bitrate(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[1-9]\d*(?:\.\d+)?[kKmM]?$/u.test(normalized)) {
    throw new InvalidStreamingError(`${label} must be a bitrate such as 800k, 2.8M, or 2800000.`);
  }
  return normalized;
}

export function streamingPreset(name: StreamingPresetName): readonly StreamingRendition[] {
  return PRESETS[name].map((rendition) => ({ ...rendition }));
}

export function normalizeStreamingRenditions(
  renditions: readonly StreamingRendition[]
): readonly StreamingRendition[] {
  if (renditions.length === 0) {
    throw new InvalidStreamingError("At least one streaming rendition is required.");
  }
  const ids = new Set<string>();
  return renditions.map((rendition, index) => {
    const id = rendition.id.trim();
    if (!id) throw new InvalidStreamingError(`streaming.renditions[${index}].id cannot be empty.`);
    if (!/^[a-z0-9_-]+$/iu.test(id)) {
      throw new InvalidStreamingError(`streaming rendition id "${id}" may contain only letters, numbers, _ and -.`);
    }
    if (ids.has(id)) throw new InvalidStreamingError(`Duplicate streaming rendition id: ${id}.`);
    ids.add(id);
    positiveInteger(rendition.width, `streaming rendition ${id}.width`);
    positiveInteger(rendition.height, `streaming rendition ${id}.height`);
    if (rendition.width % 2 || rendition.height % 2) {
      throw new InvalidStreamingError(`streaming rendition ${id} dimensions must be even for H.264 compatibility.`);
    }
    if (rendition.fps !== undefined) positive(rendition.fps, `streaming rendition ${id}.fps`);
    return {
      id,
      width: rendition.width,
      height: rendition.height,
      videoBitrate: bitrate(rendition.videoBitrate, `streaming rendition ${id}.videoBitrate`),
      ...(rendition.maxRate ? { maxRate: bitrate(rendition.maxRate, `streaming rendition ${id}.maxRate`) } : {}),
      ...(rendition.bufferSize ? { bufferSize: bitrate(rendition.bufferSize, `streaming rendition ${id}.bufferSize`) } : {}),
      ...(rendition.audioBitrate ? { audioBitrate: bitrate(rendition.audioBitrate, `streaming rendition ${id}.audioBitrate`) } : {}),
      ...(rendition.fps !== undefined ? { fps: rendition.fps } : {})
    };
  });
}

export function resolveStreamingRenditions(
  options: Pick<StreamingPackageOptions, "preset" | "renditions">
): readonly StreamingRendition[] {
  if (options.renditions?.length) return normalizeStreamingRenditions(options.renditions);
  return normalizeStreamingRenditions(streamingPreset(options.preset ?? "balanced"));
}

export function normalizeSegmentDuration(value: number | undefined): number {
  const duration = value ?? 4;
  positive(duration, "streaming.segmentDuration");
  if (duration < 1 || duration > 30) {
    throw new InvalidStreamingError("streaming.segmentDuration must be between 1 and 30 seconds.");
  }
  return duration;
}

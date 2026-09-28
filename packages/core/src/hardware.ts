import type { ProcessControlOptions, VideoCodec } from "./editing.js";

export type HardwareAccelerationPreference =
  | "auto"
  | "cpu"
  | "nvidia"
  | "intel"
  | "amd"
  | "apple";

export type HardwareAccelerationProvider = Exclude<HardwareAccelerationPreference, "auto">;
export type HardwareVideoCodec = Exclude<VideoCodec, "copy">;

export interface HardwareAccelerationOptions {
  /**
   * Selects the video-encoding backend. The default remains CPU for deterministic
   * behavior; set `auto` to let Vexa choose an available hardware encoder.
   */
  hardwareAcceleration?: HardwareAccelerationPreference;
  /**
   * When an explicitly requested hardware provider does not expose a compatible
   * encoder, fall back to the CPU encoder instead of failing during planning.
   * Defaults to true.
   */
  hardwareFallback?: boolean;
}

export interface HardwareEncoderCapability {
  provider: Exclude<HardwareAccelerationProvider, "cpu">;
  codec: HardwareVideoCodec;
  encoder: string;
  runtimeAvailable: boolean | null;
  runtimeError?: string;
}

export interface HardwareProviderCapability {
  provider: Exclude<HardwareAccelerationProvider, "cpu">;
  /** Encoder is compiled into the configured FFmpeg build. */
  available: boolean;
  /** Null until probed; true only when a tiny real encode succeeds. */
  runtimeAvailable: boolean | null;
  runtimeError?: string;
  encoders: readonly HardwareEncoderCapability[];
}

export interface HardwareAccelerationCapabilities {
  schemaVersion: 1;
  backend: "ffmpeg";
  platform: NodeJS.Platform;
  hwaccels: readonly string[];
  encoders: readonly string[];
  providers: readonly HardwareProviderCapability[];
}

export interface HardwareAccelerationDecision {
  requested: HardwareAccelerationPreference;
  selected: HardwareAccelerationProvider;
  codec: HardwareVideoCodec;
  encoder: string;
  hardware: boolean;
  fallback: boolean;
  reason: string;
}

export interface HardwareDetectionOptions extends ProcessControlOptions {
  ffmpegPath?: string;
}

export interface HardwareBenchmarkOptions extends ProcessControlOptions {
  codec?: HardwareVideoCodec;
  providers?: readonly HardwareAccelerationProvider[];
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface HardwareBenchmarkResult {
  provider: HardwareAccelerationProvider;
  codec: HardwareVideoCodec;
  encoder: string;
  success: boolean;
  elapsedMs: number;
  durationSeconds: number;
  realtimeFactor: number | null;
  error?: string;
}

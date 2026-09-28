import { InvalidOperationError } from "./errors.js";
import type {
  AudioCodec,
  MediaProgress,
  ProcessControlOptions,
  TrimOptions
} from "./editing.js";

export type AudioChannelLayout = "source" | "mono" | "stereo";

export interface AudioNormalizeOptions {
  targetLufs?: number;
  truePeakDb?: number;
  loudnessRange?: number;
}

export interface AudioFadeOptions {
  duration: number;
}

export interface AudioChannelOptions {
  layout: AudioChannelLayout;
}

export interface AudioDuckingOptions {
  sidechain: string;
  threshold?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  sidechainGain?: number;
  mixSidechain?: boolean;
}

export type AudioOperation =
  | { type: "trim"; options: TrimOptions }
  | { type: "normalize"; options: Required<AudioNormalizeOptions> }
  | { type: "fade-in"; options: AudioFadeOptions }
  | { type: "fade-out"; options: AudioFadeOptions }
  | { type: "channels"; options: AudioChannelOptions }
  | { type: "duck-under"; options: Required<Omit<AudioDuckingOptions, "sidechain">> & { sidechain: string } };

export interface AudioExportOptions extends ProcessControlOptions {
  overwrite?: boolean;
  codec?: Exclude<AudioCodec, "none">;
  bitrate?: string;
  onProgress?: (progress: MediaProgress) => void;
}

export interface AudioExecutionPlan {
  schemaVersion: 1;
  backend: "ffmpeg";
  task: "audio-export";
  source: string;
  output: string;
  operations: readonly AudioOperation[];
  inputs: readonly string[];
  filterComplex: string | null;
  audioMap: string | null;
  args: readonly string[];
  expectedDurationSeconds: number | null;
  optimizations: readonly string[];
}

export interface SilenceDetectionOptions extends ProcessControlOptions {
  noiseDb?: number;
  minDuration?: number;
}

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface SilenceDetectionResult {
  source: string;
  noiseDb: number;
  minDuration: number;
  ranges: readonly SilenceRange[];
}

export interface WaveformOptions extends ProcessControlOptions {
  width?: number;
  height?: number;
  color?: string;
  background?: string;
  overwrite?: boolean;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidOperationError(`${label} must be a finite number greater than or equal to 0.`);
  }
  return value;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidOperationError(`${label} must be a finite number greater than 0.`);
  }
  return value;
}

export function normalizeAudioOperations(operations: readonly AudioOperation[]): AudioOperation[] {
  const normalized: AudioOperation[] = [];
  let sawTrim = false;
  let sawNormalize = false;
  let sawChannels = false;
  let sawDucking = false;

  for (const operation of operations) {
    switch (operation.type) {
      case "trim": {
        if (sawTrim) throw new InvalidOperationError("Only one audio trim operation is supported.");
        sawTrim = true;
        const start = finiteNonNegative(operation.options.start, "audio.trim.start");
        const duration = operation.options.duration;
        if (duration !== undefined) finitePositive(duration, "audio.trim.duration");
        if (start === 0 && duration === undefined) break;
        normalized.push({
          type: "trim",
          options: { start, ...(duration !== undefined ? { duration } : {}) }
        });
        break;
      }
      case "normalize": {
        if (sawNormalize) throw new InvalidOperationError("Only one audio normalize operation is supported.");
        sawNormalize = true;
        const targetLufs = operation.options.targetLufs ?? -16;
        const truePeakDb = operation.options.truePeakDb ?? -1.5;
        const loudnessRange = operation.options.loudnessRange ?? 11;
        if (!Number.isFinite(targetLufs) || targetLufs < -70 || targetLufs > -5) {
          throw new InvalidOperationError("audio.normalize.targetLufs must be between -70 and -5.");
        }
        if (!Number.isFinite(truePeakDb) || truePeakDb < -9 || truePeakDb > 0) {
          throw new InvalidOperationError("audio.normalize.truePeakDb must be between -9 and 0.");
        }
        if (!Number.isFinite(loudnessRange) || loudnessRange < 1 || loudnessRange > 50) {
          throw new InvalidOperationError("audio.normalize.loudnessRange must be between 1 and 50.");
        }
        normalized.push({
          type: "normalize",
          options: { targetLufs, truePeakDb, loudnessRange }
        });
        break;
      }
      case "fade-in":
      case "fade-out": {
        normalized.push({
          type: operation.type,
          options: { duration: finitePositive(operation.options.duration, `audio.${operation.type}.duration`) }
        });
        break;
      }
      case "channels": {
        if (sawChannels) throw new InvalidOperationError("Only one audio channel mapping operation is supported.");
        sawChannels = true;
        if (!(["source", "mono", "stereo"] as const).includes(operation.options.layout)) {
          throw new InvalidOperationError("audio.channels.layout must be source, mono, or stereo.");
        }
        if (operation.options.layout !== "source") {
          normalized.push({ type: "channels", options: { layout: operation.options.layout } });
        }
        break;
      }
      case "duck-under": {
        if (sawDucking) throw new InvalidOperationError("Only one audio ducking operation is supported.");
        sawDucking = true;
        const sidechain = operation.options.sidechain.trim();
        if (!sidechain) throw new InvalidOperationError("audio.duckUnder.sidechain cannot be empty.");
        const threshold = operation.options.threshold ?? 0.1;
        const ratio = operation.options.ratio ?? 8;
        const attackMs = operation.options.attackMs ?? 20;
        const releaseMs = operation.options.releaseMs ?? 250;
        const sidechainGain = operation.options.sidechainGain ?? 1;
        const mixSidechain = operation.options.mixSidechain ?? true;
        if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
          throw new InvalidOperationError("audio.duckUnder.threshold must be greater than 0 and at most 1.");
        }
        if (!Number.isFinite(ratio) || ratio < 1 || ratio > 20) {
          throw new InvalidOperationError("audio.duckUnder.ratio must be between 1 and 20.");
        }
        finitePositive(attackMs, "audio.duckUnder.attackMs");
        finitePositive(releaseMs, "audio.duckUnder.releaseMs");
        finiteNonNegative(sidechainGain, "audio.duckUnder.sidechainGain");
        normalized.push({
          type: "duck-under",
          options: {
            sidechain,
            threshold,
            ratio,
            attackMs,
            releaseMs,
            sidechainGain,
            mixSidechain
          }
        });
        break;
      }
    }
  }

  return normalized;
}

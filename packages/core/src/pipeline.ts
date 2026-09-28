import { InvalidOperationError } from "./errors.js";
import type { HardwareAccelerationDecision } from "./hardware.js";
import type {
  AudioCodec,
  CropOptions,
  ExportOptions,
  ResizeFit,
  ResizeOptions,
  RotateOptions,
  TrimOptions,
  VideoCodec,
  VideoOperation
} from "./editing.js";

export type ExecutionTask = "export" | "thumbnail" | "extract-audio";
export type ExecutionMode = "copy" | "encode" | "none";
export type OutputContainer =
  | "mp4"
  | "mov"
  | "webm"
  | "matroska"
  | "jpeg"
  | "png"
  | "m4a"
  | "mp3"
  | "opus"
  | "unknown";

export interface VideoPipelineAst {
  schemaVersion: 1;
  source: string;
  operations: readonly VideoOperation[];
}

export interface CodecDecision {
  requested: string | null;
  selected: string | null;
  mode: ExecutionMode;
  reason: string;
}

export interface MediaExecutionPlan {
  schemaVersion: 1;
  backend: "ffmpeg";
  task: ExecutionTask;
  source: string;
  output: string;
  container: OutputContainer;
  operations: readonly VideoOperation[];
  filters: readonly string[];
  args: readonly string[];
  expectedDurationSeconds: number | null;
  video: CodecDecision | null;
  audio: CodecDecision | null;
  optimizations: readonly string[];
  hardware: HardwareAccelerationDecision | null;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidOperationError(`${label} must be a finite number greater than or equal to 0.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidOperationError(`${label} must be a positive integer.`);
  }
}

function normalizeTrim(options: TrimOptions): TrimOptions | null {
  assertFiniteNonNegative(options.start, "trim.start");
  if (options.duration !== undefined) {
    if (!Number.isFinite(options.duration) || options.duration <= 0) {
      throw new InvalidOperationError("trim.duration must be a finite number greater than 0.");
    }
  }

  if (options.start === 0 && options.duration === undefined) return null;
  return {
    start: options.start,
    ...(options.duration !== undefined ? { duration: options.duration } : {})
  };
}

function normalizeResize(options: ResizeOptions): ResizeOptions {
  assertPositiveInteger(options.width, "resize.width");
  assertPositiveInteger(options.height, "resize.height");
  const fit: ResizeFit = options.fit ?? "contain";
  return { width: options.width, height: options.height, fit };
}

function normalizeCrop(options: CropOptions): CropOptions {
  assertPositiveInteger(options.width, "crop.width");
  assertPositiveInteger(options.height, "crop.height");
  if (options.x !== undefined) assertFiniteNonNegative(options.x, "crop.x");
  if (options.y !== undefined) assertFiniteNonNegative(options.y, "crop.y");

  return {
    width: options.width,
    height: options.height,
    ...(options.x !== undefined ? { x: options.x } : {}),
    ...(options.y !== undefined ? { y: options.y } : {})
  };
}

function normalizeRotate(options: RotateOptions): RotateOptions | null {
  if (!Number.isFinite(options.degrees)) {
    throw new InvalidOperationError("rotate.degrees must be a finite number.");
  }

  const degrees = ((options.degrees % 360) + 360) % 360;
  if (degrees === 0) return null;
  return { degrees };
}

export function normalizeVideoOperations(
  operations: readonly VideoOperation[]
): VideoOperation[] {
  const normalized: VideoOperation[] = [];
  let trimSeen = false;

  for (const operation of operations) {
    switch (operation.type) {
      case "trim": {
        if (trimSeen) {
          throw new InvalidOperationError("Only one trim operation is supported in the current pipeline.");
        }
        const options = normalizeTrim(operation.options);
        if (options) {
          normalized.push({ type: "trim", options });
          trimSeen = true;
        }
        break;
      }
      case "resize":
        normalized.push({ type: "resize", options: normalizeResize(operation.options) });
        break;
      case "crop":
        normalized.push({ type: "crop", options: normalizeCrop(operation.options) });
        break;
      case "rotate": {
        const options = normalizeRotate(operation.options);
        if (options) normalized.push({ type: "rotate", options });
        break;
      }
      default: {
        const neverOperation: never = operation;
        throw new InvalidOperationError(`Unsupported video operation: ${String(neverOperation)}`);
      }
    }
  }

  return normalized;
}

export function createVideoPipelineAst(
  source: string,
  operations: readonly VideoOperation[]
): VideoPipelineAst {
  return {
    schemaVersion: 1,
    source,
    operations: normalizeVideoOperations(operations)
  };
}

export function hasVideoEncodingOptions(options: ExportOptions): boolean {
  return (
    options.crf !== undefined ||
    options.preset !== undefined ||
    options.pixelFormat !== undefined ||
    options.videoBitrate !== undefined
  );
}

export function hasAudioEncodingOptions(options: ExportOptions): boolean {
  return options.audioBitrate !== undefined;
}

export function requestedVideoCodec(options: ExportOptions): VideoCodec | null {
  return options.videoCodec ?? null;
}

export function requestedAudioCodec(options: ExportOptions): AudioCodec | null {
  return options.audioCodec ?? null;
}

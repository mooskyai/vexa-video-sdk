import type {
  AudioCodec,
  ExportOptions,
  ExtractAudioOptions,
  HardwareAccelerationCapabilities,
  MediaExecutionPlan,
  ProbeResult,
  ThumbnailOptions,
  VideoCodec,
  VideoOperation
} from "@moosky-video/core";
import {
  IncompatibleOutputError,
  InvalidOperationError,
  hasAudioEncodingOptions,
  hasVideoEncodingOptions,
  normalizeVideoOperations,
  requestedAudioCodec,
  requestedVideoCodec
} from "@moosky-video/core";
import {
  assertAudioCodecCompatible,
  assertVideoCodecCompatible,
  defaultAudioCodec,
  defaultVideoCodec,
  detectOutputContainer,
  isAudioCodecCompatible,
  isVideoCodecCompatible,
  mapSourceAudioCodec,
  mapSourceVideoCodec
} from "./compatibility.js";
import { compileVideoFilterGraph } from "./filter-graph.js";
import { appendVideoEncoderOptions, hardwareOptimizationMarkers, resolveHardwareAcceleration } from "./hardware.js";

const AUDIO_CODECS: Record<Exclude<AudioCodec, "copy" | "none">, string> = {
  aac: "aac",
  opus: "libopus",
  mp3: "libmp3lame"
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function getTrim(operations: readonly VideoOperation[]) {
  return operations.find((operation) => operation.type === "trim");
}

function appendTrimArgs(args: string[], operations: readonly VideoOperation[]): void {
  const trim = getTrim(operations);
  if (!trim) return;
  args.push("-ss", formatNumber(trim.options.start));
  if (trim.options.duration !== undefined) args.push("-t", formatNumber(trim.options.duration));
}

function appendOverwrite(args: string[], overwrite: boolean | undefined): void {
  args.push(overwrite === false ? "-n" : "-y");
}

function expectedDuration(
  operations: readonly VideoOperation[],
  probe: ProbeResult | null
): number | null {
  const trim = getTrim(operations);
  if (trim?.options.duration !== undefined) return trim.options.duration;
  if (probe?.durationSeconds === null || probe?.durationSeconds === undefined) return null;
  return Math.max(0, probe.durationSeconds - (trim?.options.start ?? 0));
}

function hasTimelineChange(operations: readonly VideoOperation[]): boolean {
  return operations.some((operation) => operation.type === "trim");
}

function resolveVideoDecision(
  container: ReturnType<typeof detectOutputContainer>,
  operations: readonly VideoOperation[],
  probe: ProbeResult | null,
  options: ExportOptions,
  filtersRequired: boolean
) {
  if (probe && !probe.video) {
    return {
      requested: options.videoCodec ?? null,
      selected: null,
      mode: "none" as const,
      reason: "source-has-no-video"
    };
  }

  const requested = requestedVideoCodec(options);
  const sourceCodec = mapSourceVideoCodec(probe);
  const encodingOptions = hasVideoEncodingOptions(options);

  if (requested === "copy") {
    if (filtersRequired) {
      throw new InvalidOperationError(
        'videoCodec "copy" cannot be used with resize, crop, or rotate operations.'
      );
    }
    if (encodingOptions) {
      throw new InvalidOperationError(
        'Video encoding options cannot be combined with videoCodec "copy".'
      );
    }
    if (sourceCodec && !isVideoCodecCompatible(container, sourceCodec)) {
      throw new IncompatibleOutputError(
        `Source video codec "${sourceCodec}" cannot be stream-copied into ${container} output.`
      );
    }
    return {
      requested,
      selected: "copy",
      mode: "copy" as const,
      reason: "requested-stream-copy"
    };
  }

  if (requested) {
    assertVideoCodecCompatible(container, requested);
    return {
      requested,
      selected: requested,
      mode: "encode" as const,
      reason: "requested-codec"
    };
  }

  const safeForAutomaticCopy =
    operations.length === 0 &&
    !filtersRequired &&
    !encodingOptions &&
    sourceCodec !== null &&
    container !== "unknown" &&
    isVideoCodecCompatible(container, sourceCodec);

  if (safeForAutomaticCopy) {
    return {
      requested: null,
      selected: "copy",
      mode: "copy" as const,
      reason: "source-compatible-stream-copy"
    };
  }

  const selected = defaultVideoCodec(container);
  assertVideoCodecCompatible(container, selected);
  return {
    requested: null,
    selected,
    mode: "encode" as const,
    reason:
      filtersRequired || hasTimelineChange(operations) || encodingOptions
        ? "processing-requires-encode"
        : "container-default"
  };
}

function resolveAudioDecision(
  container: ReturnType<typeof detectOutputContainer>,
  operations: readonly VideoOperation[],
  probe: ProbeResult | null,
  options: ExportOptions
) {
  const requested = requestedAudioCodec(options);
  if (requested === "none") {
    return {
      requested,
      selected: null,
      mode: "none" as const,
      reason: "audio-disabled"
    };
  }

  if (probe && !probe.audio) {
    return {
      requested: requested ?? null,
      selected: null,
      mode: "none" as const,
      reason: "source-has-no-audio"
    };
  }

  const sourceCodec = mapSourceAudioCodec(probe);
  const encodingOptions = hasAudioEncodingOptions(options);

  if (requested === "copy") {
    if (encodingOptions) {
      throw new InvalidOperationError(
        'Audio encoding options cannot be combined with audioCodec "copy".'
      );
    }
    if (sourceCodec && !isAudioCodecCompatible(container, sourceCodec)) {
      throw new IncompatibleOutputError(
        `Source audio codec "${sourceCodec}" cannot be stream-copied into ${container} output.`
      );
    }
    return {
      requested,
      selected: "copy",
      mode: "copy" as const,
      reason: "requested-stream-copy"
    };
  }

  if (requested) {
    assertAudioCodecCompatible(container, requested);
    return {
      requested,
      selected: requested,
      mode: "encode" as const,
      reason: "requested-codec"
    };
  }

  const safeForAutomaticCopy =
    operations.length === 0 &&
    !encodingOptions &&
    sourceCodec !== null &&
    container !== "unknown" &&
    isAudioCodecCompatible(container, sourceCodec);

  if (safeForAutomaticCopy) {
    return {
      requested: null,
      selected: "copy",
      mode: "copy" as const,
      reason: "source-compatible-stream-copy"
    };
  }

  const selected = defaultAudioCodec(container);
  assertAudioCodecCompatible(container, selected);
  return {
    requested: null,
    selected,
    mode: "encode" as const,
    reason:
      hasTimelineChange(operations) || encodingOptions
        ? "processing-requires-encode"
        : "container-default"
  };
}

export function createExportExecutionPlan(
  source: string,
  operations: readonly VideoOperation[],
  output: string,
  options: ExportOptions = {},
  probe: ProbeResult | null = null,
  hardwareCapabilities: HardwareAccelerationCapabilities | null = null
): MediaExecutionPlan {
  const normalized = normalizeVideoOperations(operations);
  const filterGraph = compileVideoFilterGraph(normalized);
  const container = detectOutputContainer(output);
  const video = resolveVideoDecision(
    container,
    normalized,
    probe,
    options,
    filterGraph.requiresVideoEncode
  );
  const audio = resolveAudioDecision(container, normalized, probe, options);
  const hardware = video.mode === "encode" && video.selected
    ? resolveHardwareAcceleration(
        video.selected as Exclude<VideoCodec, "copy">,
        options.hardwareAcceleration,
        hardwareCapabilities,
        options.hardwareFallback !== false
      )
    : null;
  const args: string[] = [];
  const optimizations: string[] = [];

  appendOverwrite(args, options.overwrite);
  args.push("-i", source);
  appendTrimArgs(args, normalized);

  if (filterGraph.expression) {
    args.push("-vf", filterGraph.expression);
    optimizations.push("SINGLE_PASS_FILTER_GRAPH");
  }

  if (video.mode === "copy") {
    args.push("-c:v", "copy");
    optimizations.push("VIDEO_STREAM_COPY");
  } else if (video.mode === "encode" && hardware) {
    appendVideoEncoderOptions(args, hardware, {
      ...(options.crf !== undefined ? { crf: options.crf } : {}),
      ...(options.preset !== undefined ? { preset: options.preset } : {}),
      ...(options.pixelFormat !== undefined ? { pixelFormat: options.pixelFormat } : {}),
      ...(options.videoBitrate !== undefined ? { videoBitrate: options.videoBitrate } : {})
    });
    optimizations.push(...hardwareOptimizationMarkers(hardware));
  }

  if (audio.mode === "none") {
    args.push("-an");
  } else if (audio.mode === "copy") {
    args.push("-c:a", "copy");
    optimizations.push("AUDIO_STREAM_COPY");
  } else if (audio.selected) {
    const codec = audio.selected as Exclude<AudioCodec, "copy" | "none">;
    args.push("-c:a", AUDIO_CODECS[codec]);
    if (options.audioBitrate !== undefined) args.push("-b:a", options.audioBitrate);
  }

  args.push(output);

  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "export",
    source,
    output,
    container,
    operations: normalized,
    filters: filterGraph.filters,
    args,
    expectedDurationSeconds: expectedDuration(normalized, probe),
    video,
    audio,
    optimizations,
    hardware
  };
}

export function createThumbnailExecutionPlan(
  source: string,
  operations: readonly VideoOperation[],
  output: string,
  options: ThumbnailOptions = {}
): MediaExecutionPlan {
  const normalized = normalizeVideoOperations(operations);
  const trim = getTrim(normalized);
  const at = options.at ?? 0;
  const seek = (trim?.options.start ?? 0) + at;
  const filterGraph = compileVideoFilterGraph(normalized);

  if (trim?.options.duration !== undefined && at > trim.options.duration) {
    throw new InvalidOperationError(
      `Thumbnail time ${at}s is outside the trimmed duration of ${trim.options.duration}s.`
    );
  }

  const args: string[] = [];
  appendOverwrite(args, options.overwrite);
  args.push("-ss", formatNumber(seek), "-i", source, "-frames:v", "1");
  if (filterGraph.expression) args.push("-vf", filterGraph.expression);
  if (options.quality !== undefined) args.push("-q:v", formatNumber(options.quality));
  args.push(output);

  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "thumbnail",
    source,
    output,
    container: detectOutputContainer(output),
    operations: normalized,
    filters: filterGraph.filters,
    args,
    expectedDurationSeconds: null,
    video: {
      requested: null,
      selected: "image",
      mode: "encode",
      reason: "thumbnail-output"
    },
    audio: null,
    optimizations: filterGraph.expression ? ["SINGLE_PASS_FILTER_GRAPH"] : [],
    hardware: null
  };
}

function resolveExtractAudioCodec(
  output: string,
  requested: ExtractAudioOptions["codec"],
  probe: ProbeResult | null
): Exclude<AudioCodec, "none"> {
  const container = detectOutputContainer(output);
  const sourceCodec = mapSourceAudioCodec(probe);

  if (requested === "copy") {
    if (sourceCodec && !isAudioCodecCompatible(container, sourceCodec)) {
      throw new IncompatibleOutputError(
        `Source audio codec "${sourceCodec}" cannot be stream-copied into ${container} output.`
      );
    }
    return "copy";
  }

  if (requested) {
    assertAudioCodecCompatible(container, requested);
    return requested;
  }

  const selected = defaultAudioCodec(container);
  assertAudioCodecCompatible(container, selected);
  return selected;
}

export function createExtractAudioExecutionPlan(
  source: string,
  operations: readonly VideoOperation[],
  output: string,
  options: ExtractAudioOptions = {},
  probe: ProbeResult | null = null
): MediaExecutionPlan {
  const normalized = normalizeVideoOperations(operations);
  const codec = resolveExtractAudioCodec(output, options.codec, probe);
  if (codec === "copy" && options.bitrate !== undefined) {
    throw new InvalidOperationError(
      'Audio bitrate cannot be combined with extractAudio codec "copy".'
    );
  }

  const args: string[] = [];
  appendOverwrite(args, options.overwrite);
  args.push("-i", source);
  appendTrimArgs(args, normalized);
  args.push("-vn", "-c:a", codec === "copy" ? "copy" : AUDIO_CODECS[codec]);
  if (codec !== "copy" && options.bitrate !== undefined) args.push("-b:a", options.bitrate);
  args.push(output);

  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "extract-audio",
    source,
    output,
    container: detectOutputContainer(output),
    operations: normalized,
    filters: [],
    args,
    expectedDurationSeconds: expectedDuration(normalized, probe),
    video: null,
    audio: {
      requested: options.codec ?? null,
      selected: codec,
      mode: codec === "copy" ? "copy" : "encode",
      reason: options.codec ? "requested-codec" : "container-default"
    },
    optimizations: codec === "copy" ? ["AUDIO_STREAM_COPY"] : [],
    hardware: null
  };
}

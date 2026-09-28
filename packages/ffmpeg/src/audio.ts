import type {
  AudioCodec,
  AudioExecutionPlan,
  AudioExportOptions,
  AudioOperation,
  ProbeResult,
  SilenceDetectionOptions,
  SilenceDetectionResult,
  SilenceRange,
  WaveformOptions
} from "@moosky-video/core";
import { IncompatibleOutputError, InvalidOperationError } from "@moosky-video/core";
import {
  assertAudioCodecCompatible,
  defaultAudioCodec,
  detectOutputContainer,
  isAudioCodecCompatible,
  mapSourceAudioCodec
} from "./compatibility.js";
import { FfmpegProgressParser } from "./progress.js";
import { runProcess } from "./process.js";

const AUDIO_CODECS: Record<Exclude<AudioCodec, "copy" | "none">, string> = {
  aac: "aac",
  opus: "libopus",
  mp3: "libmp3lame"
};

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function expectedDuration(operations: readonly AudioOperation[], probe: ProbeResult): number | null {
  const trim = operations.find((operation) => operation.type === "trim");
  if (trim?.type === "trim" && trim.options.duration !== undefined) return trim.options.duration;
  if (probe.durationSeconds === null) return null;
  return Math.max(0, probe.durationSeconds - (trim?.type === "trim" ? trim.options.start : 0));
}

function assertOutput(output: string): void {
  const container = detectOutputContainer(output);
  if (!["mp4", "mov", "webm", "matroska", "m4a", "mp3", "opus"].includes(container)) {
    throw new IncompatibleOutputError(
      `Audio output container is unsupported for ${output}. Use M4A/MP4/MOV, MP3, Opus/Ogg, WebM, or Matroska.`
    );
  }
}

export function createAudioExecutionPlan(
  source: string,
  operations: readonly AudioOperation[],
  output: string,
  options: AudioExportOptions,
  probe: ProbeResult
): AudioExecutionPlan {
  assertOutput(output);
  if (!probe.audio) throw new InvalidOperationError("Audio source does not contain an audio stream.");

  const container = detectOutputContainer(output);
  const requestedCodec = options.codec ?? null;
  const selectedCodec = requestedCodec === "copy"
    ? "copy"
    : requestedCodec ?? defaultAudioCodec(container);

  if (selectedCodec !== "copy") {
    assertAudioCodecCompatible(container, selectedCodec);
  } else {
    const sourceCodec = mapSourceAudioCodec(probe);
    if (sourceCodec && !isAudioCodecCompatible(container, sourceCodec)) {
      throw new IncompatibleOutputError(
        `Source audio codec "${sourceCodec}" cannot be stream-copied into ${container} output.`
      );
    }
  }
  if (selectedCodec === "copy" && operations.length > 0) {
    throw new InvalidOperationError("Audio stream copy cannot be used with audio processing operations.");
  }
  if (selectedCodec === "copy" && options.bitrate) {
    throw new InvalidOperationError("Audio bitrate cannot be set when codec is copy.");
  }

  const duration = expectedDuration(operations, probe);
  const duck = operations.find((operation) => operation.type === "duck-under");
  const inputs = duck?.type === "duck-under" ? [source, duck.options.sidechain] : [source];
  const args: string[] = [options.overwrite === false ? "-n" : "-y", "-i", source];
  if (duck?.type === "duck-under") args.push("-i", duck.options.sidechain);

  const primaryFilters: string[] = [];
  let channelLayout: "mono" | "stereo" | null = null;
  const optimizations: string[] = [];

  for (const operation of operations) {
    switch (operation.type) {
      case "trim":
        primaryFilters.push(`atrim=start=${number(operation.options.start)}${operation.options.duration !== undefined ? `:duration=${number(operation.options.duration)}` : ""}`, "asetpts=PTS-STARTPTS");
        break;
      case "normalize":
        primaryFilters.push(
          `loudnorm=I=${number(operation.options.targetLufs)}:TP=${number(operation.options.truePeakDb)}:LRA=${number(operation.options.loudnessRange)}`
        );
        optimizations.push("LOUDNESS_NORMALIZATION");
        break;
      case "fade-in":
        primaryFilters.push(`afade=t=in:st=0:d=${number(operation.options.duration)}`);
        break;
      case "fade-out": {
        if (duration === null) {
          throw new InvalidOperationError("Audio fade-out requires a source with a known duration.");
        }
        const start = Math.max(0, duration - operation.options.duration);
        primaryFilters.push(`afade=t=out:st=${number(start)}:d=${number(operation.options.duration)}`);
        break;
      }
      case "channels":
        channelLayout = operation.options.layout === "source" ? null : operation.options.layout;
        optimizations.push("CHANNEL_MAPPING");
        break;
      case "duck-under":
        break;
    }
  }

  let filterComplex: string | null = null;
  let audioMap: string | null = null;

  if (operations.length > 0) {
    const graph: string[] = [];
    const chain = primaryFilters.length > 0 ? primaryFilters.join(",") : "anull";
    graph.push(`[0:a]${chain}[primary]`);

    if (duck?.type === "duck-under") {
      const gain = duck.options.sidechainGain === 1 ? "anull" : `volume=${number(duck.options.sidechainGain)}`;
      const padding = Math.max(1, duck.options.releaseMs / 1000 + 0.25);
      const primaryLabel = duration === null ? "primary" : "primaryPadded";
      if (duration !== null) graph.push(`[primary]apad=pad_dur=${number(padding)}[primaryPadded]`);

      if (duck.options.mixSidechain) {
        graph.push(`[1:a]asetpts=PTS-STARTPTS,${gain},asplit=2[sideControlRaw][sideMixRaw]`);
        const sideLabel = duration === null ? "sideControlRaw" : "sideControl";
        if (duration !== null) {
          graph.push(`[sideControlRaw]apad=pad_dur=${number(padding)}[sideControl]`);
          graph.push(`[sideMixRaw]atrim=duration=${number(duration)},apad=whole_dur=${number(duration)}[sideMix]`);
        } else {
          graph.push("[sideMixRaw]anull[sideMix]");
        }
        graph.push(
          `[${primaryLabel}][${sideLabel}]sidechaincompress=threshold=${number(duck.options.threshold)}:ratio=${number(duck.options.ratio)}:attack=${number(duck.options.attackMs)}:release=${number(duck.options.releaseMs)}${duration !== null ? `,atrim=duration=${number(duration)}` : ""}[ducked]`
        );
        graph.push(`[ducked][sideMix]amix=inputs=2:duration=longest:dropout_transition=0${duration !== null ? `,atrim=duration=${number(duration)}` : ""}[mixed]`);
        audioMap = "[mixed]";
      } else {
        graph.push(`[1:a]asetpts=PTS-STARTPTS,${gain}${duration !== null ? `,apad=pad_dur=${number(padding)}` : ""}[side]`);
        graph.push(
          `[${primaryLabel}][side]sidechaincompress=threshold=${number(duck.options.threshold)}:ratio=${number(duck.options.ratio)}:attack=${number(duck.options.attackMs)}:release=${number(duck.options.releaseMs)}${duration !== null ? `,atrim=duration=${number(duration)}` : ""}[ducked]`
        );
        audioMap = "[ducked]";
      }
      optimizations.push("SIDECHAIN_DUCKING");
    } else {
      audioMap = "[primary]";
    }

    filterComplex = graph.join(";");
    args.push("-filter_complex", filterComplex, "-map", audioMap);
  } else {
    args.push("-map", "0:a:0");
    optimizations.push(selectedCodec === "copy" ? "AUDIO_STREAM_COPY" : "AUDIO_TRANSCODE");
  }

  args.push("-vn", "-c:a", selectedCodec === "copy" ? "copy" : AUDIO_CODECS[selectedCodec]);
  if (selectedCodec !== "copy" && options.bitrate) args.push("-b:a", options.bitrate);
  if (channelLayout === "mono") args.push("-ac", "1");
  if (channelLayout === "stereo") args.push("-ac", "2");
  if (duration !== null) args.push("-t", number(duration));
  args.push(output);

  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "audio-export",
    source,
    output,
    operations,
    inputs,
    filterComplex,
    audioMap,
    args,
    expectedDurationSeconds: duration,
    optimizations
  };
}

export interface RunAudioPlanOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: AudioExportOptions["onProgress"];
}

export async function runAudioExecutionPlan(
  ffmpegPath: string,
  plan: AudioExecutionPlan,
  options: RunAudioPlanOptions = {}
) {
  const progressParser = options.onProgress
    ? new FfmpegProgressParser(plan.expectedDurationSeconds)
    : null;
  const result = await runProcess(
    ffmpegPath,
    ["-hide_banner", "-nostats", ...(progressParser ? ["-progress", "pipe:1"] : []), ...plan.args],
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(progressParser && options.onProgress
        ? { onStdoutChunk: (chunk: string) => progressParser.push(chunk, options.onProgress!) }
        : {})
    }
  );
  return { output: plan.output, exitCode: result.exitCode };
}

export function parseSilenceDetectOutput(
  source: string,
  stderr: string,
  options: Required<Pick<SilenceDetectionOptions, "noiseDb" | "minDuration">>,
  sourceDuration: number | null = null
): SilenceDetectionResult {
  const ranges: SilenceRange[] = [];
  let openStart: number | null = null;

  for (const line of stderr.split(/\r?\n/u)) {
    const startMatch = /silence_start:\s*([0-9.]+)/u.exec(line);
    if (startMatch) {
      openStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/u.exec(line);
    if (endMatch) {
      const end = Number(endMatch[1]);
      const duration = Number(endMatch[2]);
      const start = openStart ?? Math.max(0, end - duration);
      ranges.push({ start, end, duration });
      openStart = null;
    }
  }

  if (openStart !== null && sourceDuration !== null && sourceDuration >= openStart) {
    ranges.push({ start: openStart, end: sourceDuration, duration: sourceDuration - openStart });
  }

  return {
    source,
    noiseDb: options.noiseDb,
    minDuration: options.minDuration,
    ranges
  };
}

export async function detectSilence(
  ffmpegPath: string,
  source: string,
  options: SilenceDetectionOptions = {},
  sourceDuration: number | null = null
): Promise<SilenceDetectionResult> {
  const noiseDb = options.noiseDb ?? -40;
  const minDuration = options.minDuration ?? 0.5;
  if (!Number.isFinite(noiseDb) || noiseDb > 0 || noiseDb < -120) {
    throw new InvalidOperationError("silence.noiseDb must be between -120 and 0.");
  }
  if (!Number.isFinite(minDuration) || minDuration <= 0) {
    throw new InvalidOperationError("silence.minDuration must be greater than 0.");
  }

  const result = await runProcess(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      source,
      "-af",
      `silencedetect=noise=${number(noiseDb)}dB:d=${number(minDuration)}`,
      "-f",
      "null",
      "-"
    ],
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    }
  );

  return parseSilenceDetectOutput(source, result.stderr, { noiseDb, minDuration }, sourceDuration);
}

function safeColor(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^(?:[a-zA-Z]+|#[0-9a-fA-F]{6,8}|0x[0-9a-fA-F]{6,8})(?:@[0-9.]+)?$/u.test(trimmed)) {
    throw new InvalidOperationError(`${label} is not a supported FFmpeg color value.`);
  }
  return trimmed;
}

export function compileWaveformArgs(
  source: string,
  output: string,
  options: WaveformOptions = {}
): string[] {
  const width = options.width ?? 1200;
  const height = options.height ?? 240;
  if (!Number.isInteger(width) || width <= 0 || width > 8192) {
    throw new InvalidOperationError("waveform.width must be a positive integer up to 8192.");
  }
  if (!Number.isInteger(height) || height <= 0 || height > 4096) {
    throw new InvalidOperationError("waveform.height must be a positive integer up to 4096.");
  }
  const color = safeColor(options.color ?? "white", "waveform.color");
  const background = safeColor(options.background ?? "#0b1220", "waveform.background");
  const graph = `color=c=${background}:s=${width}x${height}[bg];[0:a]aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=${color}[wave];[bg][wave]overlay=format=auto[out]`;
  return [
    options.overwrite === false ? "-n" : "-y",
    "-i",
    source,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    output
  ];
}

export async function generateWaveform(
  ffmpegPath: string,
  source: string,
  output: string,
  options: WaveformOptions = {}
) {
  const args = compileWaveformArgs(source, output, options);
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-nostats", ...args], {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  return { output, exitCode: result.exitCode };
}

import type {
  AudioStreamInfo,
  ProbeOptions,
  ProbeResult,
  VideoStreamInfo
} from "@moosky-video/core";
import { ProbeError } from "@moosky-video/core";
import { runProcess } from "./process.js";

type FfprobeTags = Record<string, string | undefined>;

interface FfprobeSideData {
  rotation?: number;
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  tags?: FfprobeTags;
  side_data_list?: FfprobeSideData[];
}

interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

export interface RawFfprobeResult {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function toFiniteNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFrameRate(value: string | undefined): number | null {
  if (!value || value === "0/0") return null;
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw ?? "1");

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function parseRotation(stream: FfprobeStream): number {
  const sideRotation = stream.side_data_list
    ?.map((item) => item.rotation)
    .find((rotation): rotation is number => typeof rotation === "number");

  if (sideRotation !== undefined && Number.isFinite(sideRotation)) {
    return sideRotation;
  }

  const tagRotation = Number(stream.tags?.rotate);
  return Number.isFinite(tagRotation) ? tagRotation : 0;
}

function normalizeVideoStream(stream: FfprobeStream): VideoStreamInfo {
  return {
    index: stream.index ?? 0,
    codec: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    fps: parseFrameRate(stream.avg_frame_rate ?? stream.r_frame_rate),
    pixelFormat: stream.pix_fmt ?? null,
    bitRate: toFiniteNumber(stream.bit_rate),
    rotation: parseRotation(stream)
  };
}

function normalizeAudioStream(stream: FfprobeStream): AudioStreamInfo {
  return {
    index: stream.index ?? 0,
    codec: stream.codec_name ?? null,
    sampleRate: toFiniteNumber(stream.sample_rate),
    channels: stream.channels ?? null,
    channelLayout: stream.channel_layout ?? null,
    bitRate: toFiniteNumber(stream.bit_rate)
  };
}

export function normalizeProbeResult(source: string, raw: RawFfprobeResult): ProbeResult {
  const streams = raw.streams ?? [];
  const videoStreams = streams
    .filter((stream) => stream.codec_type === "video")
    .map(normalizeVideoStream);
  const audioStreams = streams
    .filter((stream) => stream.codec_type === "audio")
    .map(normalizeAudioStream);

  return {
    source,
    format: raw.format?.format_name ?? null,
    durationSeconds: toFiniteNumber(raw.format?.duration),
    sizeBytes: toFiniteNumber(raw.format?.size),
    bitRate: toFiniteNumber(raw.format?.bit_rate),
    video: videoStreams[0] ?? null,
    audio: audioStreams[0] ?? null,
    videoStreams,
    audioStreams
  };
}

export async function probeMedia(
  source: string,
  ffprobePath: string,
  options: ProbeOptions = {}
): Promise<ProbeResult> {
  try {
    const result = await runProcess(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        source
      ],
      options
    );

    const raw = JSON.parse(result.stdout) as RawFfprobeResult;
    return normalizeProbeResult(source, raw);
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw new ProbeError("ffprobe returned invalid JSON.", { cause });
    }
    throw cause;
  }
}

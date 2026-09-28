import { extname } from "node:path";
import type {
  AudioCodec,
  OutputContainer,
  ProbeResult,
  VideoCodec
} from "@vexa-video/core";
import { IncompatibleOutputError } from "@vexa-video/core";

const VIDEO_BY_CONTAINER: Partial<Record<OutputContainer, readonly Exclude<VideoCodec, "copy">[]>> = {
  mp4: ["h264", "h265", "av1"],
  mov: ["h264", "h265"],
  webm: ["vp9", "av1"],
  matroska: ["h264", "h265", "av1", "vp9"],
  m4a: [],
  mp3: [],
  opus: [],
  jpeg: [],
  png: []
};

const AUDIO_BY_CONTAINER: Partial<Record<OutputContainer, readonly Exclude<AudioCodec, "copy" | "none">[]>> = {
  mp4: ["aac", "mp3"],
  mov: ["aac", "mp3"],
  webm: ["opus"],
  matroska: ["aac", "opus", "mp3"],
  m4a: ["aac"],
  mp3: ["mp3"],
  opus: ["opus"],
  jpeg: [],
  png: []
};

export function detectOutputContainer(output: string): OutputContainer {
  switch (extname(output).toLowerCase()) {
    case ".mp4":
    case ".m4v":
      return "mp4";
    case ".mov":
      return "mov";
    case ".webm":
      return "webm";
    case ".mkv":
    case ".mka":
      return "matroska";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".png":
      return "png";
    case ".m4a":
      return "m4a";
    case ".mp3":
      return "mp3";
    case ".opus":
    case ".ogg":
      return "opus";
    default:
      return "unknown";
  }
}

export function mapSourceVideoCodec(probe: ProbeResult | null): Exclude<VideoCodec, "copy"> | null {
  const codec = probe?.video?.codec?.toLowerCase();
  if (!codec) return null;
  if (codec === "h264" || codec === "avc1") return "h264";
  if (codec === "hevc" || codec === "h265") return "h265";
  if (codec === "av1") return "av1";
  if (codec === "vp9") return "vp9";
  return null;
}

export function mapSourceAudioCodec(probe: ProbeResult | null): Exclude<AudioCodec, "copy" | "none"> | null {
  const codec = probe?.audio?.codec?.toLowerCase();
  if (!codec) return null;
  if (codec === "aac") return "aac";
  if (codec === "opus") return "opus";
  if (codec.startsWith("mp3")) return "mp3";
  return null;
}

export function defaultVideoCodec(container: OutputContainer): Exclude<VideoCodec, "copy"> {
  return container === "webm" ? "vp9" : "h264";
}

export function defaultAudioCodec(container: OutputContainer): Exclude<AudioCodec, "copy" | "none"> {
  if (container === "webm" || container === "opus") return "opus";
  if (container === "mp3") return "mp3";
  return "aac";
}

export function isVideoCodecCompatible(
  container: OutputContainer,
  codec: Exclude<VideoCodec, "copy">
): boolean {
  const allowed = VIDEO_BY_CONTAINER[container];
  return allowed ? allowed.includes(codec) : true;
}

export function isAudioCodecCompatible(
  container: OutputContainer,
  codec: Exclude<AudioCodec, "copy" | "none">
): boolean {
  const allowed = AUDIO_BY_CONTAINER[container];
  return allowed ? allowed.includes(codec) : true;
}

export function assertVideoCodecCompatible(
  container: OutputContainer,
  codec: Exclude<VideoCodec, "copy">
): void {
  if (!isVideoCodecCompatible(container, codec)) {
    throw new IncompatibleOutputError(
      `Video codec "${codec}" is not supported by the SDK compatibility profile for ${container} output.`
    );
  }
}

export function assertAudioCodecCompatible(
  container: OutputContainer,
  codec: Exclude<AudioCodec, "copy" | "none">
): void {
  if (!isAudioCodecCompatible(container, codec)) {
    throw new IncompatibleOutputError(
      `Audio codec "${codec}" is not supported by the SDK compatibility profile for ${container} output.`
    );
  }
}

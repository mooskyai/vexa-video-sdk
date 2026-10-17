import { Mp4MuxInputError, muxH264Mp4 } from "./mp4.js";
import type { VexaWebAudioEncodeResult, VexaWebEncodedAudioChunk } from "./audio.js";
import type { VexaWebEncodedVideoChunk, VexaWebMuxedVideoResult, VexaWebVideoEncodeResult } from "./index.js";

export class VexaWebMediaMuxError extends Error {
  readonly code: "INVALID_MUX_INPUT" | "CONTAINER_MUX_UNSUPPORTED";

  constructor(code: "INVALID_MUX_INPUT" | "CONTAINER_MUX_UNSUPPORTED", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VexaWebMediaMuxError";
    this.code = code;
  }
}

export interface VexaWebMuxedMediaResult extends VexaWebMuxedVideoResult {
  readonly audioCodec: "aac" | "opus";
}

const EBML_ID = Object.freeze({
  ebml: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
  segment: new Uint8Array([0x18, 0x53, 0x80, 0x67]),
  info: new Uint8Array([0x15, 0x49, 0xa9, 0x66]),
  tracks: new Uint8Array([0x16, 0x54, 0xae, 0x6b]),
  cluster: new Uint8Array([0x1f, 0x43, 0xb6, 0x75])
});

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function ebmlSize(value: number): Uint8Array {
  for (let length = 1; length <= 8; length += 1) {
    if (value > (2 ** (7 * length)) - 2) continue;
    const bytes = new Uint8Array(length);
    let remaining = value;
    for (let index = length - 1; index >= 0; index -= 1) {
      bytes[index] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
    bytes[0] = (bytes[0] ?? 0) | (1 << (8 - length));
    return bytes;
  }
  throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "WebM element exceeds supported EBML size.");
}

function uintBytes(value: number): Uint8Array {
  let length = 1;
  while (length < 8 && value >= 2 ** (8 * length)) length += 1;
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function float64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return bytes;
}

function element(id: readonly number[] | Uint8Array, payload: Uint8Array): Uint8Array {
  const bytes = id instanceof Uint8Array ? id : new Uint8Array(id);
  return concat([bytes, ebmlSize(payload.byteLength), payload]);
}

function uint(id: readonly number[], value: number): Uint8Array {
  return element(id, uintBytes(value));
}

function string(id: readonly number[], value: string): Uint8Array {
  return element(id, new TextEncoder().encode(value));
}

function ebmlHeader(): Uint8Array {
  return element(EBML_ID.ebml, concat([
    uint([0x42, 0x86], 1), uint([0x42, 0xf7], 1), uint([0x42, 0xf2], 4), uint([0x42, 0xf3], 8),
    string([0x42, 0x82], "webm"), uint([0x42, 0x87], 4), uint([0x42, 0x85], 2)
  ]));
}

function opusHead(audio: VexaWebAudioEncodeResult): Uint8Array {
  if (!Number.isInteger(audio.numberOfChannels) || audio.numberOfChannels < 1 || audio.numberOfChannels > 255) {
    throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "WebM Opus channel count must be between 1 and 255.");
  }
  const out = new Uint8Array(19);
  out.set(new TextEncoder().encode("OpusHead"), 0);
  out[8] = 1;
  out[9] = audio.numberOfChannels;
  const view = new DataView(out.buffer);
  view.setUint16(10, 0, true);
  view.setUint32(12, audio.sampleRate, true);
  view.setInt16(16, 0, true);
  out[18] = 0;
  return out;
}

function tracks(video: VexaWebVideoEncodeResult, audio: VexaWebAudioEncodeResult): Uint8Array {
  const videoCodecId = video.videoCodec === "vp9" ? "V_VP9" : "V_AV1";
  const videoEntry = element([0xae], concat([
    uint([0xd7], 1), uint([0x73, 0xc5], 1), uint([0x83], 1), string([0x86], videoCodecId),
    uint([0x23, 0xe3, 0x83], Math.max(1, Math.round(1_000_000_000 / video.fps))),
    element([0xe0], concat([uint([0xb0], video.width), uint([0xba], video.height)]))
  ]));
  const audioEntry = element([0xae], concat([
    uint([0xd7], 2), uint([0x73, 0xc5], 2), uint([0x83], 2), string([0x86], "A_OPUS"),
    element([0x63, 0xa2], opusHead(audio)),
    element([0xe1], concat([
      element([0xb5], float64(audio.sampleRate)),
      uint([0x9f], audio.numberOfChannels)
    ]))
  ]));
  return element(EBML_ID.tracks, concat([videoEntry, audioEntry]));
}

function simpleBlock(
  track: 1 | 2,
  chunk: VexaWebEncodedVideoChunk | VexaWebEncodedAudioChunk,
  relativeTimestampMs: number,
  key: boolean
): Uint8Array {
  if (!Number.isInteger(relativeTimestampMs) || relativeTimestampMs < -32_768 || relativeTimestampMs > 32_767) {
    throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "WebM block timestamp is outside the signed 16-bit range.");
  }
  const header = new Uint8Array(4);
  header[0] = 0x80 | track;
  new DataView(header.buffer).setInt16(1, relativeTimestampMs, false);
  header[3] = key ? 0x80 : 0;
  return element([0xa3], concat([header, chunk.data]));
}

function validateChunks(
  chunks: readonly (VexaWebEncodedVideoChunk | VexaWebEncodedAudioChunk)[],
  label: string
): void {
  if (chunks.length === 0) throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", `${label} muxing requires encoded chunks.`);
  let previous = -1;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0 || chunk.timestampUs < previous) {
      throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", `${label} chunk timestamps must be non-negative and monotonic.`);
    }
    if (chunk.data.byteLength === 0) throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", `${label} chunks must not be empty.`);
    previous = chunk.timestampUs;
  }
}

function validateSync(video: VexaWebVideoEncodeResult, audio: VexaWebAudioEncodeResult): void {
  validateChunks(video.chunks, "Video");
  validateChunks(audio.chunks, "Audio");
  if (video.chunks[0]?.type !== "key") {
    throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "A/V muxing requires the first video chunk to be a keyframe.");
  }
  if (video.chunks[0]?.timestampUs !== 0 || audio.chunks[0]?.timestampUs !== 0) {
    throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "A/V muxing requires both encoded streams to start at timestamp zero.");
  }
  const audioWindow = (audio.chunks[0]?.durationUs ?? 0) / 1_000_000;
  const tolerance = Math.max(0.05, 2 / video.fps, audioWindow * 2);
  if (Math.abs(video.durationSeconds - audio.durationSeconds) > tolerance) {
    throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "Audio/video durations differ beyond the muxing tolerance.");
  }
}

function webm(video: VexaWebVideoEncodeResult, audio: VexaWebAudioEncodeResult): Uint8Array {
  type Packet = Readonly<{
    track: 1 | 2;
    timestampUs: number;
    key: boolean;
    chunk: VexaWebEncodedVideoChunk | VexaWebEncodedAudioChunk;
  }>;
  const packets: Packet[] = [
    ...video.chunks.map((chunk) => ({ track: 1 as const, timestampUs: chunk.timestampUs, key: chunk.type === "key", chunk })),
    ...audio.chunks.map((chunk) => ({ track: 2 as const, timestampUs: chunk.timestampUs, key: true, chunk }))
  ];
  packets.sort((left, right) => left.timestampUs - right.timestampUs || left.track - right.track);

  const clusters: Uint8Array[] = [];
  let clusterStartMs = -1;
  let blocks: Uint8Array[] = [];
  const flush = () => {
    if (blocks.length === 0) return;
    clusters.push(element(EBML_ID.cluster, concat([uint([0xe7], clusterStartMs), ...blocks])));
    blocks = [];
  };
  for (const packet of packets) {
    const timestampMs = Math.round(packet.timestampUs / 1_000);
    if (clusterStartMs < 0 || blocks.length === 0) clusterStartMs = timestampMs;
    if (timestampMs - clusterStartMs > 30_000) {
      flush();
      clusterStartMs = timestampMs;
    }
    blocks.push(simpleBlock(packet.track, packet.chunk, timestampMs - clusterStartMs, packet.key));
  }
  flush();

  const durationMs = Math.max(video.durationSeconds, audio.durationSeconds) * 1_000;
  const info = element(EBML_ID.info, concat([
    uint([0x2a, 0xd7, 0xb1], 1_000_000),
    element([0x44, 0x89], float64(durationMs)),
    string([0x4d, 0x80], "Vexa Video SDK"), string([0x57, 0x41], "Vexa Video SDK")
  ]));
  return concat([ebmlHeader(), element(EBML_ID.segment, concat([info, tracks(video, audio), ...clusters]))]);
}

export function muxWebMedia(
  video: VexaWebVideoEncodeResult,
  audio: VexaWebAudioEncodeResult
): VexaWebMuxedMediaResult {
  validateSync(video, audio);
  let data: Uint8Array;
  let mimeType: "video/mp4" | "video/webm";

  if (video.targetContainer === "mp4" && video.videoCodec === "h264" && audio.audioCodec === "aac") {
    const videoConfig = video.decoderConfig?.description;
    const audioConfig = audio.decoderConfig?.description;
    if (videoConfig === undefined || audioConfig === undefined) {
      throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", "H.264/AAC MP4 muxing requires video and audio decoder configuration metadata.");
    }
    try {
      data = muxH264Mp4({
        width: video.width,
        height: video.height,
        fps: video.fps,
        frameCount: video.frameCount,
        durationSeconds: video.durationSeconds,
        decoderConfig: videoConfig,
        chunks: video.chunks,
        audio: {
          sampleRate: audio.sampleRate,
          numberOfChannels: audio.numberOfChannels,
          decoderConfig: audioConfig,
          chunks: audio.chunks
        }
      });
    } catch (error) {
      if (error instanceof Mp4MuxInputError) {
        throw new VexaWebMediaMuxError("INVALID_MUX_INPUT", error.message, { cause: error });
      }
      throw error;
    }
    mimeType = "video/mp4";
  } else if (video.targetContainer === "webm"
      && (video.videoCodec === "vp9" || video.videoCodec === "av1")
      && audio.audioCodec === "opus") {
    data = webm(video, audio);
    mimeType = "video/webm";
  } else {
    throw new VexaWebMediaMuxError(
      "CONTAINER_MUX_UNSUPPORTED",
      "Browser A/V muxing supports H.264/AAC MP4 and VP9-or-AV1/Opus WebM only."
    );
  }

  const blobBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const blob = new Blob([blobBuffer], { type: mimeType });
  return Object.freeze({
    kind: "muxed-video",
    container: video.targetContainer,
    mimeType,
    videoCodec: video.videoCodec,
    audioCodec: audio.audioCodec,
    width: video.width,
    height: video.height,
    fps: video.fps,
    frameCount: video.frameCount,
    durationSeconds: Math.max(video.durationSeconds, audio.durationSeconds),
    data,
    blob
  });
}

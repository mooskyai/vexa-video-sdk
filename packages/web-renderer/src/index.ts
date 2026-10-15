import { Mp4MuxInputError, muxH264Mp4 } from "./mp4.js";

export * from "./audio.js";
export * from "./media-mux.js";

export type VexaWebVideoCodec = "h264" | "vp9" | "av1";
export type VexaWebAudioCodec = "aac" | "opus";
export type VexaWebContainer = "mp4" | "webm";

export type VexaWebRenderFallbackCode =
  | "WEBCODECS_UNAVAILABLE"
  | "VIDEO_CODEC_UNSUPPORTED"
  | "AUDIO_CODEC_UNSUPPORTED"
  | "CONTAINER_CODEC_UNSUPPORTED";

export interface VexaWebCodecSupport {
  readonly h264: boolean;
  readonly vp9: boolean;
  readonly av1: boolean;
  readonly aac: boolean;
  readonly opus: boolean;
}

export interface VexaWebRenderCapabilities {
  readonly webCodecs: boolean;
  readonly codecs: VexaWebCodecSupport;
  readonly supportedVideoCodecs: readonly VexaWebVideoCodec[];
  readonly supportedAudioCodecs: readonly VexaWebAudioCodec[];
  readonly supportedContainers: readonly VexaWebContainer[];
}

export interface VexaWebRenderProbeRuntime {
  readonly hasVideoEncoder: boolean;
  readonly hasAudioEncoder: boolean;
  readonly supportsVideo: (config: Readonly<{ codec: string }>) => Promise<boolean>;
  readonly supportsAudio: (config: Readonly<{ codec: string }>) => Promise<boolean>;
}

export interface VexaWebRenderRequest {
  readonly container?: VexaWebContainer;
  readonly videoCodec?: VexaWebVideoCodec;
  readonly audio?: boolean;
  readonly audioCodec?: VexaWebAudioCodec;
}

export interface VexaWebRenderBrowserPlan {
  readonly kind: "browser";
  readonly container: VexaWebContainer;
  readonly videoCodec: VexaWebVideoCodec;
  readonly audioCodec?: VexaWebAudioCodec;
}

export interface VexaWebRenderBackendFallback {
  readonly kind: "backend-fallback";
  readonly code: VexaWebRenderFallbackCode;
  readonly reason: string;
  readonly requestedContainer: VexaWebContainer;
  readonly requestedVideoCodec?: VexaWebVideoCodec;
  readonly requestedAudioCodec?: VexaWebAudioCodec;
}

export type VexaWebRenderPlan = VexaWebRenderBrowserPlan | VexaWebRenderBackendFallback;

const VIDEO_CODEC_CONFIG: Readonly<Record<VexaWebVideoCodec, string>> = Object.freeze({
  h264: "avc1.42E01E",
  vp9: "vp09.00.10.08",
  av1: "av01.0.04M.08"
});

const AUDIO_CODEC_CONFIG: Readonly<Record<VexaWebAudioCodec, string>> = Object.freeze({
  aac: "mp4a.40.2",
  opus: "opus"
});

function freezeCapabilities(
  webCodecs: boolean,
  codecs: VexaWebCodecSupport
): VexaWebRenderCapabilities {
  const supportedVideoCodecs = (["h264", "vp9", "av1"] as const).filter((codec) => codecs[codec]);
  const supportedAudioCodecs = (["aac", "opus"] as const).filter((codec) => codecs[codec]);
  const containers: VexaWebContainer[] = [];
  if (codecs.h264) containers.push("mp4");
  if (codecs.vp9 || codecs.av1) containers.push("webm");
  return Object.freeze({
    webCodecs,
    codecs: Object.freeze({ ...codecs }),
    supportedVideoCodecs: Object.freeze(supportedVideoCodecs),
    supportedAudioCodecs: Object.freeze(supportedAudioCodecs),
    supportedContainers: Object.freeze(containers)
  });
}

function defaultRuntime(): VexaWebRenderProbeRuntime {
  const globalValue = globalThis as typeof globalThis & {
    VideoEncoder?: { isConfigSupported(config: { codec: string; width: number; height: number; bitrate: number; framerate: number }): Promise<{ supported?: boolean }> };
    AudioEncoder?: { isConfigSupported(config: { codec: string; sampleRate: number; numberOfChannels: number; bitrate: number }): Promise<{ supported?: boolean }> };
  };
  return {
    hasVideoEncoder: typeof globalValue.VideoEncoder?.isConfigSupported === "function",
    hasAudioEncoder: typeof globalValue.AudioEncoder?.isConfigSupported === "function",
    async supportsVideo(config) {
      if (!globalValue.VideoEncoder) return false;
      try {
        const result = await globalValue.VideoEncoder.isConfigSupported({ codec: config.codec, width: 16, height: 16, bitrate: 100_000, framerate: 30 });
        return result.supported === true;
      } catch {
        return false;
      }
    },
    async supportsAudio(config) {
      if (!globalValue.AudioEncoder) return false;
      try {
        const result = await globalValue.AudioEncoder.isConfigSupported({ codec: config.codec, sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 });
        return result.supported === true;
      } catch {
        return false;
      }
    }
  };
}

export async function detectWebRenderCapabilities(
  runtime: VexaWebRenderProbeRuntime = defaultRuntime()
): Promise<VexaWebRenderCapabilities> {
  if (!runtime.hasVideoEncoder) {
    return freezeCapabilities(false, { h264: false, vp9: false, av1: false, aac: false, opus: false });
  }
  const [h264, vp9, av1] = await Promise.all([
    runtime.supportsVideo({ codec: VIDEO_CODEC_CONFIG.h264 }),
    runtime.supportsVideo({ codec: VIDEO_CODEC_CONFIG.vp9 }),
    runtime.supportsVideo({ codec: VIDEO_CODEC_CONFIG.av1 })
  ] as const);
  const [aac, opus]: readonly [boolean, boolean] = runtime.hasAudioEncoder
    ? await Promise.all([
        runtime.supportsAudio({ codec: AUDIO_CODEC_CONFIG.aac }),
        runtime.supportsAudio({ codec: AUDIO_CODEC_CONFIG.opus })
      ] as const)
    : [false, false];
  return freezeCapabilities(true, { h264, vp9, av1, aac, opus });
}

function fallback(
  code: VexaWebRenderFallbackCode,
  reason: string,
  request: Required<Pick<VexaWebRenderRequest, "container">> & VexaWebRenderRequest
): VexaWebRenderBackendFallback {
  const result: VexaWebRenderBackendFallback = {
    kind: "backend-fallback",
    code,
    reason,
    requestedContainer: request.container
  };
  return Object.freeze({
    ...result,
    ...(request.videoCodec === undefined ? {} : { requestedVideoCodec: request.videoCodec }),
    ...(request.audioCodec === undefined ? {} : { requestedAudioCodec: request.audioCodec })
  });
}

export function planWebRender(
  request: VexaWebRenderRequest,
  capabilities: VexaWebRenderCapabilities
): VexaWebRenderPlan {
  const container = request.container ?? "mp4";
  const wantsAudio = request.audio ?? false;
  const defaultVideo: VexaWebVideoCodec = container === "mp4" ? "h264" : capabilities.codecs.vp9 ? "vp9" : "av1";
  const videoCodec = request.videoCodec ?? defaultVideo;
  const audioCodec = wantsAudio ? (request.audioCodec ?? (container === "mp4" ? "aac" : "opus")) : undefined;
  const normalized = { ...request, container, videoCodec, ...(audioCodec === undefined ? {} : { audioCodec }) };

  if (!capabilities.webCodecs) {
    return fallback("WEBCODECS_UNAVAILABLE", "Browser WebCodecs video encoding is unavailable.", normalized);
  }
  if (!capabilities.codecs[videoCodec]) {
    return fallback("VIDEO_CODEC_UNSUPPORTED", `Browser video codec ${videoCodec} is unsupported.`, normalized);
  }
  if (container === "mp4" && videoCodec !== "h264") {
    return fallback("CONTAINER_CODEC_UNSUPPORTED", "The V2.11 MP4 browser path requires H.264 video.", normalized);
  }
  if (container === "webm" && videoCodec === "h264") {
    return fallback("CONTAINER_CODEC_UNSUPPORTED", "The V2.11 WebM browser path requires VP9 or AV1 video.", normalized);
  }
  if (audioCodec !== undefined) {
    if (!capabilities.codecs[audioCodec]) {
      return fallback("AUDIO_CODEC_UNSUPPORTED", `Browser audio codec ${audioCodec} is unsupported.`, normalized);
    }
    if ((container === "mp4" && audioCodec !== "aac") || (container === "webm" && audioCodec !== "opus")) {
      return fallback("CONTAINER_CODEC_UNSUPPORTED", `Audio codec ${audioCodec} is not supported for ${container}.`, normalized);
    }
  }
  return Object.freeze({ kind: "browser", container, videoCodec, ...(audioCodec === undefined ? {} : { audioCodec }) });
}

export type VexaWebVideoEncodeErrorCode =
  | "AUDIO_EXECUTION_UNAVAILABLE"
  | "ENCODER_UNAVAILABLE"
  | "INVALID_ENCODE_REQUEST"
  | "FRAME_RENDER_FAILED"
  | "ENCODE_FAILED"
  | "CANCELLED";

export class VexaWebVideoEncodeError extends Error {
  readonly code: VexaWebVideoEncodeErrorCode;

  constructor(code: VexaWebVideoEncodeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VexaWebVideoEncodeError";
    this.code = code;
  }
}

export interface VexaWebVideoFrameHandle {
  close(): void;
}

export interface VexaWebEncodedVideoChunkHandle {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly duration?: number | null;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
}

export interface VexaWebVideoDecoderConfigHandle {
  readonly codec: string;
  readonly codedWidth?: number;
  readonly codedHeight?: number;
  readonly description?: AllowSharedBufferSource;
}

export interface VexaWebEncodedVideoChunkMetadataHandle {
  readonly decoderConfig?: VexaWebVideoDecoderConfigHandle;
}

export interface VexaWebVideoDecoderConfig {
  readonly codec: string;
  readonly codedWidth?: number;
  readonly codedHeight?: number;
  readonly description?: Uint8Array;
}

export interface VexaWebVideoEncoderHandle {
  readonly encodeQueueSize: number;
  configure(config: Readonly<{
    codec: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
    latencyMode?: "quality" | "realtime";
    avc?: Readonly<{ format: "avc" | "annexb" }>;
  }>): void;
  encode(frame: VexaWebVideoFrameHandle, options?: Readonly<{ keyFrame?: boolean }>): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}

export interface VexaWebVideoEncodingRuntime {
  createVideoFrame(
    source: unknown,
    init: Readonly<{ timestamp: number; duration: number }>
  ): VexaWebVideoFrameHandle;
  createVideoEncoder(callbacks: Readonly<{
    output: (chunk: VexaWebEncodedVideoChunkHandle, metadata?: VexaWebEncodedVideoChunkMetadataHandle) => void;
    error: (error: Error) => void;
  }>): VexaWebVideoEncoderHandle;
}

export interface VexaWebVideoFrameContext {
  readonly frame: number;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly timestampUs: number;
  readonly durationUs: number;
}

export interface VexaWebVideoEncodeProgress {
  readonly phase: "encoding" | "complete";
  readonly completedFrames: number;
  readonly totalFrames: number;
  readonly progress: number;
}

export interface VexaWebEncodedVideoChunk {
  readonly type: "key" | "delta";
  readonly timestampUs: number;
  readonly durationUs?: number;
  readonly data: Uint8Array;
}

export interface VexaWebVideoEncodeOptions {
  readonly plan: VexaWebRenderBrowserPlan;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly bitrate?: number;
  readonly keyFrameInterval?: number;
  readonly maxQueueSize?: number;
  readonly signal?: AbortSignal;
  readonly renderFrame: (
    context: VexaWebVideoFrameContext,
    signal: AbortSignal | undefined
  ) => unknown | Promise<unknown>;
  readonly onProgress?: (progress: VexaWebVideoEncodeProgress) => void;
  readonly runtime?: VexaWebVideoEncodingRuntime;
}

export interface VexaWebVideoEncodeResult {
  readonly kind: "encoded-video-chunks";
  readonly targetContainer: VexaWebContainer;
  readonly videoCodec: VexaWebVideoCodec;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly decoderConfig?: VexaWebVideoDecoderConfig;
  readonly chunks: readonly VexaWebEncodedVideoChunk[];
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new VexaWebVideoEncodeError("INVALID_ENCODE_REQUEST", `${name} must be a positive integer.`);
  }
  return value;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new VexaWebVideoEncodeError("INVALID_ENCODE_REQUEST", `${name} must be a positive finite number.`);
  }
  return value;
}

function defaultEncodingRuntime(): VexaWebVideoEncodingRuntime {
  const globalValue = globalThis as typeof globalThis & {
    VideoFrame?: new (
      source: unknown,
      init: Readonly<{ timestamp: number; duration: number }>
    ) => VexaWebVideoFrameHandle;
    VideoEncoder?: new (callbacks: Readonly<{
      output: (chunk: VexaWebEncodedVideoChunkHandle, metadata?: VexaWebEncodedVideoChunkMetadataHandle) => void;
      error: (error: Error) => void;
    }>) => VexaWebVideoEncoderHandle;
  };
  if (typeof globalValue.VideoFrame !== "function" || typeof globalValue.VideoEncoder !== "function") {
    throw new VexaWebVideoEncodeError(
      "ENCODER_UNAVAILABLE",
      "Browser VideoFrame/VideoEncoder execution is unavailable."
    );
  }
  return {
    createVideoFrame(source, init) {
      return new globalValue.VideoFrame!(source, init);
    },
    createVideoEncoder(callbacks) {
      return new globalValue.VideoEncoder!(callbacks);
    }
  };
}

function cancellationError(): VexaWebVideoEncodeError {
  return new VexaWebVideoEncodeError("CANCELLED", "Browser video encoding was cancelled.");
}

function copyBufferSource(source: AllowSharedBufferSource): Uint8Array {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  return Uint8Array.from(view);
}

function copyDecoderConfig(config: VexaWebVideoDecoderConfigHandle): VexaWebVideoDecoderConfig {
  return Object.freeze({
    codec: config.codec,
    ...(config.codedWidth === undefined ? {} : { codedWidth: config.codedWidth }),
    ...(config.codedHeight === undefined ? {} : { codedHeight: config.codedHeight }),
    ...(config.description === undefined ? {} : { description: copyBufferSource(config.description) })
  });
}

export async function encodeWebVideoFrames(
  options: VexaWebVideoEncodeOptions
): Promise<VexaWebVideoEncodeResult> {
  const width = positiveInteger(options.width, "width");
  const height = positiveInteger(options.height, "height");
  const frameCount = positiveInteger(options.frameCount, "frameCount");
  const fps = positiveFinite(options.fps, "fps");
  const bitrate = positiveInteger(options.bitrate ?? Math.max(500_000, Math.round(width * height * fps * 0.08)), "bitrate");
  const keyFrameInterval = positiveInteger(options.keyFrameInterval ?? Math.max(1, Math.round(fps * 2)), "keyFrameInterval");
  const maxQueueSize = positiveInteger(options.maxQueueSize ?? 8, "maxQueueSize");

  if (options.signal?.aborted) throw cancellationError();

  const runtime = options.runtime ?? defaultEncodingRuntime();
  const chunks: VexaWebEncodedVideoChunk[] = [];
  let decoderConfig: VexaWebVideoDecoderConfig | undefined;
  let encoderFailure: Error | undefined;
  let encoder: VexaWebVideoEncoderHandle | undefined;
  let closed = false;

  const closeEncoder = () => {
    if (encoder === undefined || closed) return;
    closed = true;
    try {
      encoder.close();
    } catch {
      // Cleanup is best-effort after reset/failure.
    }
  };
  const cancelEncoder = () => {
    if (encoder === undefined || closed) return;
    try {
      encoder.reset();
    } catch {
      // The main operation reports cancellation below.
    }
  };

  try {
    encoder = runtime.createVideoEncoder({
      output(chunk, metadata) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push(Object.freeze({
          type: chunk.type,
          timestampUs: chunk.timestamp,
          ...(chunk.duration == null ? {} : { durationUs: chunk.duration }),
          data
        }));
        if (metadata?.decoderConfig !== undefined) {
          decoderConfig = copyDecoderConfig(metadata.decoderConfig);
        }
      },
      error(error) {
        encoderFailure = error;
      }
    });
    options.signal?.addEventListener("abort", cancelEncoder, { once: true });
    encoder.configure({
      codec: VIDEO_CODEC_CONFIG[options.plan.videoCodec],
      width,
      height,
      bitrate,
      framerate: fps,
      ...(options.plan.videoCodec === "h264"
        ? { latencyMode: "realtime" as const, avc: { format: "avc" as const } }
        : {})
    });

    const durationUs = Math.max(1, Math.round(1_000_000 / fps));
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (options.signal?.aborted) throw cancellationError();
      if (encoderFailure !== undefined) {
        throw new VexaWebVideoEncodeError("ENCODE_FAILED", "Browser video encoder failed.", { cause: encoderFailure });
      }

      const timestampUs = Math.round((frame * 1_000_000) / fps);
      const context = Object.freeze({ frame, frameCount, width, height, fps, timestampUs, durationUs });
      let source: unknown;
      try {
        source = await options.renderFrame(context, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw cancellationError();
        throw new VexaWebVideoEncodeError(
          "FRAME_RENDER_FAILED",
          `Browser frame ${frame} could not be rendered.`,
          { cause: error }
        );
      }
      if (options.signal?.aborted) throw cancellationError();

      let videoFrame: VexaWebVideoFrameHandle;
      try {
        videoFrame = runtime.createVideoFrame(source, { timestamp: timestampUs, duration: durationUs });
      } catch (error) {
        throw new VexaWebVideoEncodeError(
          "FRAME_RENDER_FAILED",
          `Browser frame ${frame} could not be converted to VideoFrame.`,
          { cause: error }
        );
      }
      try {
        encoder.encode(videoFrame, { keyFrame: frame % keyFrameInterval === 0 });
      } finally {
        videoFrame.close();
      }

      if (encoder.encodeQueueSize >= maxQueueSize) {
        await encoder.flush();
      }
      if (encoderFailure !== undefined) {
        throw new VexaWebVideoEncodeError("ENCODE_FAILED", "Browser video encoder failed.", { cause: encoderFailure });
      }
      if (options.signal?.aborted) throw cancellationError();
      options.onProgress?.(Object.freeze({
        phase: "encoding",
        completedFrames: frame + 1,
        totalFrames: frameCount,
        progress: (frame + 1) / frameCount
      }));
    }

    await encoder.flush();
    if (encoderFailure !== undefined) {
      throw new VexaWebVideoEncodeError("ENCODE_FAILED", "Browser video encoder failed.", { cause: encoderFailure });
    }
    if (options.signal?.aborted) throw cancellationError();
    options.onProgress?.(Object.freeze({
      phase: "complete",
      completedFrames: frameCount,
      totalFrames: frameCount,
      progress: 1
    }));

    return Object.freeze({
      kind: "encoded-video-chunks",
      targetContainer: options.plan.container,
      videoCodec: options.plan.videoCodec,
      codec: VIDEO_CODEC_CONFIG[options.plan.videoCodec],
      width,
      height,
      fps,
      frameCount,
      durationSeconds: frameCount / fps,
      ...(decoderConfig === undefined ? {} : { decoderConfig }),
      chunks: Object.freeze(chunks.slice())
    });
  } catch (error) {
    if (options.signal?.aborted && !(error instanceof VexaWebVideoEncodeError && error.code === "CANCELLED")) {
      throw cancellationError();
    }
    if (error instanceof VexaWebVideoEncodeError) throw error;
    throw new VexaWebVideoEncodeError("ENCODE_FAILED", "Browser video encoding failed.", { cause: error });
  } finally {
    options.signal?.removeEventListener("abort", cancelEncoder);
    closeEncoder();
  }
}


export type VexaWebMuxErrorCode =
  | "CONTAINER_MUX_UNSUPPORTED"
  | "INVALID_MUX_INPUT"
  | "FILE_API_UNAVAILABLE";

export class VexaWebMuxError extends Error {
  readonly code: VexaWebMuxErrorCode;

  constructor(code: VexaWebMuxErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VexaWebMuxError";
    this.code = code;
  }
}

export interface VexaWebMuxedVideoResult {
  readonly kind: "muxed-video";
  readonly container: "webm" | "mp4";
  readonly mimeType: "video/webm" | "video/mp4";
  readonly videoCodec: VexaWebVideoCodec;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly data: Uint8Array;
  readonly blob: Blob;
}

export interface VexaWebFileRuntime {
  createFile(parts: BlobPart[], fileName: string, options: FilePropertyBag): File;
}

const EBML_ID = Object.freeze({
  ebml: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
  segment: new Uint8Array([0x18, 0x53, 0x80, 0x67]),
  info: new Uint8Array([0x15, 0x49, 0xa9, 0x66]),
  tracks: new Uint8Array([0x16, 0x54, 0xae, 0x6b]),
  cluster: new Uint8Array([0x1f, 0x43, 0xb6, 0x75])
});

function concatByteArrays(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function encodeEbmlSize(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VexaWebMuxError("INVALID_MUX_INPUT", "EBML element size must be a non-negative safe integer.");
  }
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
  throw new VexaWebMuxError("INVALID_MUX_INPUT", "EBML element is too large for an 8-byte size field.");
}

function uintBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VexaWebMuxError("INVALID_MUX_INPUT", "EBML unsigned integer must be a non-negative safe integer.");
  }
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

function float64Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return bytes;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function ebmlElement(id: Uint8Array, payload: Uint8Array): Uint8Array {
  return concatByteArrays([id, encodeEbmlSize(payload.byteLength), payload]);
}

function ebmlUint(id: readonly number[], value: number): Uint8Array {
  return ebmlElement(new Uint8Array(id), uintBytes(value));
}

function ebmlString(id: readonly number[], value: string): Uint8Array {
  return ebmlElement(new Uint8Array(id), utf8Bytes(value));
}

function createEbmlHeader(): Uint8Array {
  return ebmlElement(EBML_ID.ebml, concatByteArrays([
    ebmlUint([0x42, 0x86], 1),
    ebmlUint([0x42, 0xf7], 1),
    ebmlUint([0x42, 0xf2], 4),
    ebmlUint([0x42, 0xf3], 8),
    ebmlString([0x42, 0x82], "webm"),
    ebmlUint([0x42, 0x87], 4),
    ebmlUint([0x42, 0x85], 2)
  ]));
}

function createWebmInfo(encoded: VexaWebVideoEncodeResult): Uint8Array {
  return ebmlElement(EBML_ID.info, concatByteArrays([
    ebmlUint([0x2a, 0xd7, 0xb1], 1_000_000),
    ebmlElement(new Uint8Array([0x44, 0x89]), float64Bytes(encoded.durationSeconds * 1_000)),
    ebmlString([0x4d, 0x80], "Vexa Video SDK"),
    ebmlString([0x57, 0x41], "Vexa Video SDK")
  ]));
}

function createWebmTracks(encoded: VexaWebVideoEncodeResult): Uint8Array {
  const codecId = encoded.videoCodec === "vp9" ? "V_VP9" : "V_AV1";
  const video = ebmlElement(new Uint8Array([0xe0]), concatByteArrays([
    ebmlUint([0xb0], encoded.width),
    ebmlUint([0xba], encoded.height)
  ]));
  const trackEntry = ebmlElement(new Uint8Array([0xae]), concatByteArrays([
    ebmlUint([0xd7], 1),
    ebmlUint([0x73, 0xc5], 1),
    ebmlUint([0x83], 1),
    ebmlString([0x86], codecId),
    ebmlUint([0x23, 0xe3, 0x83], Math.max(1, Math.round(1_000_000_000 / encoded.fps))),
    video
  ]));
  return ebmlElement(EBML_ID.tracks, trackEntry);
}

function createSimpleBlock(chunk: VexaWebEncodedVideoChunk, relativeTimestampMs: number): Uint8Array {
  if (!Number.isInteger(relativeTimestampMs) || relativeTimestampMs < -32_768 || relativeTimestampMs > 32_767) {
    throw new VexaWebMuxError("INVALID_MUX_INPUT", "WebM block timestamp is outside the signed 16-bit range.");
  }
  const header = new Uint8Array(4);
  header[0] = 0x81;
  new DataView(header.buffer).setInt16(1, relativeTimestampMs, false);
  header[3] = chunk.type === "key" ? 0x80 : 0x00;
  return ebmlElement(new Uint8Array([0xa3]), concatByteArrays([header, chunk.data]));
}

function createWebmClusters(encoded: VexaWebVideoEncodeResult): readonly Uint8Array[] {
  if (encoded.chunks.length === 0) {
    throw new VexaWebMuxError("INVALID_MUX_INPUT", "WebM muxing requires at least one encoded video chunk.");
  }
  if (encoded.chunks[0]?.type !== "key") {
    throw new VexaWebMuxError("INVALID_MUX_INPUT", "WebM muxing requires the first encoded chunk to be a keyframe.");
  }

  const clusters: Uint8Array[] = [];
  let clusterTimestampMs = 0;
  let clusterParts: Uint8Array[] = [];
  let previousTimestampUs = -1;

  const flushCluster = () => {
    if (clusterParts.length === 0) return;
    clusters.push(ebmlElement(EBML_ID.cluster, concatByteArrays([
      ebmlUint([0xe7], clusterTimestampMs),
      ...clusterParts
    ])));
    clusterParts = [];
  };

  for (const chunk of encoded.chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0 || chunk.timestampUs < previousTimestampUs) {
      throw new VexaWebMuxError("INVALID_MUX_INPUT", "WebM muxing requires non-negative monotonic chunk timestamps.");
    }
    if (chunk.data.byteLength === 0) {
      throw new VexaWebMuxError("INVALID_MUX_INPUT", "WebM muxing does not accept empty encoded chunks.");
    }
    const timestampMs = Math.round(chunk.timestampUs / 1_000);
    if (clusterParts.length === 0) {
      clusterTimestampMs = timestampMs;
    } else if (timestampMs - clusterTimestampMs > 30_000) {
      flushCluster();
      clusterTimestampMs = timestampMs;
    }
    clusterParts.push(createSimpleBlock(chunk, timestampMs - clusterTimestampMs));
    previousTimestampUs = chunk.timestampUs;
  }
  flushCluster();
  return Object.freeze(clusters.slice());
}

export function muxWebVideo(encoded: VexaWebVideoEncodeResult): VexaWebMuxedVideoResult {
  if (encoded.targetContainer === "webm" && (encoded.videoCodec === "vp9" || encoded.videoCodec === "av1")) {
    const segmentPayload = concatByteArrays([
      createWebmInfo(encoded),
      createWebmTracks(encoded),
      ...createWebmClusters(encoded)
    ]);
    const data = concatByteArrays([createEbmlHeader(), ebmlElement(EBML_ID.segment, segmentPayload)]);
    const blobBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const blob = new Blob([blobBuffer], { type: "video/webm" });
    return Object.freeze({
      kind: "muxed-video",
      container: "webm",
      mimeType: "video/webm",
      videoCodec: encoded.videoCodec,
      width: encoded.width,
      height: encoded.height,
      fps: encoded.fps,
      frameCount: encoded.frameCount,
      durationSeconds: encoded.durationSeconds,
      data,
      blob
    });
  }

  if (encoded.targetContainer === "mp4" && encoded.videoCodec === "h264") {
    const decoderDescription = encoded.decoderConfig?.description;
    if (decoderDescription === undefined) {
      throw new VexaWebMuxError(
        "INVALID_MUX_INPUT",
        "H.264 MP4 muxing requires WebCodecs decoderConfig.description AVC metadata."
      );
    }
    let data: Uint8Array;
    try {
      data = muxH264Mp4({
        width: encoded.width,
        height: encoded.height,
        fps: encoded.fps,
        frameCount: encoded.frameCount,
        durationSeconds: encoded.durationSeconds,
        decoderConfig: decoderDescription,
        chunks: encoded.chunks
      });
    } catch (error) {
      if (error instanceof Mp4MuxInputError) {
        throw new VexaWebMuxError("INVALID_MUX_INPUT", error.message, { cause: error });
      }
      throw error;
    }
    const blobBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const blob = new Blob([blobBuffer], { type: "video/mp4" });
    return Object.freeze({
      kind: "muxed-video",
      container: "mp4",
      mimeType: "video/mp4",
      videoCodec: "h264",
      width: encoded.width,
      height: encoded.height,
      fps: encoded.fps,
      frameCount: encoded.frameCount,
      durationSeconds: encoded.durationSeconds,
      data,
      blob
    });
  }

  throw new VexaWebMuxError(
    "CONTAINER_MUX_UNSUPPORTED",
    "Browser muxing supports H.264 MP4 and VP9/AV1 WebM output only."
  );
}

function defaultFileRuntime(): VexaWebFileRuntime {
  const FileConstructor = (globalThis as typeof globalThis & { File?: typeof File }).File;
  if (typeof FileConstructor !== "function") {
    throw new VexaWebMuxError("FILE_API_UNAVAILABLE", "Browser File API is unavailable.");
  }
  return {
    createFile(parts, fileName, options) {
      return new FileConstructor(parts, fileName, options);
    }
  };
}

export function createWebVideoFile(
  muxed: VexaWebMuxedVideoResult,
  fileName: string,
  runtime: VexaWebFileRuntime = defaultFileRuntime()
): File {
  if (fileName.trim().length === 0) {
    throw new VexaWebMuxError("INVALID_MUX_INPUT", "fileName must not be empty.");
  }
  const data = muxed.data.buffer.slice(
    muxed.data.byteOffset,
    muxed.data.byteOffset + muxed.data.byteLength
  ) as ArrayBuffer;
  return runtime.createFile([data], fileName, { type: muxed.mimeType });
}

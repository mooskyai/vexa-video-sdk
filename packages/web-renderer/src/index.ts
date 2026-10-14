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

export interface VexaWebVideoEncoderHandle {
  readonly encodeQueueSize: number;
  configure(config: Readonly<{ codec: string; width: number; height: number; bitrate: number; framerate: number }>): void;
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
    output: (chunk: VexaWebEncodedVideoChunkHandle) => void;
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
      output: (chunk: VexaWebEncodedVideoChunkHandle) => void;
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

  if (options.plan.audioCodec !== undefined) {
    throw new VexaWebVideoEncodeError(
      "AUDIO_EXECUTION_UNAVAILABLE",
      "V2.11 browser video execution does not encode or mux audio yet."
    );
  }
  if (options.signal?.aborted) throw cancellationError();

  const runtime = options.runtime ?? defaultEncodingRuntime();
  const chunks: VexaWebEncodedVideoChunk[] = [];
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
      output(chunk) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push(Object.freeze({
          type: chunk.type,
          timestampUs: chunk.timestamp,
          ...(chunk.duration == null ? {} : { durationUs: chunk.duration }),
          data
        }));
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
      framerate: fps
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

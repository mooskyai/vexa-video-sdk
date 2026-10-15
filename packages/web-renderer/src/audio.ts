export type VexaWebAudioCodec = "aac" | "opus";

export type VexaWebAudioEncodeErrorCode =
  | "ENCODER_UNAVAILABLE"
  | "INVALID_ENCODE_REQUEST"
  | "AUDIO_DATA_FAILED"
  | "ENCODE_FAILED"
  | "CANCELLED";

export class VexaWebAudioEncodeError extends Error {
  readonly code: VexaWebAudioEncodeErrorCode;

  constructor(code: VexaWebAudioEncodeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VexaWebAudioEncodeError";
    this.code = code;
  }
}

export interface VexaWebAudioDataHandle {
  close(): void;
}

export interface VexaWebEncodedAudioChunkHandle {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly duration?: number | null;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
}

export interface VexaWebAudioDecoderConfigHandle {
  readonly codec: string;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly description?: AllowSharedBufferSource;
}

export interface VexaWebEncodedAudioChunkMetadataHandle {
  readonly decoderConfig?: VexaWebAudioDecoderConfigHandle;
}

export interface VexaWebAudioDecoderConfig {
  readonly codec: string;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly description?: Uint8Array;
}

export interface VexaWebAudioEncoderHandle {
  readonly encodeQueueSize: number;
  configure(config: Readonly<{
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    bitrate: number;
    aac?: Readonly<{ format: "aac" | "adts" }>;
    opus?: Readonly<{ format: "opus" | "ogg"; frameDuration?: number }>;
  }>): void;
  encode(data: VexaWebAudioDataHandle): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}

export interface VexaWebAudioEncodingRuntime {
  createAudioEncoder(callbacks: Readonly<{
    output: (chunk: VexaWebEncodedAudioChunkHandle, metadata?: VexaWebEncodedAudioChunkMetadataHandle) => void;
    error: (error: Error) => void;
  }>): VexaWebAudioEncoderHandle;
}

export interface VexaWebAudioChunkContext {
  readonly chunk: number;
  readonly chunkCount: number;
  readonly sampleOffset: number;
  readonly numberOfFrames: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly timestampUs: number;
  readonly durationUs: number;
}

export interface VexaWebAudioEncodeProgress {
  readonly phase: "encoding" | "complete";
  readonly completedChunks: number;
  readonly totalChunks: number;
  readonly progress: number;
}

export interface VexaWebEncodedAudioChunk {
  readonly type: "key" | "delta";
  readonly timestampUs: number;
  readonly durationUs?: number;
  readonly data: Uint8Array;
}

export interface VexaWebAudioEncodeOptions {
  readonly audioCodec: VexaWebAudioCodec;
  readonly durationSeconds: number;
  readonly sampleRate?: number;
  readonly numberOfChannels?: number;
  readonly bitrate?: number;
  readonly framesPerChunk?: number;
  readonly maxQueueSize?: number;
  readonly signal?: AbortSignal;
  readonly renderAudio: (
    context: VexaWebAudioChunkContext,
    signal: AbortSignal | undefined
  ) => VexaWebAudioDataHandle | Promise<VexaWebAudioDataHandle>;
  readonly onProgress?: (progress: VexaWebAudioEncodeProgress) => void;
  readonly runtime?: VexaWebAudioEncodingRuntime;
}

export interface VexaWebAudioEncodeResult {
  readonly kind: "encoded-audio-chunks";
  readonly audioCodec: VexaWebAudioCodec;
  readonly codec: string;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly durationSeconds: number;
  readonly decoderConfig?: VexaWebAudioDecoderConfig;
  readonly chunks: readonly VexaWebEncodedAudioChunk[];
}

const AUDIO_CODEC_CONFIG: Readonly<Record<VexaWebAudioCodec, string>> = Object.freeze({
  aac: "mp4a.40.2",
  opus: "opus"
});

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new VexaWebAudioEncodeError("INVALID_ENCODE_REQUEST", `${name} must be a positive integer.`);
  }
  return value;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new VexaWebAudioEncodeError("INVALID_ENCODE_REQUEST", `${name} must be a positive finite number.`);
  }
  return value;
}

function copyBufferSource(source: AllowSharedBufferSource): Uint8Array {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  return Uint8Array.from(view);
}

function copyDecoderConfig(config: VexaWebAudioDecoderConfigHandle): VexaWebAudioDecoderConfig {
  return Object.freeze({
    codec: config.codec,
    sampleRate: config.sampleRate,
    numberOfChannels: config.numberOfChannels,
    ...(config.description === undefined ? {} : { description: copyBufferSource(config.description) })
  });
}

function defaultRuntime(): VexaWebAudioEncodingRuntime {
  const globalValue = globalThis as typeof globalThis & {
    AudioEncoder?: new (callbacks: Readonly<{
      output: (chunk: VexaWebEncodedAudioChunkHandle, metadata?: VexaWebEncodedAudioChunkMetadataHandle) => void;
      error: (error: Error) => void;
    }>) => VexaWebAudioEncoderHandle;
  };
  if (typeof globalValue.AudioEncoder !== "function") {
    throw new VexaWebAudioEncodeError("ENCODER_UNAVAILABLE", "Browser AudioEncoder execution is unavailable.");
  }
  return {
    createAudioEncoder(callbacks) {
      return new globalValue.AudioEncoder!(callbacks);
    }
  };
}

function cancellationError(): VexaWebAudioEncodeError {
  return new VexaWebAudioEncodeError("CANCELLED", "Browser audio encoding was cancelled.");
}

export async function encodeWebAudioData(
  options: VexaWebAudioEncodeOptions
): Promise<VexaWebAudioEncodeResult> {
  const durationSeconds = positiveFinite(options.durationSeconds, "durationSeconds");
  const sampleRate = positiveInteger(options.sampleRate ?? 48_000, "sampleRate");
  const numberOfChannels = positiveInteger(options.numberOfChannels ?? 2, "numberOfChannels");
  const bitrate = positiveInteger(options.bitrate ?? (options.audioCodec === "aac" ? 192_000 : 128_000), "bitrate");
  const defaultFramesPerChunk = options.audioCodec === "aac" ? 1_024 : Math.max(1, Math.round(sampleRate * 0.02));
  const framesPerChunk = positiveInteger(options.framesPerChunk ?? defaultFramesPerChunk, "framesPerChunk");
  const maxQueueSize = positiveInteger(options.maxQueueSize ?? 8, "maxQueueSize");
  const totalFrames = Math.max(1, Math.round(durationSeconds * sampleRate));
  const chunkCount = Math.ceil(totalFrames / framesPerChunk);
  if (options.signal?.aborted) throw cancellationError();

  const runtime = options.runtime ?? defaultRuntime();
  const chunks: VexaWebEncodedAudioChunk[] = [];
  let decoderConfig: VexaWebAudioDecoderConfig | undefined;
  let encoderFailure: Error | undefined;
  let encoder: VexaWebAudioEncoderHandle | undefined;
  let closed = false;

  const closeEncoder = () => {
    if (encoder === undefined || closed) return;
    closed = true;
    try {
      encoder.close();
    } catch {
      // Cleanup remains best-effort after reset/failure.
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
    encoder = runtime.createAudioEncoder({
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
      codec: AUDIO_CODEC_CONFIG[options.audioCodec],
      sampleRate,
      numberOfChannels,
      bitrate,
      ...(options.audioCodec === "aac"
        ? { aac: { format: "aac" as const } }
        : { opus: { format: "opus" as const, frameDuration: 20_000 } })
    });

    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      if (options.signal?.aborted) throw cancellationError();
      if (encoderFailure !== undefined) {
        throw new VexaWebAudioEncodeError("ENCODE_FAILED", "Browser audio encoder failed.", { cause: encoderFailure });
      }
      const sampleOffset = chunk * framesPerChunk;
      const numberOfFrames = Math.min(framesPerChunk, totalFrames - sampleOffset);
      const timestampUs = Math.round((sampleOffset * 1_000_000) / sampleRate);
      const durationUs = Math.max(1, Math.round((numberOfFrames * 1_000_000) / sampleRate));
      const context = Object.freeze({
        chunk,
        chunkCount,
        sampleOffset,
        numberOfFrames,
        sampleRate,
        numberOfChannels,
        timestampUs,
        durationUs
      });
      let audioData: VexaWebAudioDataHandle;
      try {
        audioData = await options.renderAudio(context, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw cancellationError();
        throw new VexaWebAudioEncodeError(
          "AUDIO_DATA_FAILED",
          `Browser audio chunk ${chunk} could not be rendered.`,
          { cause: error }
        );
      }
      if (options.signal?.aborted) {
        audioData.close();
        throw cancellationError();
      }
      try {
        encoder.encode(audioData);
      } finally {
        audioData.close();
      }
      if (encoder.encodeQueueSize >= maxQueueSize) await encoder.flush();
      if (encoderFailure !== undefined) {
        throw new VexaWebAudioEncodeError("ENCODE_FAILED", "Browser audio encoder failed.", { cause: encoderFailure });
      }
      options.onProgress?.(Object.freeze({
        phase: "encoding",
        completedChunks: chunk + 1,
        totalChunks: chunkCount,
        progress: (chunk + 1) / chunkCount
      }));
    }

    await encoder.flush();
    if (encoderFailure !== undefined) {
      throw new VexaWebAudioEncodeError("ENCODE_FAILED", "Browser audio encoder failed.", { cause: encoderFailure });
    }
    if (options.signal?.aborted) throw cancellationError();
    options.onProgress?.(Object.freeze({
      phase: "complete",
      completedChunks: chunkCount,
      totalChunks: chunkCount,
      progress: 1
    }));

    return Object.freeze({
      kind: "encoded-audio-chunks",
      audioCodec: options.audioCodec,
      codec: AUDIO_CODEC_CONFIG[options.audioCodec],
      sampleRate,
      numberOfChannels,
      durationSeconds: totalFrames / sampleRate,
      ...(decoderConfig === undefined ? {} : { decoderConfig }),
      chunks: Object.freeze(chunks.slice())
    });
  } catch (error) {
    if (options.signal?.aborted && !(error instanceof VexaWebAudioEncodeError && error.code === "CANCELLED")) {
      throw cancellationError();
    }
    if (error instanceof VexaWebAudioEncodeError) throw error;
    throw new VexaWebAudioEncodeError("ENCODE_FAILED", "Browser audio encoding failed.", { cause: error });
  } finally {
    options.signal?.removeEventListener("abort", cancelEncoder);
    closeEncoder();
  }
}

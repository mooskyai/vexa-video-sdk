import type {
  HardwareAccelerationCapabilities,
  PreviewSpriteOptions,
  PreviewSpritePlan,
  PreviewSpriteResult,
  ProbeOptions,
  ProbeResult,
  StreamingExecutionPlan,
  StreamingPackageOptions,
  StreamingPackageResult,
  VideoLoadOptions
} from "@moosky-video/core";
import { InvalidMediaSourceError, InvalidStreamingError } from "@moosky-video/core";
import {
  createPreviewSpritePlan,
  createStreamingExecutionPlan,
  detectHardwareAcceleration,
  probeMedia,
  resolveMediaBinaries,
  runPreviewSpritePlan,
  runStreamingExecutionPlan,
  type MediaBinaries
} from "@moosky-video/ffmpeg";

interface StreamingRuntime {
  binariesPromise?: Promise<MediaBinaries>;
  hardwareCapabilitiesPromise?: Promise<HardwareAccelerationCapabilities>;
}

function normalizeSource(source: string | URL): string {
  const value = source instanceof URL ? source.toString() : source.trim();
  if (!value) throw new InvalidMediaSourceError(String(source));
  return value;
}

function outputDirectory(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InvalidStreamingError("Streaming output directory cannot be empty.");
  return normalized;
}

export class Streaming {
  readonly source: string;
  readonly options: Readonly<VideoLoadOptions>;
  readonly #runtime: StreamingRuntime;

  private constructor(source: string, options: VideoLoadOptions, runtime: StreamingRuntime) {
    this.source = source;
    this.options = Object.freeze({ ...options });
    this.#runtime = runtime;
  }

  static load(source: string | URL, options: VideoLoadOptions = {}): Streaming {
    return new Streaming(normalizeSource(source), options, {});
  }

  async probe(options: ProbeOptions = {}): Promise<ProbeResult> {
    const binaries = await this.#resolveBinaries();
    return await probeMedia(this.source, binaries.ffprobe, options);
  }

  async planPackage(
    directory: string,
    options: StreamingPackageOptions
  ): Promise<StreamingExecutionPlan> {
    const target = outputDirectory(directory);
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    const hardwareCapabilities = await this.#hardwareCapabilities(options);
    return createStreamingExecutionPlan(this.source, target, options, metadata, hardwareCapabilities);
  }

  async package(
    directory: string,
    options: StreamingPackageOptions
  ): Promise<StreamingPackageResult> {
    const binaries = await this.#resolveBinaries();
    const plan = await this.planPackage(directory, options);
    return await runStreamingExecutionPlan(binaries.ffmpeg, plan, options);
  }

  async planPreviewSprite(
    directory: string,
    options: PreviewSpriteOptions = {}
  ): Promise<PreviewSpritePlan> {
    const target = outputDirectory(directory);
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    return createPreviewSpritePlan(this.source, target, options, metadata);
  }

  async previewSprite(
    directory: string,
    options: PreviewSpriteOptions = {}
  ): Promise<PreviewSpriteResult> {
    const binaries = await this.#resolveBinaries();
    const plan = await this.planPreviewSprite(directory, options);
    return await runPreviewSpritePlan(binaries.ffmpeg, plan, options);
  }

  async #hardwareCapabilities(options: StreamingPackageOptions): Promise<HardwareAccelerationCapabilities | null> {
    if (!options.hardwareAcceleration || options.hardwareAcceleration === "cpu") return null;
    const binaries = await this.#resolveBinaries();
    if (!options.signal && options.timeoutMs === undefined) {
      this.#runtime.hardwareCapabilitiesPromise ??= detectHardwareAcceleration(binaries.ffmpeg);
      return await this.#runtime.hardwareCapabilitiesPromise;
    }
    return await detectHardwareAcceleration(binaries.ffmpeg, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
  }

  async #resolveBinaries(): Promise<MediaBinaries> {
    this.#runtime.binariesPromise ??= resolveMediaBinaries({
      ...(this.options.ffmpegPath ? { ffmpegPath: this.options.ffmpegPath } : {}),
      ...(this.options.ffprobePath ? { ffprobePath: this.options.ffprobePath } : {})
    });
    return await this.#runtime.binariesPromise;
  }
}

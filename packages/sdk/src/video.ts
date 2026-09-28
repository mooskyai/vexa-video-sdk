import type {
  CaptionDocument,
  HardwareAccelerationCapabilities,
  CropOptions,
  ExportOptions,
  ExtractAudioOptions,
  MediaExecutionPlan,
  MediaOutputResult,
  ProbeOptions,
  ProbeResult,
  ResizeOptions,
  RotateOptions,
  ThumbnailOptions,
  TrimOptions,
  VideoLoadOptions,
  VideoOperation,
  VideoPipelineAst
} from "@moosky-video/core";
import {
  InvalidMediaSourceError,
  InvalidOperationError,
  createVideoPipelineAst,
  normalizeVideoOperations
} from "@moosky-video/core";
import {
  createCaptionExecutionPlan,
  createExportExecutionPlan,
  detectHardwareAcceleration,
  createExtractAudioExecutionPlan,
  createThumbnailExecutionPlan,
  probeMedia,
  resolveDefaultFontFile,
  resolveMediaBinaries,
  runFfmpegPlan,
  type MediaBinaries
} from "@moosky-video/ffmpeg";

interface VideoRuntime {
  binariesPromise?: Promise<MediaBinaries>;
  hardwareCapabilitiesPromise?: Promise<HardwareAccelerationCapabilities>;
}

function normalizeSource(source: string | URL): string {
  const value = source instanceof URL ? source.toString() : source.trim();
  if (!value) throw new InvalidMediaSourceError(String(source));
  return value;
}

function validateOutput(output: string): string {
  const normalized = output.trim();
  if (!normalized) throw new InvalidOperationError("Output path cannot be empty.");
  return normalized;
}

function validateExportOptions(options: ExportOptions): void {
  if (options.crf !== undefined && (!Number.isFinite(options.crf) || options.crf < 0 || options.crf > 63)) {
    throw new InvalidOperationError("export.crf must be between 0 and 63.");
  }
  if (options.pixelFormat !== undefined && !options.pixelFormat.trim()) {
    throw new InvalidOperationError("export.pixelFormat cannot be empty.");
  }
  if (options.videoBitrate !== undefined && !options.videoBitrate.trim()) {
    throw new InvalidOperationError("export.videoBitrate cannot be empty.");
  }
  if (options.audioBitrate !== undefined && !options.audioBitrate.trim()) {
    throw new InvalidOperationError("export.audioBitrate cannot be empty.");
  }
}

function validateThumbnailOptions(options: ThumbnailOptions): void {
  if (options.at !== undefined && (!Number.isFinite(options.at) || options.at < 0)) {
    throw new InvalidOperationError("thumbnail.at must be a finite number greater than or equal to 0.");
  }
  if (
    options.quality !== undefined &&
    (!Number.isFinite(options.quality) || options.quality < 1 || options.quality > 31)
  ) {
    throw new InvalidOperationError("thumbnail.quality must be between 1 and 31.");
  }
}

export class Video {
  readonly source: string;
  readonly options: Readonly<VideoLoadOptions>;
  readonly operations: readonly VideoOperation[];
  readonly #runtime: VideoRuntime;

  private constructor(
    source: string,
    options: VideoLoadOptions,
    operations: readonly VideoOperation[],
    runtime: VideoRuntime
  ) {
    this.source = source;
    this.options = Object.freeze({ ...options });
    this.operations = Object.freeze([...normalizeVideoOperations(operations)]);
    this.#runtime = runtime;
  }

  static load(source: string | URL, options: VideoLoadOptions = {}): Video {
    return new Video(normalizeSource(source), options, [], {});
  }

  static fromPipeline(pipeline: VideoPipelineAst, options: VideoLoadOptions = {}): Video {
    if (pipeline.schemaVersion !== 1) {
      throw new InvalidOperationError(
        `Unsupported pipeline schema version: ${String(pipeline.schemaVersion)}.`
      );
    }
    return new Video(normalizeSource(pipeline.source), options, pipeline.operations, {});
  }

  get pipeline(): VideoPipelineAst {
    return createVideoPipelineAst(this.source, this.operations);
  }

  trim(options: TrimOptions): Video {
    return this.#append({ type: "trim", options: { ...options } });
  }

  resize(options: ResizeOptions): Video {
    return this.#append({ type: "resize", options: { ...options } });
  }

  crop(options: CropOptions): Video {
    return this.#append({ type: "crop", options: { ...options } });
  }

  rotate(options: RotateOptions): Video {
    return this.#append({ type: "rotate", options: { ...options } });
  }

  async probe(options: ProbeOptions = {}): Promise<ProbeResult> {
    const binaries = await this.#resolveBinaries();
    return await probeMedia(this.source, binaries.ffprobe, options);
  }

  async planExport(output: string, options: ExportOptions = {}): Promise<MediaExecutionPlan> {
    const normalizedOutput = validateOutput(output);
    validateExportOptions(options);
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    const hardwareCapabilities = await this.#hardwareCapabilities(options);
    return createExportExecutionPlan(
      this.source,
      this.operations,
      normalizedOutput,
      options,
      metadata,
      hardwareCapabilities
    );
  }

  async export(output: string, options: ExportOptions = {}): Promise<MediaOutputResult> {
    const binaries = await this.#resolveBinaries();
    const plan = await this.planExport(output, options);
    return await runFfmpegPlan(binaries.ffmpeg, plan, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {})
    });
  }

  async planCaptionBurn(
    captions: CaptionDocument,
    output: string,
    options: ExportOptions = {}
  ): Promise<MediaExecutionPlan> {
    const normalizedOutput = validateOutput(output);
    validateExportOptions(options);
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    const [fontFile, hardwareCapabilities] = await Promise.all([
      resolveDefaultFontFile(),
      this.#hardwareCapabilities(options)
    ]);
    return createCaptionExecutionPlan(
      this.source,
      this.operations,
      captions,
      normalizedOutput,
      options,
      metadata,
      fontFile,
      hardwareCapabilities
    );
  }

  async burnCaptions(
    captions: CaptionDocument,
    output: string,
    options: ExportOptions = {}
  ): Promise<MediaOutputResult> {
    const binaries = await this.#resolveBinaries();
    const plan = await this.planCaptionBurn(captions, output, options);
    return await runFfmpegPlan(binaries.ffmpeg, plan, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {})
    });
  }

  async thumbnail(
    output: string,
    options: ThumbnailOptions = {}
  ): Promise<MediaOutputResult> {
    const normalizedOutput = validateOutput(output);
    validateThumbnailOptions(options);
    const binaries = await this.#resolveBinaries();
    const plan = createThumbnailExecutionPlan(
      this.source,
      this.operations,
      normalizedOutput,
      options
    );

    return await runFfmpegPlan(binaries.ffmpeg, plan, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
  }

  async extractAudio(
    output: string,
    options: ExtractAudioOptions = {}
  ): Promise<MediaOutputResult> {
    const normalizedOutput = validateOutput(output);
    const binaries = await this.#resolveBinaries();
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    const plan = createExtractAudioExecutionPlan(
      this.source,
      this.operations,
      normalizedOutput,
      options,
      metadata
    );

    return await runFfmpegPlan(binaries.ffmpeg, plan, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {})
    });
  }

  #append(operation: VideoOperation): Video {
    return new Video(this.source, this.options, [...this.operations, operation], this.#runtime);
  }

  async #hardwareCapabilities(options: ExportOptions): Promise<HardwareAccelerationCapabilities | null> {
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

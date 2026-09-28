import type {
  AudioChannelLayout,
  AudioDuckingOptions,
  AudioExecutionPlan,
  AudioExportOptions,
  AudioNormalizeOptions,
  AudioOperation,
  MediaOutputResult,
  ProbeOptions,
  ProbeResult,
  SilenceDetectionOptions,
  SilenceDetectionResult,
  TrimOptions,
  VideoLoadOptions,
  WaveformOptions
} from "@moosky-video/core";
import {
  InvalidMediaSourceError,
  InvalidOperationError,
  normalizeAudioOperations
} from "@moosky-video/core";
import {
  createAudioExecutionPlan,
  detectSilence,
  generateWaveform,
  probeMedia,
  resolveMediaBinaries,
  runAudioExecutionPlan,
  type MediaBinaries
} from "@moosky-video/ffmpeg";

interface AudioRuntime {
  binariesPromise?: Promise<MediaBinaries>;
}

function normalizeSource(source: string | URL): string {
  const value = source instanceof URL ? source.toString() : source.trim();
  if (!value) throw new InvalidMediaSourceError(String(source));
  return value;
}

function outputPath(output: string): string {
  const value = output.trim();
  if (!value) throw new InvalidOperationError("Audio output path cannot be empty.");
  return value;
}

export class Audio {
  readonly source: string;
  readonly options: Readonly<VideoLoadOptions>;
  readonly operations: readonly AudioOperation[];
  readonly #runtime: AudioRuntime;

  private constructor(
    source: string,
    options: VideoLoadOptions,
    operations: readonly AudioOperation[],
    runtime: AudioRuntime
  ) {
    this.source = source;
    this.options = Object.freeze({ ...options });
    this.operations = Object.freeze([...normalizeAudioOperations(operations)]);
    this.#runtime = runtime;
  }

  static load(source: string | URL, options: VideoLoadOptions = {}): Audio {
    return new Audio(normalizeSource(source), options, [], {});
  }

  trim(options: TrimOptions): Audio {
    return this.#append({ type: "trim", options: { ...options } });
  }

  normalize(options: AudioNormalizeOptions = {}): Audio {
    return this.#append({
      type: "normalize",
      options: {
        targetLufs: options.targetLufs ?? -16,
        truePeakDb: options.truePeakDb ?? -1.5,
        loudnessRange: options.loudnessRange ?? 11
      }
    });
  }

  fadeIn(duration: number): Audio {
    return this.#append({ type: "fade-in", options: { duration } });
  }

  fadeOut(duration: number): Audio {
    return this.#append({ type: "fade-out", options: { duration } });
  }

  channels(layout: AudioChannelLayout): Audio {
    return this.#append({ type: "channels", options: { layout } });
  }

  duckUnder(options: AudioDuckingOptions): Audio {
    return this.#append({
      type: "duck-under",
      options: {
        sidechain: options.sidechain,
        threshold: options.threshold ?? 0.1,
        ratio: options.ratio ?? 8,
        attackMs: options.attackMs ?? 20,
        releaseMs: options.releaseMs ?? 250,
        sidechainGain: options.sidechainGain ?? 1,
        mixSidechain: options.mixSidechain ?? true
      }
    });
  }

  async probe(options: ProbeOptions = {}): Promise<ProbeResult> {
    const binaries = await this.#resolveBinaries();
    return await probeMedia(this.source, binaries.ffprobe, options);
  }

  async planExport(output: string, options: AudioExportOptions = {}): Promise<AudioExecutionPlan> {
    const normalizedOutput = outputPath(output);
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    return createAudioExecutionPlan(
      this.source,
      this.operations,
      normalizedOutput,
      options,
      metadata
    );
  }

  async export(output: string, options: AudioExportOptions = {}): Promise<MediaOutputResult> {
    const binaries = await this.#resolveBinaries();
    const plan = await this.planExport(output, options);
    return await runAudioExecutionPlan(binaries.ffmpeg, plan, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {})
    });
  }

  async detectSilence(options: SilenceDetectionOptions = {}): Promise<SilenceDetectionResult> {
    const binaries = await this.#resolveBinaries();
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    if (!metadata.audio) throw new InvalidOperationError("Audio source does not contain an audio stream.");
    return await detectSilence(
      binaries.ffmpeg,
      this.source,
      options,
      metadata.durationSeconds
    );
  }

  async waveform(output: string, options: WaveformOptions = {}): Promise<MediaOutputResult> {
    const binaries = await this.#resolveBinaries();
    const metadata = await this.probe({
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    if (!metadata.audio) throw new InvalidOperationError("Audio source does not contain an audio stream.");
    return await generateWaveform(binaries.ffmpeg, this.source, outputPath(output), options);
  }

  #append(operation: AudioOperation): Audio {
    return new Audio(this.source, this.options, [...this.operations, operation], this.#runtime);
  }

  async #resolveBinaries(): Promise<MediaBinaries> {
    this.#runtime.binariesPromise ??= resolveMediaBinaries({
      ...(this.options.ffmpegPath ? { ffmpegPath: this.options.ffmpegPath } : {}),
      ...(this.options.ffprobePath ? { ffprobePath: this.options.ffprobePath } : {})
    });
    return await this.#runtime.binariesPromise;
  }
}

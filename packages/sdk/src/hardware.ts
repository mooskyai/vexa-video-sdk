import type {
  HardwareAccelerationCapabilities,
  HardwareAccelerationDecision,
  HardwareAccelerationProvider,
  HardwareBenchmarkOptions,
  HardwareBenchmarkResult,
  HardwareDetectionOptions,
  HardwareVideoCodec
} from "@vexa-video/core";
import {
  benchmarkHardwareEncoder,
  detectHardwareAcceleration,
  resolveHardwareAcceleration
} from "@vexa-video/ffmpeg";

export class Hardware {
  static async detect(
    options: HardwareDetectionOptions = {}
  ): Promise<HardwareAccelerationCapabilities> {
    return await detectHardwareAcceleration(options.ffmpegPath ?? "ffmpeg", options);
  }

  static async benchmark(
    source: string,
    options: HardwareBenchmarkOptions & HardwareDetectionOptions = {}
  ): Promise<readonly HardwareBenchmarkResult[]> {
    const capabilities = await Hardware.detect(options);
    const codec: HardwareVideoCodec = options.codec ?? "h264";
    const providers: readonly HardwareAccelerationProvider[] = options.providers ?? [
      "nvidia",
      "intel",
      "amd",
      "apple",
      "cpu"
    ];
    const results: HardwareBenchmarkResult[] = [];

    for (const provider of providers) {
      let decision: HardwareAccelerationDecision;
      try {
        decision = resolveHardwareAcceleration(codec, provider, capabilities, false);
      } catch (error) {
        results.push({
          provider,
          codec,
          encoder: provider === "cpu" ? "cpu" : `${provider}-unavailable`,
          success: false,
          elapsedMs: 0,
          durationSeconds: options.durationSeconds ?? 3,
          realtimeFactor: null,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      results.push(await benchmarkHardwareEncoder(
        options.ffmpegPath ?? "ffmpeg",
        source,
        decision,
        options
      ));
    }

    return results;
  }
}

import type {
  EncoderPreset,
  HardwareAccelerationCapabilities,
  HardwareAccelerationDecision,
  HardwareAccelerationPreference,
  HardwareBenchmarkOptions,
  HardwareBenchmarkResult,
  HardwareDetectionOptions,
  HardwareEncoderCapability,
  HardwareProviderCapability,
  HardwareVideoCodec
} from "@vexa-video/core";
import { HardwareAccelerationUnavailableError, InvalidOperationError, ProcessAbortedError } from "@vexa-video/core";
import { runProcess } from "./process.js";

const CPU_ENCODERS: Record<HardwareVideoCodec, string> = {
  h264: "libx264",
  h265: "libx265",
  av1: "libaom-av1",
  vp9: "libvpx-vp9"
};

const HARDWARE_ENCODERS: Record<Exclude<HardwareAccelerationDecision["selected"], "cpu">, Partial<Record<HardwareVideoCodec, string>>> = {
  nvidia: {
    h264: "h264_nvenc",
    h265: "hevc_nvenc",
    av1: "av1_nvenc"
  },
  intel: {
    h264: "h264_qsv",
    h265: "hevc_qsv",
    av1: "av1_qsv",
    vp9: "vp9_qsv"
  },
  amd: {
    h264: "h264_amf",
    h265: "hevc_amf",
    av1: "av1_amf"
  },
  apple: {
    h264: "h264_videotoolbox",
    h265: "hevc_videotoolbox"
  }
};

const PROVIDERS = ["nvidia", "intel", "amd", "apple"] as const;

function parseEncoderNames(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*V\S*\s+([^\s]+)/u.exec(line);
    if (match?.[1] && match[1] !== "=") names.add(match[1]);
  }
  return [...names].sort();
}

function parseHwaccels(output: string): string[] {
  const values = new Set<string>();
  let afterHeader = false;
  for (const raw of output.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Hardware acceleration methods:/iu.test(line)) {
      afterHeader = true;
      continue;
    }
    if (!afterHeader) continue;
    if (/^[a-z0-9_-]+$/iu.test(line)) values.add(line.toLowerCase());
  }
  return [...values].sort();
}

function capabilitiesForProvider(
  provider: (typeof PROVIDERS)[number],
  encoderNames: ReadonlySet<string>
): HardwareProviderCapability {
  const encoders: HardwareEncoderCapability[] = [];
  for (const [codec, encoder] of Object.entries(HARDWARE_ENCODERS[provider]) as [HardwareVideoCodec, string][]) {
    if (encoderNames.has(encoder)) encoders.push({ provider, codec, encoder, runtimeAvailable: null });
  }
  return {
    provider,
    available: encoders.length > 0,
    runtimeAvailable: null,
    encoders
  };
}

export function parseHardwareAccelerationCapabilities(
  encodersOutput: string,
  hwaccelsOutput: string,
  platform: NodeJS.Platform = process.platform
): HardwareAccelerationCapabilities {
  const encoders = parseEncoderNames(encodersOutput);
  const encoderSet = new Set(encoders);
  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    platform,
    hwaccels: parseHwaccels(hwaccelsOutput),
    encoders,
    providers: PROVIDERS.map((provider) => capabilitiesForProvider(provider, encoderSet))
  };
}

async function verifyEncoderRuntime(
  ffmpegPath: string,
  capability: HardwareEncoderCapability,
  options: HardwareDetectionOptions
): Promise<HardwareEncoderCapability> {
  try {
    await runProcess(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "color=c=black:s=320x180:r=1:d=0.1",
      "-frames:v", "1",
      "-an",
      "-c:v", capability.encoder,
      "-f", "null",
      "-"
    ], {
      ...(options.signal ? { signal: options.signal } : {}),
      timeoutMs: Math.min(options.timeoutMs ?? 5_000, 5_000)
    });
    return { ...capability, runtimeAvailable: true };
  } catch (error) {
    if (error instanceof ProcessAbortedError) throw error;
    return {
      ...capability,
      runtimeAvailable: false,
      runtimeError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function verifyProviderRuntime(
  ffmpegPath: string,
  provider: HardwareProviderCapability,
  options: HardwareDetectionOptions
): Promise<HardwareProviderCapability> {
  if (provider.encoders.length === 0) return { ...provider, runtimeAvailable: false };
  const encoders = await Promise.all(
    provider.encoders.map((encoder) => verifyEncoderRuntime(ffmpegPath, encoder, options))
  );
  const runtimeAvailable = encoders.some((encoder) => encoder.runtimeAvailable === true);
  const runtimeError = runtimeAvailable
    ? undefined
    : encoders.find((encoder) => encoder.runtimeError)?.runtimeError;
  return {
    ...provider,
    runtimeAvailable,
    ...(runtimeError ? { runtimeError } : {}),
    encoders
  };
}

export async function detectHardwareAcceleration(
  ffmpegPath: string,
  options: HardwareDetectionOptions = {}
): Promise<HardwareAccelerationCapabilities> {
  const processOptions = {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  };
  const [encoders, hwaccels] = await Promise.all([
    runProcess(ffmpegPath, ["-hide_banner", "-encoders"], processOptions),
    runProcess(ffmpegPath, ["-hide_banner", "-hwaccels"], processOptions)
  ]);
  const parsed = parseHardwareAccelerationCapabilities(
    `${encoders.stdout}\n${encoders.stderr}`,
    `${hwaccels.stdout}\n${hwaccels.stderr}`
  );
  const providers = await Promise.all(
    parsed.providers.map((provider) => verifyProviderRuntime(ffmpegPath, provider, options))
  );
  return { ...parsed, providers };
}

function providerOrder(capabilities: HardwareAccelerationCapabilities): readonly Exclude<HardwareAccelerationDecision["selected"], "cpu">[] {
  if (capabilities.platform === "darwin") return ["apple", "nvidia", "intel", "amd"];
  return ["nvidia", "intel", "amd", "apple"];
}

function providerEncoder(
  provider: Exclude<HardwareAccelerationDecision["selected"], "cpu">,
  codec: HardwareVideoCodec,
  capabilities: HardwareAccelerationCapabilities | null
): string | null {
  const expected = HARDWARE_ENCODERS[provider][codec];
  if (!expected || !capabilities) return null;
  const providerInfo = capabilities.providers.find((entry) => entry.provider === provider);
  if (!providerInfo || providerInfo.runtimeAvailable === false) return null;
  const encoder = providerInfo.encoders.find((entry) => entry.codec === codec && entry.encoder === expected);
  if (!encoder || encoder.runtimeAvailable === false) return null;
  return encoder.encoder;
}

export function resolveHardwareAcceleration(
  codec: HardwareVideoCodec,
  requested: HardwareAccelerationPreference | undefined,
  capabilities: HardwareAccelerationCapabilities | null = null,
  hardwareFallback = true
): HardwareAccelerationDecision {
  const preference = requested ?? "cpu";
  if (!["auto", "cpu", "nvidia", "intel", "amd", "apple"].includes(preference)) {
    throw new InvalidOperationError(`Unsupported hardware acceleration preference: ${String(preference)}.`);
  }
  if (preference === "cpu") {
    return {
      requested: preference,
      selected: "cpu",
      codec,
      encoder: CPU_ENCODERS[codec],
      hardware: false,
      fallback: false,
      reason: requested ? "requested-cpu" : "default-cpu"
    };
  }

  if (preference === "auto") {
    if (capabilities) {
      for (const provider of providerOrder(capabilities)) {
        const encoder = providerEncoder(provider, codec, capabilities);
        if (encoder) {
          return {
            requested: preference,
            selected: provider,
            codec,
            encoder,
            hardware: true,
            fallback: false,
            reason: `auto-selected-${provider}`
          };
        }
      }
    }
    return {
      requested: preference,
      selected: "cpu",
      codec,
      encoder: CPU_ENCODERS[codec],
      hardware: false,
      fallback: true,
      reason: "auto-no-compatible-hardware-encoder"
    };
  }

  const encoder = providerEncoder(preference, codec, capabilities);
  if (encoder) {
    return {
      requested: preference,
      selected: preference,
      codec,
      encoder,
      hardware: true,
      fallback: false,
      reason: `requested-${preference}`
    };
  }

  if (!hardwareFallback) {
    throw new HardwareAccelerationUnavailableError(
      `Hardware acceleration provider "${preference}" does not expose a compatible ${codec} encoder in the configured FFmpeg build.`
    );
  }

  return {
    requested: preference,
    selected: "cpu",
    codec,
    encoder: CPU_ENCODERS[codec],
    hardware: false,
    fallback: true,
    reason: `requested-${preference}-unavailable-cpu-fallback`
  };
}

function nvidiaPreset(preset: EncoderPreset): string {
  switch (preset) {
    case "ultrafast":
    case "superfast": return "p1";
    case "veryfast": return "p2";
    case "faster": return "p3";
    case "fast": return "p4";
    case "medium": return "p5";
    case "slow": return "p6";
    case "slower":
    case "veryslow": return "p7";
  }
}

function amdQuality(preset: EncoderPreset): string {
  if (["ultrafast", "superfast", "veryfast", "faster", "fast"].includes(preset)) return "speed";
  if (["slow", "slower", "veryslow"].includes(preset)) return "quality";
  return "balanced";
}

export interface HardwareVideoEncoderOptionInput {
  crf?: number;
  preset?: EncoderPreset;
  pixelFormat?: string;
  videoBitrate?: string;
}

export function appendVideoEncoderOptions(
  args: string[],
  decision: HardwareAccelerationDecision,
  options: HardwareVideoEncoderOptionInput,
  streamSpecifier = ""
): void {
  const stream = streamSpecifier ? `:v:${streamSpecifier}` : ":v";
  const codecFlag = streamSpecifier ? `-c:v:${streamSpecifier}` : "-c:v";
  args.push(codecFlag, decision.encoder);

  if (options.crf !== undefined) {
    if (decision.selected === "nvidia") {
      args.push(streamSpecifier ? `-cq:v:${streamSpecifier}` : "-cq", String(options.crf));
    } else if (decision.selected === "intel") {
      args.push(streamSpecifier ? `-global_quality:v:${streamSpecifier}` : "-global_quality", String(options.crf));
    } else if (decision.selected === "amd") {
      const qi = streamSpecifier ? `-qp_i:v:${streamSpecifier}` : "-qp_i";
      const qp = streamSpecifier ? `-qp_p:v:${streamSpecifier}` : "-qp_p";
      args.push(qi, String(options.crf), qp, String(options.crf));
    } else if (decision.selected === "apple") {
      // VideoToolbox does not expose CRF semantics. A requested bitrate can still
      // constrain the encoder; otherwise let the native encoder choose quality.
    } else {
      args.push(streamSpecifier ? `-crf:v:${streamSpecifier}` : "-crf", String(options.crf));
    }
  }

  if (options.preset !== undefined) {
    if (decision.selected === "nvidia") {
      args.push(streamSpecifier ? `-preset:v:${streamSpecifier}` : "-preset", nvidiaPreset(options.preset));
    } else if (decision.selected === "amd") {
      args.push(streamSpecifier ? `-quality:v:${streamSpecifier}` : "-quality", amdQuality(options.preset));
    } else if (decision.selected === "apple") {
      // VideoToolbox has no portable FFmpeg preset equivalent.
    } else {
      args.push(streamSpecifier ? `-preset:v:${streamSpecifier}` : "-preset", options.preset);
    }
  }

  if (options.pixelFormat !== undefined) {
    args.push(streamSpecifier ? `-pix_fmt:v:${streamSpecifier}` : "-pix_fmt", options.pixelFormat);
  }
  if (options.videoBitrate !== undefined) {
    args.push(streamSpecifier ? `-b:v:${streamSpecifier}` : "-b:v", options.videoBitrate);
  }
  void stream;
}

export function hardwareOptimizationMarkers(decision: HardwareAccelerationDecision | null): string[] {
  if (!decision) return [];
  if (!decision.hardware) {
    return decision.fallback ? ["CPU_VIDEO_ENCODE", "HARDWARE_CPU_FALLBACK"] : ["CPU_VIDEO_ENCODE"];
  }
  const provider = decision.selected.toUpperCase();
  return ["HARDWARE_VIDEO_ENCODE", `${provider}_VIDEO_ENCODE`];
}

function validateBenchmarkOptions(options: HardwareBenchmarkOptions): Required<Pick<HardwareBenchmarkOptions, "codec" | "durationSeconds" | "width" | "height">> {
  const codec = options.codec ?? "h264";
  const durationSeconds = options.durationSeconds ?? 3;
  const width = options.width ?? 640;
  const height = options.height ?? 360;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) {
    throw new InvalidOperationError("hardware benchmark durationSeconds must be between 0 and 30 seconds.");
  }
  if (!Number.isInteger(width) || width <= 0 || width % 2 !== 0 || !Number.isInteger(height) || height <= 0 || height % 2 !== 0) {
    throw new InvalidOperationError("hardware benchmark width/height must be positive even integers.");
  }
  return { codec, durationSeconds, width, height };
}

export async function benchmarkHardwareEncoder(
  ffmpegPath: string,
  source: string,
  decision: HardwareAccelerationDecision,
  options: HardwareBenchmarkOptions = {}
): Promise<HardwareBenchmarkResult> {
  const normalized = validateBenchmarkOptions(options);
  const args = [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i", source,
    "-t", String(normalized.durationSeconds),
    "-vf", `scale=${normalized.width}:${normalized.height}:force_original_aspect_ratio=decrease,pad=${normalized.width}:${normalized.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    "-an"
  ];
  appendVideoEncoderOptions(args, decision, { preset: "veryfast" });
  args.push("-f", "null", "-");
  const started = performance.now();
  try {
    await runProcess(ffmpegPath, args, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    const elapsedMs = Math.max(1, performance.now() - started);
    return {
      provider: decision.selected,
      codec: decision.codec,
      encoder: decision.encoder,
      success: true,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      durationSeconds: normalized.durationSeconds,
      realtimeFactor: Number((normalized.durationSeconds / (elapsedMs / 1000)).toFixed(3))
    };
  } catch (error) {
    const elapsedMs = Math.max(1, performance.now() - started);
    return {
      provider: decision.selected,
      codec: decision.codec,
      encoder: decision.encoder,
      success: false,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      durationSeconds: normalized.durationSeconds,
      realtimeFactor: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function cpuEncoderForCodec(codec: HardwareVideoCodec): string {
  return CPU_ENCODERS[codec];
}

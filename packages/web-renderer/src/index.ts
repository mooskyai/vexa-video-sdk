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

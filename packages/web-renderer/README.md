# @vexa-video/web-renderer

Browser-safe capability detection, deterministic planning, WebCodecs video/audio encoding, and dependency-free WebM/MP4 video muxing for Vexa browser rendering.

The first V2.11 slice establishes capability/fallback planning. The second executes browser video through `VideoFrame`/`VideoEncoder`. The third adds VP9/AV1 WebM output. The fourth preserves WebCodecs AVC decoder metadata and adds H.264 fragmented-MP4 output. The fifth adds independent AAC/Opus `AudioEncoder` execution.

```ts
import {
  createWebVideoFile,
  detectWebRenderCapabilities,
  encodeWebAudioData,
  encodeWebVideoFrames,
  muxWebVideo,
  planWebRender
} from "@vexa-video/web-renderer";

const capabilities = await detectWebRenderCapabilities();
const plan = planWebRender({ container: "mp4", videoCodec: "h264", audio: true }, capabilities);

if (plan.kind === "browser") {
  const video = await encodeWebVideoFrames({
    plan, width: 1280, height: 720, fps: 30, frameCount: 90,
    renderFrame: async ({ frame }) => renderCompositionFrame(frame)
  });
  const audio = plan.audioCodec === undefined ? undefined : await encodeWebAudioData({
    audioCodec: plan.audioCodec,
    durationSeconds: video.durationSeconds,
    renderAudio: async (window) => renderCompositionAudioData(window)
  });
  const muxed = muxWebVideo(video);
  const file = createWebVideoFile(muxed, "render.mp4");
  console.log(file.size, file.type, audio?.chunks.length);
}
```

`renderFrame` keeps Canvas/DOM capture policy outside the video encoder. `renderAudio` receives deterministic sample windows and returns browser `AudioData`; Vexa closes each value after enqueue and owns the resulting encoded bytes/decoder metadata. Capability probes and encoder runtimes remain injectable for deterministic tests and worker-style hosts.

VP9/AV1 video is muxed into deterministic WebM. H.264 is muxed into fragmented MP4 from preserved AVC decoder metadata. AAC is encoded as raw `aac` frames with browser-provided `AudioSpecificConfig`; Opus is encoded as raw `opus` packets. Audio muxing is intentionally still separate, so `muxWebVideo` remains video-only in this slice. Concrete Canvas/DOM capture adapters and audio muxing remain later V2.11 work.

The package has no Node, SDK, FFmpeg, filesystem, or process-execution dependency.

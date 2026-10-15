# @vexa-video/web-renderer

Browser-safe capability detection, deterministic planning, WebCodecs video/audio encoding, and dependency-free MP4/WebM A/V muxing, and concrete Canvas/DOM frame capture for Vexa browser rendering.

The first V2.11 slice establishes capability/fallback planning. The second executes browser video through `VideoFrame`/`VideoEncoder`. The third adds VP9/AV1 WebM output. The fourth adds metadata-correct H.264 fragmented MP4. The fifth adds AAC/Opus `AudioEncoder` execution. The sixth combines H.264/AAC into MP4 and VP9-or-AV1/Opus into WebM. The seventh adds Canvas and serializable-DOM capture adapters.

```ts
import {
  createCanvasFrameCapture,
  createWebVideoFile,
  detectWebRenderCapabilities,
  encodeWebAudioData,
  encodeWebVideoFrames,
  muxWebMedia,
  planWebRender
} from "@vexa-video/web-renderer";

const capabilities = await detectWebRenderCapabilities();
const plan = planWebRender({ container: "mp4", videoCodec: "h264", audio: true }, capabilities);

if (plan.kind === "browser") {
  const capture = createCanvasFrameCapture({
    canvas,
    renderFrame: async ({ frame }) => renderCompositionFrameToCanvas(canvas, frame)
  });
  const video = await encodeWebVideoFrames({
    plan, width: 1280, height: 720, fps: 30, frameCount: 90,
    renderFrame: capture
  });
  const audio = plan.audioCodec === undefined ? undefined : await encodeWebAudioData({
    audioCodec: plan.audioCodec,
    durationSeconds: video.durationSeconds,
    renderAudio: async (window) => renderCompositionAudioData(window)
  });
  if (audio === undefined) throw new Error("audio plan expected");
  const muxed = muxWebMedia(video, audio);
  const file = createWebVideoFile(muxed, "render.mp4");
  console.log(file.size, file.type);
}
```

`createCanvasFrameCapture` validates frame dimensions and runs the caller's deterministic paint step before handing the canvas to `VideoFrame`. `createDomFrameCapture` snapshots a serializable DOM tree with computed styles, rasterizes it through SVG `foreignObject` plus `createImageBitmap`, draws into a reusable Canvas/OffscreenCanvas, and closes temporary bitmaps immediately. Canvas/video/iframe descendants fail closed because cloning them would not preserve their visual pixels. `renderAudio` receives deterministic sample windows and returns browser `AudioData`; Vexa closes each value after enqueue and owns the resulting encoded bytes/decoder metadata. Capability probes and encoder runtimes remain injectable for deterministic tests and worker-style hosts.

`muxWebVideo(video)` remains the backward-compatible video-only API. `muxWebMedia(video, audio)` adds the A/V boundary: H.264/AAC becomes dual-track fragmented MP4 using preserved AVC and AudioSpecificConfig metadata, while VP9-or-AV1/Opus becomes WebM with an `A_OPUS` track and `OpusHead` codec-private data. Both combined paths validate zero-origin monotonic streams and bounded duration skew. The capture adapters feed the same `encodeWebVideoFrames` callback; no second composition or renderer model is introduced.

The package has no Node, SDK, FFmpeg, filesystem, or process-execution dependency.

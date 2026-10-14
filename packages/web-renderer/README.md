# @vexa-video/web-renderer

Browser-safe capability detection, deterministic planning, and WebCodecs video-frame encoding for Vexa browser rendering.

The first V2.11 slice answers whether a browser can satisfy a requested render target and when the caller should fall back to the existing backend renderer. The second slice executes video-only browser plans through `VideoFrame`/`VideoEncoder`, with deterministic timestamps and keyframes, bounded encoder queues, progress callbacks, cancellation, typed failures, and explicit frame cleanup.

```ts
import {
  detectWebRenderCapabilities,
  encodeWebVideoFrames,
  planWebRender
} from "@vexa-video/web-renderer";

const capabilities = await detectWebRenderCapabilities();
const plan = planWebRender({ container: "webm" }, capabilities);

if (plan.kind === "browser") {
  const encoded = await encodeWebVideoFrames({
    plan,
    width: 1280,
    height: 720,
    fps: 30,
    frameCount: 90,
    renderFrame: async ({ frame }) => renderCompositionFrame(frame)
  });

  console.log(encoded.chunks.length);
}
```

`renderFrame` supplies the browser image source for each deterministic composition frame, so Canvas/DOM capture strategies remain separate adapters rather than a second composition model. Capability probes and encoding runtimes are injectable for deterministic tests and worker-style hosts.

V2.11.2 intentionally returns encoded video chunks, not a falsely labelled MP4/WebM file: WebCodecs performs elementary video encoding but does not provide container muxing. Audio encoding, muxing, Blob/File output, and concrete Canvas/DOM capture adapters remain later V2.11 slices.

The package has no Node, SDK, FFmpeg, filesystem, or process-execution dependency.

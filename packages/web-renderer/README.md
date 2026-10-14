# @vexa-video/web-renderer

Browser-safe capability detection, deterministic planning, WebCodecs video-frame encoding, and dependency-free WebM muxing for Vexa browser rendering.

The first V2.11 slice establishes capability/fallback planning. The second executes video-only browser plans through `VideoFrame`/`VideoEncoder`. The third muxes VP9/AV1 encoded chunks into an in-memory WebM container and exposes Blob/File output without changing composition semantics.

```ts
import {
  createWebVideoFile,
  detectWebRenderCapabilities,
  encodeWebVideoFrames,
  muxWebVideo,
  planWebRender
} from "@vexa-video/web-renderer";

const capabilities = await detectWebRenderCapabilities();
const plan = planWebRender({ container: "webm", videoCodec: "vp9" }, capabilities);

if (plan.kind === "browser") {
  const encoded = await encodeWebVideoFrames({
    plan,
    width: 1280,
    height: 720,
    fps: 30,
    frameCount: 90,
    renderFrame: async ({ frame }) => renderCompositionFrame(frame)
  });
  const muxed = muxWebVideo(encoded);
  const file = createWebVideoFile(muxed, "render.webm");
  console.log(file.size, file.type);
}
```

`renderFrame` keeps Canvas/DOM capture policy outside the encoder. Capability probes and encoding runtimes remain injectable for deterministic tests and worker-style hosts.

The built-in muxer currently accepts VP9/AV1 WebM output only. It validates a keyframe-first monotonic encoded stream, writes deterministic EBML/WebM metadata and clusters, and returns owned bytes plus a `video/webm` Blob. MP4/H.264 remains typed fail-closed until Vexa preserves the decoder configuration/codec-private data required to build a valid MP4. Browser audio and concrete Canvas/DOM capture adapters remain later V2.11 work.

The package has no Node, SDK, FFmpeg, filesystem, or process-execution dependency.

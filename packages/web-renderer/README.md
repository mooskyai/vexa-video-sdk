# @vexa-video/web-renderer

Browser-safe capability detection, deterministic planning, WebCodecs video-frame encoding, and dependency-free WebM/MP4 muxing for Vexa browser rendering.

The first V2.11 slice establishes capability/fallback planning. The second executes video-only browser plans through `VideoFrame`/`VideoEncoder`. The third adds VP9/AV1 WebM output. The fourth preserves WebCodecs AVC decoder metadata and adds H.264 fragmented-MP4 output.

```ts
import {
  createWebVideoFile,
  detectWebRenderCapabilities,
  encodeWebVideoFrames,
  muxWebVideo,
  planWebRender
} from "@vexa-video/web-renderer";

const capabilities = await detectWebRenderCapabilities();
const plan = planWebRender({ container: "mp4", videoCodec: "h264" }, capabilities);

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
  const file = createWebVideoFile(muxed, "render.mp4");
  console.log(file.size, file.type);
}
```

`renderFrame` keeps Canvas/DOM capture policy outside the encoder. Capability probes and encoding runtimes remain injectable for deterministic tests and worker-style hosts.

VP9/AV1 output is muxed into deterministic WebM. H.264 output is configured for AVC format, copies `EncodedVideoChunkMetadata.decoderConfig.description` into owned bytes, and uses that `AVCDecoderConfigurationRecord` to build a fragmented MP4 with `ftyp`/`moov` initialization metadata plus `moof`/`mdat` media data. Both paths validate keyframe-first monotonic encoded streams and expose owned bytes plus Blob/File output. Missing or malformed codec-private metadata fails closed instead of producing a misleading container. Browser audio and concrete Canvas/DOM capture adapters remain later V2.11 work.

The package has no Node, SDK, FFmpeg, filesystem, or process-execution dependency.

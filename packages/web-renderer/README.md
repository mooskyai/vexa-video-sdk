# @vexa-video/web-renderer

Browser-safe capability detection and deterministic planning foundation for Vexa browser rendering.

The first V2.11 slice does not encode media yet. It answers a narrower question reliably: can this browser satisfy a requested render target, which codecs can it encode, and when should the caller fall back to the existing backend renderer?

```ts
import { detectWebRenderCapabilities, planWebRender } from "@vexa-video/web-renderer";

const capabilities = await detectWebRenderCapabilities();
const plan = planWebRender({ container: "mp4", audio: true }, capabilities);

if (plan.kind === "backend-fallback") {
  // Delegate to the existing Node/hosted renderer.
}
```

Capability probes are injectable for deterministic tests and non-window browser runtimes. The package has no Node, SDK, FFmpeg, filesystem, or process-execution dependency. Frame capture, WebCodecs encoding, muxing, progress, cancellation, and Blob/File output are added in later V2.11 slices behind this boundary.

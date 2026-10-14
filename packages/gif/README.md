# @vexa-video/gif

Optional Node.js GIF integration for Vexa programmable surfaces.

The package implements the renderer's frame-aware surface adapter contract. Composition data carries a logical `sourceId`; the Node host maps that ID to a local GIF path. This keeps filesystem paths and FFmpeg decoding outside `@vexa-video/core`, browser packages, and the normal SDK.

```ts
import { createGifSurfaceAdapter } from "@vexa-video/gif";

const gifAdapter = createGifSurfaceAdapter({
  sources: {
    spinner: "./media/spinner.gif"
  }
});

await renderer.renderVideo({
  compositionId: "demo",
  output: "demo.mp4",
  surfaceAdapters: [gifAdapter]
});
```

Author the matching surface with serializable data:

```ts
{
  kind: "surface",
  id: "spinner",
  surface: {
    kind: "gif",
    rendererId: "vexa.gif",
    data: {
      sourceId: "spinner",
      fit: "contain",
      loop: true
    }
  }
}
```

`fit` accepts `contain`, `cover`, or `stretch`. Looping defaults to `true` and can be configured per source or overridden by surface data.

The adapter probes the configured GIF once per adapter instance, maps each Vexa local frame to source time, extracts an RGBA PNG with FFmpeg, returns the bytes to `@vexa-video/renderer`, and deletes its private extraction workspace. The renderer remains responsible for its own managed frame sequence and lossless animation intermediary.

This package is Node-only and intentionally optional. It does not add GIF/FFmpeg integration dependencies to core/browser packages.

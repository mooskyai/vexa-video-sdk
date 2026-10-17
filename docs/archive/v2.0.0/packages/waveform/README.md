# @vexa-video/waveform

Optional Node.js audio waveform integration for Vexa programmable surfaces.

The package implements the renderer's static surface adapter contract. Composition data carries a logical `sourceId`; the Node host maps that ID to a local media path. Filesystem paths, probing, and FFmpeg waveform rasterization therefore stay outside `@vexa-video/core`, browser packages, and the normal SDK.

```ts
import { createWaveformSurfaceAdapter } from "@vexa-video/waveform";

const waveformAdapter = createWaveformSurfaceAdapter({
  sources: {
    narration: "./media/narration.wav"
  },
  color: "#38bdf8",
  background: "black@0"
});

await renderer.renderVideo({
  compositionId: "demo",
  output: "demo.mp4",
  surfaceAdapters: [waveformAdapter]
});
```

Author the matching surface with serializable data:

```ts
{
  kind: "surface",
  id: "narration-waveform",
  surface: {
    kind: "waveform",
    rendererId: "vexa.waveform",
    data: {
      sourceId: "narration",
      color: "#38bdf8",
      background: "black@0"
    }
  }
}
```

`color` and `background` are optional per-surface overrides. The adapter uses the shared waveform compiler at the authored surface dimensions, so the existing waveform size/color validation rules apply.

The adapter probes each configured source lazily to ensure an audio stream exists, renders one PNG with the shared FFmpeg execution layer, returns the bytes to `@vexa-video/renderer`, and deletes its private raster workspace. The generic static surface path remains responsible for authored timing, effects, and transitions.

This package is Node-only and intentionally optional. It does not add audio-waveform execution dependencies to core/browser packages.

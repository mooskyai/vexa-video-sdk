# @vexa-video/test

Node-side visual regression helpers for Vexa programmable compositions.

The package reuses `VexaCompositionRenderer.renderFrame()` for selected-frame checkpoints and compares ordinary 8-bit, non-interlaced PNG snapshots with explicit per-channel and changed-pixel tolerances. It does not introduce another composition runtime or renderer.

```ts
import { readFile } from "node:fs/promises";
import {
  assertPngSnapshot,
  renderVisualCheckpoints
} from "@vexa-video/test";

const checkpoints = await renderVisualCheckpoints(renderer, {
  compositionId: "product-demo",
  outputDirectory: ".tmp/visual/product-demo",
  checkpoints: [
    { name: "start", frame: 0 },
    { name: "mid", frame: 150 }
  ]
});

const actual = await readFile(checkpoints[0].output);
const expected = await readFile("test/snapshots/product-demo-start.png");
assertPngSnapshot(actual, expected, {
  channelTolerance: 2,
  maxDifferentPixelRatio: 0.001
});
```

PNG comparison normalizes supported grayscale, RGB, grayscale-alpha, and RGBA inputs to RGBA before comparing pixels. Unsupported bit depths, interlacing, malformed PNG data, unsafe checkpoint names, duplicate checkpoint names, and invalid tolerance values fail with typed `VexaVisualTestError` errors.

This package is the V2.15 frame-level testing foundation. Checked-in regression baselines and runtime checkpoint parity build on this surface rather than defining separate comparison semantics.

## Checked-in baselines

For durable regression coverage, render named checkpoints and compare them with reviewed PNGs committed beside the fixture:

```ts
import {
  assertVisualCheckpointBaselines,
  renderVisualCheckpoints
} from "@vexa-video/test";

const checkpoints = await renderVisualCheckpoints(renderer, {
  compositionId: "visual-wipe",
  outputDirectory: ".tmp/visual-wipe",
  checkpoints: [
    { name: "start", frame: 0 },
    { name: "pre-transition", frame: 1 },
    { name: "transition-midpoint", frame: 4 },
    { name: "post-transition", frame: 6 },
    { name: "final-visible", frame: 10 }
  ]
});

await assertVisualCheckpointBaselines(checkpoints, {
  baselineDirectory: "test/baselines/wipe-transition",
  channelTolerance: 6,
  maxDifferentPixelRatio: 0.02
});
```

Keep baseline fixtures small, deterministic, and free of platform-dependent fonts when testing geometry/timing. Tolerances should cover known codec/raster rounding only; they must not be widened enough to hide incorrect transition boundaries, colors, or content.

## Runtime checkpoint parity

`assertRuntimeCheckpointParity()` compares semantic frame observations from existing runtimes against one reviewed checkpoint contract. The contract owns composition dimensions, fps, duration, named frames, canonical microsecond timestamps, and per-frame duration. Runtime integrations remain outside this package; tests translate the existing Player snapshot, Studio snapshot, and browser-renderer `VexaWebVideoFrameContext` into generic observations.

```ts
import { assertRuntimeCheckpointParity } from "@vexa-video/test";

assertRuntimeCheckpointParity(
  {
    width: 64,
    height: 36,
    fps: 12,
    durationInFrames: 12,
    checkpoints: [
      { name: "start", frame: 0 },
      { name: "transition-midpoint", frame: 4 }
    ]
  },
  observations,
  { requiredRuntimes: ["player", "studio", "browser-renderer"] }
);
```

Parity is exact for frame identity, dimensions, fps, duration, `timestampUs`, and `durationUs`. Missing checkpoints, duplicate observations, unknown checkpoint names, and field mismatches fail with typed `VexaRuntimeParityError` diagnostics. Browser-pixel comparison remains a separate capture concern; Node-only tests must not claim pixel parity for a browser surface they did not actually capture.

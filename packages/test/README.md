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

This package is the V2.15 frame-level testing foundation. Cross-runtime Player/Studio/browser-renderer parity fixtures and checked-in regression baselines build on this surface rather than defining separate comparison semantics.

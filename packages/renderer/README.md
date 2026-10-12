# @vexa-video/renderer

Node-side composition planning and execution for Vexa programmable video.

The renderer consumes a deterministic `vexa.bundle.json` manifest from `@vexa-video/bundler`, lists/selects compositions, validates still/frame/range/video targets, and emits serializable render plans with explicit frame ranges, concurrency, and timeout settings. Bundles may also export `vexaExecutableCompositions`; `VexaCompositionRenderer.fromManifest()` loads that executable surface, resolves input props and dynamic metadata through `@vexa-video/core`, lowers the resulting programmable scene to the existing `VideoProjectAst`, and executes image or video output through the shared FFmpeg layer.

```ts
import { VexaCompositionRenderer } from "@vexa-video/renderer";

const renderer = await VexaCompositionRenderer.fromManifest("./dist/vexa.bundle.json");
await renderer.renderStill({
  compositionId: "social-square",
  output: "./renders/social-square.png",
  inputProps: { background: "#111827" }
});

await renderer.renderFrameRange({
  compositionId: "product-demo",
  startFrame: 30,
  endFrameExclusive: 60,
  output: "./renders/product-demo-frames",
  concurrency: 4
});

const controller = new AbortController();
await renderer.renderVideo({
  compositionId: "product-demo",
  startFrame: 30,
  endFrameExclusive: 90,
  output: "./renders/product-demo.mp4",
  hardwareAcceleration: "auto",
  timeoutMs: 120_000,
  signal: controller.signal,
  onProgress(progress) {
    console.log(progress.percent, progress.media?.speed);
  }
});
```

Still and single-frame execution use Vexa's project frame compiler. Frame ranges materialize deterministic `frame-000000.*`-style files with bounded concurrency. Video execution trims the final composed video graph by exact frame number and trims audio by the corresponding frame-derived time range, preserving the exclusive-end contract without rendering a second intermediate video.

Programmable `shape` scene nodes are rendered without adding a second project model. The Node renderer converts normalized Vexa shape geometry into renderer-owned SVG markup, rasterizes it deterministically to transparent PNG with `resvg-js` inside the managed render workspace, substitutes those leaves with image nodes, and then reuses the existing `VideoProjectAst` plus FFmpeg image pipeline. FFmpeg therefore never needs an SVG decoder. Fill, stroke, fill-rule, line caps/joins, dash patterns, timing, opacity, z-order, and translation-only scene transforms are preserved. Width/height, rotation, scale, and anchor transforms on a shape path fail explicitly with `RENDER_SHAPE_UNSUPPORTED` until the dedicated frame-render transform path can represent them without changing geometry semantics. Renderer-owned SVG paint values reject external `url(...)` references.

Renderer-owned primitives use the same raster bridge. Every `solid` node plus every effect-bearing or transition-bearing `fill` node is converted to a transparent full-canvas SVG/PNG asset, preserving timing, z-order, opacity, translation, normalized effects, and transition metadata before entering the normal image/FFmpeg pipeline. Easing-aware programmable fade, slide, and wipe transitions therefore execute for renderer-materialized shapes/fills/solids through the same project image path; push/zoom/iris remain fail-closed until their dedicated execution graphs are implemented. Plain representable fills keep the direct project-background lowering fast path. Primitive width/height/rotation/scale/anchor scene transforms fail explicitly with `RENDER_PRIMITIVE_UNSUPPORTED`. Application-owned `surface` nodes remain serializable `rendererId` contracts only; the Node renderer deliberately keeps them fail-closed until a surface renderer registration/execution API exists.

Execution controls reuse the existing Vexa process and hardware contracts: video renders expose CPU/auto/provider hardware selection with the normal fallback policy, FFmpeg progress is normalized into `VexaRenderProgress`, `AbortSignal` cancellation is reported as `RENDER_ABORTED`, and process deadlines are reported as `RENDER_TIMEOUT`. Frame ranges report deterministic completed-frame progress while sharing one cancellation signal across active workers.

Storage-backed scene assets are resolved through `@vexa-video/sdk` `Storage` before project lowering. The same Vexa-managed workspace holds renderer-owned shape and primitive PNGs, so storage downloads and generated raster assets stay alive for the complete render and are removed together on success or failure. Caller-provided `resolvedAssets` remain an explicit override for already-materialized storage paths and cannot collide with generated renderer asset ids. Storage acquisition failures surface as `RENDER_ASSET_RESOLUTION_FAILED`.

Inject a configured `Storage` when a scene uses custom object providers or a custom workspace root:

```ts
import { Storage } from "@vexa-video/sdk";

const storage = new Storage({
  workspaceRoot: "./.tmp/render-assets",
  adapters: [myStorageAdapter]
});

await renderer.renderVideo({
  compositionId: "product-demo",
  output: "./renders/product-demo.mp4",
  storage,
  storageResolveOptions: { maxBytes: 512 * 1024 * 1024 }
});
```

Durable job orchestration remains separate from the synchronous renderer surface and continues to use the existing Vexa job contracts.

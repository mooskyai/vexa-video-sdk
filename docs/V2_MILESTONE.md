# Vexa Video SDK — Version 2 Milestone Plan

Version 2 adds a programmable video-composition layer on top of the existing Vexa 1.x media engine. The goal is to support code-defined video, interactive preview, local/server rendering, reusable motion primitives, templates, and agent-driven creation without replacing the deterministic FFmpeg, timeline, storage, job, hardware, or browser-safety foundations already present in the repository.

## Independent implementation rule

Vexa Version 2 is defined by Vexa's own product requirements and architecture. Its implementation must remain independent and Vexa-native:

- do not copy or port third-party source code;
- do not copy private/internal implementation details, tests, fixtures, package internals, or undocumented behavior from other products;
- do not make source-level or API-level compatibility with another product a requirement;
- use Vexa-owned types, naming, schemas, tests, examples, fixtures, and assets;
- reuse Vexa's existing `VideoProjectAst`, planning, FFmpeg, storage, jobs, hardware, cancellation, progress, and error contracts;
- document any new public runtime boundary before creating a package for it.

This keeps Version 2 aligned with Vexa's architecture and prevents Vexa's public contracts from becoming coupled to third-party implementation details, APIs, or licensing constraints.

## Version 2 product target

The same composition definition should be usable for:

```text
code / framework authoring
          |
          v
Vexa composition runtime
          |
          +---- browser preview / player
          |
          +---- local Node rendering
          |
          +---- render service / workers
          |
          +---- browser rendering where supported
          |
          +---- templates / agents / automation
```

Version 2 should not create a second media engine. Composition evaluation should eventually lower into the existing Vexa project and execution-planning paths wherever practical.

## Existing Vexa foundation

Version 2 starts from the current 1.x packages:

| Package | Current role | Version 2 relationship |
| --- | --- | --- |
| `@vexa-video/core` | Shared types, ASTs, validation, browser-safe contracts | Add shared composition/frame contracts where they are truly backend-neutral |
| `@vexa-video/ffmpeg` | FFmpeg planning/execution backend | Remains the main Node media backend |
| `@vexa-video/sdk` | Node developer API, storage, jobs, workers, hardware | Executes composition render plans and integrates remote rendering |
| `@vexa-video/angular` | Browser-safe Angular render client | Gains player/composition integration only through browser-safe contracts |
| `@vexa-video/ai` | Optional AI adapters and deterministic media planning | Can generate composition/project inputs without owning rendering |
| `@vexa-video/editor` | Framework-neutral editor state/history | Reused by Studio and later visual editing |
| `@vexa-video/cli` | Node CLI | Gains composition discovery, preview, still, and render commands |

New packages should be added only when a runtime or dependency boundary justifies them. Likely Version 2 packages include `@vexa-video/composition`, `@vexa-video/react`, `@vexa-video/player`, `@vexa-video/renderer`, `@vexa-video/bundler`, `@vexa-video/studio`, and `@vexa-video/web-renderer`.

## V2.1 — Composition contracts and registry

**Status:** Complete

Implemented on the Version 2 branch in `@vexa-video/core` with:

- `defineComposition()` and `defineStill()`;
- schema-version validation;
- JSON-safe, deterministically normalized default/input props;
- runtime prop validation hooks;
- async/sync dynamic metadata calculation;
- deterministic static metadata serialization;
- `ProgrammableCompositionRegistry` registration, lookup, sorted discovery, and atomic bulk registration;
- typed programmable-composition errors;
- browser-safe serializable metadata type exports.

### Acceptance evidence

Validated on Windows 11 with the supported repository toolchain:

- focused programmable-composition tests: **10/10 passed**;
- full `npm run verify`: **129/129 tests passed**, followed by a successful `tsc -b` build;
- generated `packages/core/dist/browser.js` forbidden-import audit: no `node:*`, `child_process`, `@vexa-video/sdk`, `@vexa-video/ffmpeg`, or Redis references found;
- `git diff --check`: clean.

V2.1 intentionally exposes browser-safe serializable metadata/types rather than a browser execution runtime. Cross-runtime frame/evaluation parity begins with V2.2 and later browser runtime stages.

The implementation is intentionally separate from the existing `composition.ts` timeline/project model. Version 2 compositions will lower into the existing Vexa project/execution paths in later stages rather than redefining V1 timeline semantics.

### Goal

Define the backend-neutral composition model before building framework components or rendering.

### Scope

- composition identity;
- width, height, fps, and duration-in-frames;
- still-image compositions;
- default/input props;
- input validation hooks;
- dynamic metadata calculation;
- composition registry and discovery;
- explicit composition schema version;
- deterministic serialization of static metadata;
- typed composition errors.

Example target API:

```ts
const productDemo = defineComposition({
  id: "product-demo",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 300,
  defaultProps: {
    title: "Vexa Video"
  }
});
```

### Architectural rule

The core contract must not depend on React, DOM APIs, Node.js, FFmpeg, or a browser bundler.

### Exit criteria

- shared contracts compile from browser and Node consumers;
- registry ordering and lookup are deterministic;
- invalid dimensions/fps/duration fail before rendering;
- schema version behavior is covered;
- README/architecture/testing docs remain synchronized.

## V2.2 — Frame, time, animation, and deterministic math

**Status:** Complete

Implemented in the current Version 2 branch slice with:

- explicit immutable `FrameContext` values carrying local frame, root `absoluteFrame`, and fps;
- nested local offsets that may become negative before a child sequence begins;
- frame/second conversion with explicit rounding modes;
- frame ranges with start, exclusive end, final frame, containment, local-frame, and clamp helpers;
- piecewise numeric interpolation with `extend`, `clamp`, and `identity` extrapolation;
- linear/quadratic easing primitives and custom easing callbacks;
- deterministic color interpolation for hex and `rgb()`/`rgba()` input;
- analytic under-damped, critically damped, and over-damped spring evaluation;
- index-addressable seeded deterministic random values without `Math.random()`;
- loop and frozen-frame context helpers;
- deterministic sequential/series section resolution with explicit positive/negative offsets;
- browser-safe runtime exports through `@vexa-video/core/browser`;
- focused golden tests for timing boundaries and invalid input.

### Acceptance evidence

Validated on Windows 11 with the supported repository toolchain:

- focused deterministic-timing suite: **13/13 passed**;
- full `npm run verify`: **142/142 tests passed**, followed by a successful `tsc -b` build;
- generated `packages/core/dist/browser.js` forbidden-import audit: no `node:*`, `child_process`, `@vexa-video/sdk`, `@vexa-video/ffmpeg`, or Redis references found;
- Microsoft Edge headless browser execution of `packages/core/test/programmable-timing-browser.html` over HTTP returned `VEXA_TIMING_PARITY_PASS`;
- `git diff --check`: clean.

V2.3 is the next implementation target.

### Goal

Create the timing semantics used by every authoring adapter and renderer.

### Scope

- current-frame context;
- seconds/frame conversion;
- local frame offsets for nested sequences;
- interpolation;
- color interpolation;
- easing;
- spring animation;
- seeded deterministic random values;
- loop;
- freeze;
- series/sequential sections;
- extrapolation/clamping behavior;
- frame-range helpers.

Target semantics:

```ts
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp"
});
```

### Exit criteria

- pure deterministic functions;
- no Date/time/global-random dependence;
- nested timing has golden tests;
- Node and browser produce the same values for the same inputs.

## V2.3 — Composition scene graph and media elements

**Status:** Complete

Implemented in the current Version 2 branch slice with:

- schema-versioned, browser-safe programmable scene contracts;
- nested `group`/`layer` containers plus fill, solid, text, image, video, audio, and serializable SVG/canvas surface intent;
- deterministic parent-relative timing, additive z-order, opacity propagation, transform chains, and stable declaration ordering;
- asset manifests covering static paths and existing Vexa local/HTTP/object-storage references;
- explicit asset-class policy gates plus immutable preload/readiness state;
- crop/fit, trim, playback-rate, volume/mute, text-style, and transform validation;
- deterministic scene serialization and flattened render-graph discovery;
- typed `VideoProjectAst` lowering for the representable subset, with unsupported frame-render features rejected instead of approximated;
- remote HTTP/object assets requiring SDK/storage resolution before project lowering;
- a real SDK integration fixture that lowers and renders a Vexa-owned background/video/image/text/audio scene and checks output metadata plus visual luminance checkpoints.

### Acceptance evidence

Validated on Windows 11 with the supported repository toolchain:

- focused programmable-scene suite: **17/17 passed**;
- regression coverage confirms explicit `x: 0` / `y: 0` survives `VideoProjectAst` lowering instead of being reinterpreted as centered media;
- real SDK/FFmpeg programmable-scene render integration: **1/1 passed** with background, image, video, text, and audio output checks;
- full `npm run verify`: **160/160 tests passed**, followed by a successful `tsc -b` build;
- generated `packages/core/dist/browser.js` and `packages/core/dist/programmable-scene.js` forbidden-import audits found no `node:*`, `child_process`, `@vexa-video/sdk`, `@vexa-video/ffmpeg`, or Redis references;
- `npm run release:check`: all **7** public packages reported release-ready;
- `npm run release:pack`: succeeded and included `programmable-scene` declarations/runtime artifacts in the packed core package;
- `git diff --check`: clean before closure.

V2.4 is the next implementation target.

### Goal

Represent code-defined visual/audio intent without leaking FFmpeg filters into application code.

### Scope

- layer/group/fill primitives;
- image;
- video;
- audio;
- text;
- solid/background;
- SVG/canvas integration contracts;
- z-order;
- transforms;
- opacity;
- crop/fit;
- volume/mute;
- source trim and playback rate;
- local/static assets;
- remote-media references through existing Vexa storage policy;
- asset preload/ready state.

### Lowering strategy

Prefer:

```text
composition scene graph
       |
       v
normalized frame/timeline intent
       |
       v
VideoProjectAst / media operations
       |
       v
existing planner
```

A new execution path is justified only when a frame-rendered browser/DOM composition cannot be represented by the normal project renderer.

## V2.4 — React authoring adapter

**Status:** Complete

Implemented in the current Version 2 branch slice with:

- public `@vexa-video/react` package with React as a peer dependency and `@vexa-video/core` as its only Vexa runtime dependency;
- React composition registration and deterministic sorted discovery around core programmable-composition definitions;
- frame, absolute-frame, resolved composition-config, and input-props hooks;
- sequence, series, loop, and freeze timing scopes backed by the shared core timing runtime;
- group/layer/fill/solid/text/image/video/audio/surface authoring components that emit the shared programmable-scene model;
- static/storage asset helpers that preserve core asset-policy semantics;
- render-readiness controller plus delay/resume hooks with unmount cleanup for asynchronous authoring work;
- browser-safe composition definition/resolution exports from `@vexa-video/core/browser` so framework code does not import the Node-oriented core entry point;
- release/build wiring for the new public workspace.

The adapter does not own player state, bundling, Node rendering, or FFmpeg execution. Those remain in their later Version 2 runtime boundaries.

### Acceptance evidence

Validated on Windows 11 with the supported repository toolchain:

- React authoring tests pass as part of the full repository suite, including registration/cleanup, resolved props, frame/config hooks, nested sequence/series timing, loop/freeze semantics, media-to-scene mapping, asset helpers, render-ready lifecycle, invalid-hook behavior, preview/render parity, and package source boundary checks;
- full `npm run verify`: **173/173 tests passed**, followed by a successful `tsc -b` build;
- generated `packages/react/dist/index.js` and `packages/core/dist/browser.js` forbidden-import audits found no `node:*`, `child_process`, `@vexa-video/sdk`, `@vexa-video/ffmpeg`, or Redis references;
- `npm run release:check`: all **8** public packages reported release-ready;
- `npm run release:pack`: succeeded and included the `@vexa-video/react` runtime, declarations, maps, README, and package manifest;
- the deterministic compatibility test confirms preview and render consumers observe identical timing and scene values for the same React composition;
- `git diff --check`: clean apart from Git's Windows line-ending notice for the npm-generated lockfile.

React 19 reports `react-test-renderer` as deprecated during tests; this is non-failing test-infrastructure debt and should be replaced before it becomes incompatible. `npm install` also reported audit advisories and unapproved install-script notices; those require separate dependency/security review and are not attributed to V2.4 without an `npm audit` dependency trace.

V2.5 is the next implementation target.

### Goal

Offer React-based code authoring while keeping React outside the deterministic media core.

Likely package:

```text
@vexa-video/react
```

### Scope

- composition registration component;
- frame/composition hooks;
- sequence/series/loop/freeze components;
- fill/layer wrappers;
- media components;
- asset helper integration;
- input props;
- render-ready/delay handling for asynchronous assets.

### Boundary

`@vexa-video/react` must not runtime-import:

```text
@vexa-video/sdk
node:*
child_process
FFmpeg execution code
Redis
filesystem APIs
```

React is an adapter, not the source of Vexa's media semantics.

## V2.5 — Browser player core and framework adapters

**Status:** Complete

Implemented in the current Version 2 branch slice with:

- public `@vexa-video/player` package depending only on the browser-safe core contract at runtime;
- deterministic programmatic controller for play/pause, frame/time seeking, stepping, end behavior, looping, volume/mute, playback rate, buffering, errors, and disposal;
- exact fractional-frame carry so repeated small browser-clock deltas resolve to the same frame progression;
- poster-frame presentation before first playback/seek interaction;
- framework-neutral typed events and immutable snapshots;
- responsive `contain`, `cover`, and `actual` scaling math;
- fullscreen capability/request/exit helpers;
- thin DOM host with requestAnimationFrame scheduling and ResizeObserver integration while controller semantics remain clock-independent;
- accessible native default controls plus explicit `custom`/`none` modes that inject no unwanted controls;
- Vexa-owned real-browser acceptance fixture for timing, resize, buffering, accessibility, and custom-controls behavior;
- first-class Player workspace in the existing visual playground, reachable from normal playground navigation and isolated from unrelated clip-editing controls.

The player does not own composition bundling or Node rendering. The render callback receives the selected frame and browser viewport; V2.6/V2.7 connect bundled compositions and Node frame/video rendering to the same timing contracts.

### Acceptance evidence

Validated with **17/17** focused player tests and **190/190** full repository tests, a successful `tsc -b` build, clean generated browser dependency audits, **9** release-ready public packages, successful release packing, and manual browser acceptance of the integrated Player workspace through `npm run dev`. V2.6 is the next implementation target.

### Goal

Embed deterministic composition playback in applications.

Likely package:

```text
@vexa-video/player
```

### Scope

- play/pause;
- seek by frame/time;
- frame step;
- loop;
- volume/mute;
- playback rate;
- responsive scaling;
- buffering state;
- poster frame;
- fullscreen integration;
- programmatic controller;
- typed events;
- accessibility baseline;
- custom-controls mode.

The state machine should be framework-neutral where practical so Angular and future Vue/React UI adapters do not implement different playback semantics.

## V2.6 — Composition bundling and discovery

### Goal

Produce a browser-executable composition bundle for Studio and frame rendering.

Likely package:

```text
@vexa-video/bundler
```

### Scope

- TypeScript/TSX;
- source maps;
- CSS/assets;
- static/public assets;
- environment allowlist;
- deterministic bundle manifest;
- composition discovery;
- development and production modes;
- Windows path normalization;
- safe error reporting.

### Security

Bundling user application code does not make that code trusted. Server render deployments must isolate untrusted composition code at the process/container boundary.

## V2.7 — Node composition renderer

### Goal

Render a composition or still from Node while reusing existing Vexa infrastructure.

Likely package:

```text
@vexa-video/renderer
```

### Scope

- list/select compositions from a bundle;
- resolve dynamic metadata;
- render still;
- render one frame;
- render frame range;
- render video;
- progress;
- cancellation;
- timeouts;
- configurable concurrency;
- audio collection/mixing;
- output codec/container options;
- hardware encoding through existing Vexa hardware contracts;
- storage/workspace integration;
- typed rendering errors.

### Architectural rule

Do not duplicate:

- FFmpeg process management;
- codec validation;
- hardware detection;
- cancellation;
- storage;
- job state;
- progress contracts.

## V2.8 — Vexa Studio development environment

### Goal

Provide a local visual development surface for programmable compositions.

Likely split if necessary:

```text
@vexa-video/studio        # browser UI/runtime
@vexa-video/studio-server # Node development host, only if the boundary requires it
```

### Scope

- composition selector;
- player/preview;
- playhead/timeline;
- frame stepping;
- props editor;
- dynamic metadata inspection;
- render controls;
- output/progress panel;
- asset inspection;
- console/error overlay;
- hot reload;
- keyboard shortcuts;
- preservation of current frame across safe reloads.

Reuse `@vexa-video/editor` state/history utilities instead of creating a second editor state model.

## V2.9 — Shapes, effects, transitions, fonts, and caption components

### Goal

Provide a Vexa-owned motion-graphics component library.

### Scope

Shapes:

- rectangle;
- circle/ellipse;
- line;
- polygon/star;
- path/arc.

Effects:

- blur;
- brightness/contrast;
- saturation/hue;
- grayscale/sepia;
- shadow/glow;
- noise/vignette.

Transitions:

- fade;
- slide;
- wipe;
- push;
- zoom;
- iris/circle;
- configurable timing/easing.

Typography:

- local fonts;
- optional remote font adapters;
- font readiness;
- text stroke/shadow;
- alignment/spacing;
- deterministic font failures.

Captions:

- integrate existing `CaptionDocument`;
- sentence and word timing;
- active-word/karaoke rendering;
- speaker-aware styles where metadata exists.

## V2.10 — Extended programmable media

### Goal

Cover common programmable-video inputs without bloating core packages.

Possible optional integrations:

- animated image/GIF;
- Lottie;
- Three.js;
- Rive or similar animation adapters;
- audio waveform visualization;
- reusable sound effects;
- canvas/WebGL custom drawing.

Each integration should be optional and should not become a dependency of `@vexa-video/core` or the normal Node SDK.

## V2.11 — Browser rendering and WebCodecs

### Goal

Render suitable compositions entirely in the browser.

Likely package:

```text
@vexa-video/web-renderer
```

### Scope

- capability detection;
- Canvas/DOM capture strategy selected by supported composition type;
- WebCodecs video encoding where supported;
- browser audio encoding/muxing where supported;
- progress;
- cancellation;
- Blob/File output;
- codec capability reporting;
- deterministic fallback to backend rendering when unsupported.

Browser rendering is an alternate backend, not a reason to weaken Node/browser package isolation.

## V2.12 — Templates and parameterized compositions

### Goal

Make compositions reusable by applications, APIs, and agents.

### Scope

- typed input schema;
- defaults;
- validation;
- template metadata/catalog;
- aspect-ratio variants;
- dynamic metadata;
- reusable assets;
- JSON-safe invocation for service/agent use.

Target flow:

```text
template + validated props
          |
          v
composition
          |
          v
player / still / local render / hosted render
```

## V2.13 — Hosted/serverless composition rendering

### Goal

Connect composition rendering to the existing hosted-render and job abstractions.

### Scope

- serializable render request;
- composition bundle reference;
- validated input props;
- submit/get/cancel;
- progress;
- worker rendering;
- deterministic artifact identity;
- remote output storage;
- optional provider adapters such as AWS/container platforms.

Keep cloud SDKs outside core packages.

## V2.14 — Agent, MCP, and CLI workflows

### Goal

Make composition discovery and rendering usable by humans, automation, and coding agents through typed operations.

CLI targets:

```bash
vexa compositions
vexa studio
vexa render ProductDemo output.mp4
vexa still ProductDemo thumbnail.png --frame 120
vexa bundle ./src/video.tsx
```

Agent-safe operations should include:

- list compositions;
- inspect input schema;
- validate props;
- render preview/still;
- start render;
- inspect render state;
- cancel render.

A future `@vexa-video/mcp` package is allowed only if it exposes the same typed composition/render contracts instead of bypassing them.

## V2.15 — Visual regression and parity testing

### Goal

Make programmable rendering testable at the frame level.

Possible package:

```text
@vexa-video/test
```

### Scope

- selected-frame rendering;
- image snapshot comparison;
- tolerance configuration;
- animation timing assertions;
- player/renderer parity fixtures;
- browser/Node parity fixtures;
- deterministic test assets;
- audio duration/sync assertions.

Testing requirements are defined in `V2_MILESTONE_TESTING.md`.

## V2.16 — Version 2 release readiness

### Goal

Release the programmable-video layer without weakening the Version 1 guarantees.

### Required release checks

- all public packages use the synchronized release version;
- package exports and browser/Node boundaries are audited;
- packed-tarball clean installs pass;
- Windows 11 real rendering passes;
- Linux CI passes;
- macOS-sensitive code has CI/acceptance coverage where applicable;
- browser tests pass on supported Chromium/Edge versions;
- no Node-only dependency leaks into browser packages;
- documentation and examples are synchronized;
- migration/release notes explain all Version 2 public API changes.

## Recommended implementation order

```text
V2.1  Composition contracts and registry
  |
V2.2  Frame/time/animation semantics
  |
V2.3  Scene graph and media elements
  |
V2.4  React authoring adapter
  |
V2.5  Browser player
  |
V2.6  Bundler and discovery
  |
V2.7  Node composition renderer
  |
V2.8  Studio
  |
V2.9  Shapes/effects/transitions/fonts/captions
  |
V2.10 Extended programmable media
  |
V2.11 Browser renderer/WebCodecs
  |
V2.12 Templates
  |
V2.13 Hosted/serverless rendering
  |
V2.14 Agent/MCP/CLI workflows
  |
V2.15 Visual regression
  |
V2.16 Version 2 release
```

## Version 2 completion definition

Version 2 is complete when a developer can define one Vexa composition and use the same logical composition to:

1. preview it interactively in a browser;
2. render a still;
3. render a video locally through Node;
4. invoke it with validated input props;
5. run it through Vexa's existing job/hosted-render contracts;
6. test selected frames deterministically;
7. use it without importing Node execution code into browser packages.

The Version 3 platform work is tracked separately in `V3_MILESTONE.md`.

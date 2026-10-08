# Vexa Video SDK — Version 2 Milestone Testing

This document defines the acceptance gates for the Version 2 programmable-video work described in `V2_MILESTONE.md`.

A Version 2 stage is not complete because its API compiles. It is complete only when the behavior is deterministic, the runtime boundary is preserved, automated coverage exists, and at least one realistic acceptance path validates the changed execution surface.

## Baseline gates for every Version 2 change

Run:

```bash
npm run format:check
npm run typecheck
npm test
npm run build
npm run verify
```

When package metadata or public package exports change, also run:

```bash
npm run release:check
npm run release:pack
```

No stage may regress existing Version 1 media tests.

## Environment baseline

Primary local acceptance:

```text
Windows 11
Node.js >= 24.21.0
npm 11+
FFmpeg available in PATH
ffprobe available in PATH
```

CI/secondary acceptance:

- Linux;
- macOS where platform-sensitive behavior is changed;
- Chromium/Chrome for browser runtimes;
- Microsoft Edge on Windows for browser acceptance;
- hardware-specific tests only when the required device/driver is available.

Tests that require unavailable hardware must report a clear skip reason rather than silently passing.

## Independent validation rule

Tests and fixtures for Version 2 capabilities must be Vexa-owned and derived from Vexa's documented behavior.

Do not copy:

- third-party test source;
- snapshot images from other products;
- example projects from other products;
- third-party media fixtures;
- private, undocumented, or internal package behavior from another implementation.

The purpose of parity testing is to verify Vexa's documented behavior across Vexa runtimes, platforms, preview paths, and render paths—not compatibility with another product.

## V2.1 — Composition contracts and registry

**Status:** Complete

Current implementation coverage includes definition normalization, video/still metadata, schema rejection, JSON prop validation, runtime prop validation, dynamic metadata success/failure, deterministic ordering, duplicate/missing lookup behavior, atomic bulk registration, and deterministic metadata serialization.

Acceptance recorded on Windows 11:

- focused programmable-composition suite: **10/10 passed**;
- repository-wide `npm run verify`: **129/129 passed** and `tsc -b` completed successfully;
- generated `@vexa-video/core/browser` artifact audit: no forbidden Node/runtime execution references;
- patch/worktree whitespace gate: `git diff --check` clean.

V2.1's browser surface is intentionally type/serialization-only. A browser execution runtime does not exist at this stage, so runtime metadata/frame parity is not a V2.1 exit requirement; cross-runtime deterministic evaluation begins in V2.2 and is enforced again by Player/renderer stages.

### Unit tests

Validate:

- required ID;
- duplicate ID rejection;
- width/height > 0;
- fps > 0;
- duration-in-frames > 0;
- still composition metadata;
- default props;
- invalid input props;
- deterministic registry ordering;
- missing composition lookup;
- dynamic metadata success/failure;
- unsupported `schemaVersion`.

### Boundary test

A minimal browser build that imports composition contracts must not pull in:

```text
node:*
child_process
@vexa-video/sdk
@vexa-video/ffmpeg
Redis clients
```

### Exit gate

V2.1 is complete when Node contract tests pass, serialized metadata remains deterministic, the full repository gate passes, and the browser-safe entry point remains free of Node execution dependencies. Browser runtime value parity starts in V2.2 once deterministic frame/time functions are available.

## V2.2 — Frame/time/animation semantics

**Status:** Complete

Current focused coverage exercises root and nested frame contexts, negative local offsets, freeze semantics, exact frame/second conversion, frame zero/final-frame ranges, every defined extrapolation mode, easing endpoints, piecewise interpolation, color interpolation, spring convergence and clamping, loop boundaries, series gaps/overlaps, seeded-random repeatability, and invalid-input rejection.

Acceptance recorded on Windows 11:

- focused deterministic-timing suite: **13/13 passed**;
- repository-wide `npm run verify`: **142/142 passed** and `tsc -b` completed successfully;
- generated `@vexa-video/core/browser` artifact audit: no forbidden Node/SDK/FFmpeg/Redis runtime references;
- real Microsoft Edge headless parity execution returned `VEXA_TIMING_PARITY_PASS`;
- patch/worktree whitespace gate: `git diff --check` clean.

### Golden tests

Cover:

- frame 0;
- final frame;
- negative/local offsets where valid;
- nested sequences;
- interpolation inside/outside ranges;
- all extrapolation modes;
- easing endpoints;
- spring convergence;
- loop boundaries;
- freeze behavior;
- series offsets;
- seeded random stability.

### Cross-runtime parity

Generate the same deterministic vector through the normal `@vexa-video/core` surface and the browser-safe `@vexa-video/core/browser` surface. The vector must cover interpolation, color interpolation, spring output, looped frame context, series offsets, and seeded random values. Values must match exactly where integer/string output is expected and within `1e-12` for floating-point animation values.

A real Chromium/Edge execution of that vector is required before V2.2 is marked complete; Node-only import parity is useful coverage but is not a substitute for the browser acceptance run. The repository includes `packages/core/test/programmable-timing-browser.html` for this purpose. After `npm run build`, serve the repository root over HTTP and load that fixture; successful evaluation writes `VEXA_TIMING_PARITY_PASS` into the document.

### Repeatability

Run the same test vector multiple times and ensure output is identical.

## V2.3 — Scene graph and media elements

**Status:** Complete

Focused coverage exercises deterministic asset ordering/serialization, nested timing and transforms, z-order ties, opacity propagation, crop/fit and media controls, missing/kind-mismatched assets, remote policy failures, duplicate identifiers, serializable SVG/canvas surface contracts, readiness state, `VideoProjectAst` lowering, remote-resolution requirements, typed unsupported-lowering failures, browser/core scene parity, and explicit zero-coordinate preservation.

The SDK acceptance test builds Vexa-owned FFmpeg fixtures, lowers a scene containing background, video, image, text, and standalone audio through `VideoProject.fromAst()`, renders it, probes dimensions/duration/audio, and samples visual luminance regions.

### Acceptance evidence

- focused programmable-scene tests: **17/17 passed**;
- real SDK/FFmpeg programmable-scene integration: **1/1 passed**;
- full repository test gate: **160/160 passed** and `tsc -b` completed successfully;
- browser entry and programmable-scene runtime forbidden-import audits: clean;
- release metadata check: all **7** public packages ready;
- dry-run package packing: successful, including programmable-scene runtime/type artifacts in `@vexa-video/core`.

### Validation tests

Cover:

- z-order;
- nested transforms;
- opacity;
- crop/fit;
- image source;
- video source;
- audio source;
- trim;
- playback rate;
- volume/mute;
- invalid source;
- missing asset;
- remote-media policy failures.

### Lowering tests

For representable compositions, assert stable lowering into `VideoProjectAst` or the selected normalized render graph.

### Real media test

Render a Vexa-owned fixture containing:

- one background;
- one image;
- one video;
- one text layer;
- one audio layer.

Assert duration, dimensions, audio presence, and expected visual checkpoints.

## V2.4 — React authoring adapter

**Status:** Complete

The implementation includes React authoring coverage for registration/cleanup, core-resolved props, frame/config hooks, nested sequence/series timing, loop/freeze semantics, media scene mapping, asset helpers, render-ready lifecycle and cleanup, invalid hook use, preview/render timing parity, and browser-package boundary enforcement.

### Acceptance evidence

- full repository test gate: **173/173 passed** and `tsc -b` completed successfully;
- generated `packages/react/dist/index.js` and `packages/core/dist/browser.js` forbidden-import audits: clean;
- deterministic preview/render compatibility vector: passed;
- release metadata check: all **8** public packages ready;
- dry-run package packing: successful, including `@vexa-video/react` runtime and declaration artifacts;
- npm-generated lockfile update is part of V2.4 and must be committed with the package.

React 19 emits a deprecation warning for `react-test-renderer`; the warning does not fail the suite but should be tracked as test-infrastructure migration work. `npm install` also reported dependency audit/install-script warnings that need separate security review before public release.

### Browser dependency audit

Build/package inspection must prove no runtime import of:

```text
node:*
child_process
@vexa-video/sdk
@vexa-video/ffmpeg
Redis
filesystem-only modules
```

### Component tests

Cover:

- composition registration;
- frame hook;
- composition-config hook;
- nested sequence offset;
- loop;
- freeze;
- media component props;
- async render-ready lifecycle;
- unmount cleanup;
- invalid hook use.

### Compatibility test

The same React composition should preview and render with the same timing values.

## V2.5 — Browser player

**Status:** Complete

The focused player suite covers config normalization, initial/poster frames, play/pause, frame/time seek, stepping, terminal end behavior, loop wrapping, fractional playback-rate progression, volume/mute, buffering, responsive fit math, fullscreen capability/failure paths, error lifecycle, metadata integration, disposal, accessible control descriptors, and browser-package dependency isolation.

A Vexa-owned browser fixture at `packages/player/test/player-browser.html` mounts default and custom-control hosts and validates deterministic frame progression, buffering, responsive scaling, accessible/keyboard-reachable controls, and no injected controls in custom mode. The existing visual playground also exposes Player as a first-class workspace for normal `npm run dev` browser acceptance.

V2.5 closure evidence: focused player tests **17/17**, full repository tests **190/190**, TypeScript build passed, generated player/core browser audits returned no forbidden Node/SDK/FFmpeg/Redis imports, `release:check` reported **9** packages ready, `release:pack` succeeded, and the integrated Player workspace was manually verified in the normal playground.

### Functional tests

Automate:

- initial frame;
- play;
- pause;
- seek;
- frame step forward/backward;
- end behavior;
- loop;
- volume/mute;
- playback rate;
- resize;
- fullscreen capability path;
- poster frame;
- buffering;
- error event.

### Accessibility

Verify:

- controls are keyboard reachable when default controls are enabled;
- buttons have accessible labels;
- focus behavior is predictable;
- custom-controls mode does not inject unwanted controls.

### Browser acceptance

Run on Chromium and Windows Edge.

## V2.6 — Bundler and composition discovery

**Status:** Complete

The focused V2.6 suite covers descriptor validation/sorting, TypeScript and TSX entry bundling, CSS and fingerprinted local assets, public/static copying, dynamic-import chunks, explicit source-map modes, environment filtering, deterministic production manifests, repeatable composition discovery, typed malformed-source diagnostics, and portable Windows path behavior.

Acceptance recorded on Windows 11: focused bundler suite **14/14 passed**; full `npm run verify` **204/204 passed** with a successful TypeScript build; environment filtering, deterministic bundle/manifest generation, TS/TSX, CSS/assets, public assets, dynamic imports, source maps, malformed-source diagnostics, and Windows path behavior all passed through real Vexa-owned fixtures; generated `dist/entry.js` remained free of forbidden Node/SDK/FFmpeg/Redis imports; `release:check` reported **10** packages ready; and `release:pack` succeeded including `@vexa-video/bundler`.

### Fixtures

Create Vexa-owned fixture projects for:

- TypeScript entry;
- TSX entry;
- CSS;
- local asset;
- public/static asset;
- dynamic import;
- source map;
- environment allowlist;
- malformed source.

### Determinism

Production bundle manifest and composition discovery order must be stable for unchanged inputs.

### Windows tests

Cover:

- drive-letter paths;
- backslashes;
- spaces in path;
- long nested paths where CI permits.

### Security

Confirm environment variables not explicitly allowed are not exposed to browser bundles.

## V2.7 — Node composition renderer

**Status:** Complete

### Foundation tests

Cover the first renderer slice with deterministic tests for:

- manifest-backed composition listing/selection;
- still/video target-kind validation;
- frame bounds and exclusive-end frame ranges;
- complete/subrange video planning;
- concurrency and timeout defaults/overrides;
- typed invalid-option and missing-composition errors;
- persisted bundle-manifest loading;
- Playground render-plan requests against the fixed composition fixture.

### Still/frame execution tests

Cover the executable-render slice with deterministic tests for:

- browser-bundle `vexaExecutableCompositions` loading and validation;
- input-prop and resolved-metadata evaluation before frame selection;
- real PNG still output from a bundled still composition;
- real single-frame PNG output from a bundled video composition;
- shared `VideoProjectAst` lowering and FFmpeg frame extraction;
- planning-only renderer instances rejecting execution when no bundle location is available.

### Frame-range/video execution tests

Cover the next executable-render slice with deterministic tests for:

- exact `[startFrame, endFrameExclusive)` video-graph trimming;
- audio trimming from the same frame-derived time range;
- real bounded-concurrency PNG frame-range output with deterministic filenames;
- real MP4 output from a bundled executable composition;
- resolved dynamic FPS/duration driving execution rather than stale manifest timing;
- invalid resolved ranges failing before FFmpeg execution.

### Execution-control tests

Cover the execution-control slice with deterministic tests for:

- still and frame-range progress reaching a stable 100% terminal state;
- FFmpeg video progress flowing through the shared progress parser;
- CPU hardware selection plumbing without environment-dependent accelerator requirements;
- pre-aborted `AbortSignal` execution mapping to `RENDER_ABORTED`;
- FFmpeg process deadlines mapping to `RENDER_TIMEOUT`;
- Playground progress streaming, timeout input, hardware selection, and cancellation controls using the existing composition render route;
- a syntax-regression guard for the Compositions Playground client source.

Manual Playground acceptance also verifies that renderer planning/execution controls never overlap in the Selected composition panel, the Bundles/Compositions layout collapses cleanly at narrower widths, the Player diagnostics stack responsively, and both focused workspaces can enter/exit full-screen mode while the Player keeps one visible playback transport.

Storage/workspace acceptance additionally verifies that an executable scene containing a storage-backed asset is materialized through an injected `Storage` adapter into a `vexa-render-*` managed workspace, that FFmpeg consumes the managed path, and that the workspace is empty again after successful rendering and after typed asset-resolution failure. Caller-supplied `resolvedAssets` continue to bypass automatic acquisition for those asset IDs.

For final Windows video acceptance, run the repository verification first and then execute:

```powershell
npm run verify
node .\scripts\verify-v2-renderer.mjs
```

The acceptance script builds the real Playground composition bundle, renders `product-demo` frames `[0, 60)` to `.tmp/v2-renderer-acceptance/product-demo-0-60.mp4` with CPU H.264, invokes the configured `ffprobe`, and fails unless the output is 1920x1080, 30fps, exactly 60 decoded video frames, H.264, and approximately 2 seconds long.

The shared responsive/full-screen controller is syntax-checked alongside the existing Compositions client source so UI integration failures are caught by `npm run verify` before browser acceptance.

### API tests

Cover:

- composition discovery;
- composition selection;
- dynamic metadata;
- still render;
- single-frame render;
- frame-range render;
- full video;
- progress;
- cancellation;
- timeout;
- invalid codec/container;
- invalid input props.

### Existing subsystem reuse

Tests should confirm the renderer uses existing Vexa contracts for:

- FFmpeg execution;
- hardware choice;
- cancellation;
- progress;
- storage/workspace cleanup.

### Real render acceptance

On Windows 11 render a deterministic short composition and inspect it with ffprobe:

- expected width/height;
- expected fps;
- expected duration tolerance;
- expected video codec;
- expected audio stream when present.

## V2.8 — Studio

**Status:** Complete

### Foundation tests

Cover the browser-safe Studio runtime with deterministic tests for:

- stable composition catalog ordering and selection;
- Player/editor playhead synchronization;
- frame stepping and playback progression;
- draft props remaining separate from last resolved dynamic metadata;
- resolved metadata updating fps/duration/canvas state while preserving or clamping the current frame;
- same-composition reload preserving current frame and dirty props;
- still compositions remaining on frame zero and rejecting playback;
- typed missing/mismatched-composition errors;
- browser-source boundary checks rejecting Node/SDK/renderer/FFmpeg imports;
- transient `TimelineHistory.sync()` updates not creating undo entries.

### Playground integration tests

Cover the first visual Studio integration with deterministic checks for:

- Studio client JavaScript syntax;
- browser source importing Studio/Core browser contracts but no Node SDK/renderer/FFmpeg modules;
- the local development host explicitly serving `@vexa-video/studio`, `@vexa-video/editor`, and generated composition-bundle files;
- recursive source-watch path normalization and debounce behavior, including Windows `\\` path separators;
- the `/api/studio/events` SSE boundary and browser `EventSource` hot-reload client;
- automatic reload preserving the current legal frame plus an unapplied props draft;
- build/evaluation/props/render failures surfacing through the Studio error overlay and console without crashing the workspace;
- render requests carrying the Studio-resolved JSON props through the existing renderer execution options;
- manual browser acceptance of selection, props, metadata, frame scrub/step/play, hot reload, render progress/output, responsive layout, and fullscreen.

### End-to-end tests

Using browser automation:

- start Studio;
- list compositions;
- switch composition;
- play/pause preview;
- scrub timeline;
- change props;
- surface validation errors through the Studio diagnostics overlay and recover with corrected props/source;
- hot reload composition source automatically without a manual browser refresh;
- preserve the current legal frame and unapplied props draft across safe source reloads;
- run `npm run verify:studio` on Windows with Chrome/Edge available and require the child Playground to execute through a repository alias containing spaces;
- render a current frame through the Studio UI and verify observable progress plus the generated output URL;
- deliberately resolve a missing storage-backed asset, verify the renderer failure reaches the Studio diagnostics overlay, then recover with valid props;
- keep frame-range/full-video execution coverage on the shared V2.7 renderer suite so Studio does not duplicate renderer semantics.

### V2.8 closure evidence

Windows 11 acceptance recorded for the completed Studio surface:

- repository `npm run verify`: **253/253 passed** with TypeScript build success;
- `release:check`: all **12** public packages release-ready;
- `release:pack`: successful through `@vexa-video/studio` and the CLI;
- real Chrome DevTools acceptance: three compositions loaded, composition switching and playback exercised, frame 50 plus an unapplied props draft preserved across automatic source reload, diagnostics recovered after invalid props, a current-frame render reached 100% with an output URL, and an intentional renderer failure surfaced through the Studio overlay;
- Windows acceptance launches the Playground through a temporary repository junction whose path contains spaces;
- Studio browser/runtime source remains free of Node/SDK/renderer/FFmpeg execution imports.

### Windows acceptance

Run from a repository path containing spaces to catch URL/path assumptions.

### Boundary test

Studio browser code must not directly execute FFmpeg or import Node process modules.

## V2.9 — Shapes, effects, transitions, fonts, captions

### Visual fixtures

Create Vexa-owned frames for:

- every shape primitive;
- representative effect combinations;
- transition start/mid/end;
- local font;
- missing font;
- caption sentence mode;
- active-word mode.

### Snapshot strategy

Snapshots should compare normalized images with documented tolerance for platform font/antialias differences.

Do not accept a high tolerance that hides timing, geometry, or color regressions.

### Font test

The renderer must wait for declared fonts before a frame is considered ready.

## V2.10 — Extended programmable media

Each optional integration must have:

- an isolated package/dependency boundary;
- success fixture;
- invalid/corrupt asset fixture;
- cleanup/unmount behavior;
- preview/render timing test;
- a dependency audit showing it did not become part of core packages.

For 3D/WebGL features, document GPU/browser skips explicitly.

## V2.11 — Browser rendering/WebCodecs

### Capability tests

Cover:

- WebCodecs unavailable;
- supported H.264 path;
- supported VP9/AV1 where runtime exposes them;
- unsupported codec response;
- audio support detection;
- cancellation;
- progress;
- output Blob metadata.

### Render inspection

Decode/inspect browser-generated output and validate:

- duration;
- dimensions;
- frame count tolerance;
- audio/video presence;
- playable container.

### Fallback

If browser rendering is unsupported, the public API must provide a typed reason suitable for choosing backend rendering.

## V2.12 — Templates and parameterized compositions

### Schema tests

Cover:

- required fields;
- optional fields;
- defaults;
- invalid type;
- invalid media;
- unknown property policy;
- dynamic duration/dimensions;
- JSON round trip.

### Variant tests

At least one template must render correctly in:

```text
16:9
9:16
1:1
```

without modifying its code between runs.

## V2.13 — Hosted/serverless composition rendering

### Contract tests

Use a fake/in-memory provider to cover:

- submit;
- get;
- progress;
- success;
- failure;
- cancellation;
- idempotency;
- missing bundle;
- invalid props;
- output reference.

### Worker integration

Run at least one composition through the existing Vexa job/worker path.

### Retry safety

A retried job must use deterministic output identity or an explicitly documented idempotent external write strategy.

## V2.14 — Agent/MCP/CLI workflows

### CLI acceptance

PowerShell commands must cover:

```powershell
npm run cli -- compositions
npm run cli -- render ProductDemo output.mp4
npm run cli -- still ProductDemo thumbnail.png --frame 120
```

When JSON mode is supported, validate machine-readable output and exit codes.

### Agent surface tests

Verify that agent/MCP operations:

- expose typed schemas;
- reject invalid props;
- do not accept arbitrary shell fragments as media commands;
- can start/inspect/cancel a render;
- surface typed failures.

## V2.15 — Visual regression and parity

### Required fixture classes

Maintain small deterministic fixtures for:

- pure text/shape animation;
- image composition;
- video composition;
- audio composition;
- transitions;
- captions;
- template props.

### Frame checkpoints

For each fixture choose meaningful checkpoints such as:

```text
start
pre-transition
transition midpoint
post-transition
final visible frame
```

### Runtime matrix

Compare where the capability exists:

```text
Studio preview
Player
Node renderer
Browser renderer
```

Pixel-perfect equality is not required across different browser/codec backends, but geometry, timing, content, and documented color/tolerance constraints must hold.

## V2.16 — Release acceptance

Before a 2.0.0 release candidate:

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run verify
npm run release:check
npm run release:pack
```

Then test clean installations from packed tarballs, not workspace links.

### Browser package audit

Inspect every browser package and fail release if runtime dependencies include:

```text
node:*
child_process
@vexa-video/sdk
@vexa-video/ffmpeg
Redis clients
```

### Required real acceptance

- Windows 11 local render;
- Windows 11 Studio;
- Windows Edge Player;
- Linux CI;
- Chromium browser tests;
- packed package install;
- at least one remote/job composition render;
- cancellation during active render;
- missing-asset failure;
- invalid-props failure.

### Documentation gate

Before closing Version 2:

- README matches shipped features;
- `ROADMAP.md` status is current;
- `architecture.md` reflects actual package/runtime boundaries;
- package READMEs list real exports only;
- release notes identify breaking changes;
- examples run against packed packages or validated workspaces;
- this file is updated with any acceptance command added during implementation.

## Per-stage evidence record

For each completed stage, record in the development PR/commit:

```text
Stage:
Commit:
npm run verify:
Windows acceptance:
Browser acceptance:
Real render fixture:
Known skips:
Documentation updated:
```

A skipped platform/hardware check must include the reason and the command needed to run it later.

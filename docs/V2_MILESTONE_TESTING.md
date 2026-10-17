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

### Shape contract tests

Before visual rendering is wired, cover deterministic shape normalization and serialization for rectangle, ellipse, line, polygon, star, path, and arc geometry. Validate finite coordinates, positive dimensions/radii/stroke widths, polygon/star point constraints, rounded-rectangle bounds, style defaults, invalid geometry failures, and stable SVG path conversion through both the normal core and browser-safe exports.

Cover shape-node normalization and render-graph participation through the programmable scene contract, browser-entry parity, typed rejection from direct `VideoProjectAst` lowering, and React mapping for generic shapes plus rectangle/ellipse/circle/line/polygon/star/path/arc convenience components.

### Renderer shape execution

Render a Vexa-owned shape showcase containing rectangle, ellipse, line, polygon, star, path, and arc primitives through the real Node renderer. Acceptance must prove renderer-owned SVG markup is rasterized to managed-workspace PNG assets before FFmpeg, valid frame/range/video outputs are produced, generated shape PNG files are cleaned after rendering, translation-only transforms preserve the shared scene semantics, and width/height/rotation/scale/anchor transforms fail with `RENDER_SHAPE_UNSUPPORTED` instead of being approximated. Renderer-owned SVG paint values must not permit external `url(...)` references.

### Effect contract tests

Cover every programmable effect kind through deterministic core normalization and serialization: blur, brightness, contrast, saturation, hue, grayscale, sepia, shadow, glow, noise, and vignette. Validate finite/ranged values, hue canonicalization, deterministic noise seeding, optional opacity/softness defaults, declaration-order preservation, immutable normalized chains, typed invalid-value failures, and parity through the normal and browser-safe core exports. Scene/React mapping and real render execution are separate acceptance slices.

### Effect scene and React authoring tests

Cover ordered effect attachment on visual scene leaves, normalization/defaulting through the shared effect contract, render-graph preservation, browser-entry serialization parity, React visual-component mapping, and typed rejection from direct `VideoProjectAst` lowering before renderer effect execution exists. Audio nodes and group/layer containers must remain effect-free at the type boundary. Shape rasterization must preserve effect metadata so the pre-execution boundary cannot silently discard requested effects.

### Effect execution tests

Cover project-level normalization for image/video effect chains, deterministic FFmpeg filter ordering, effect-before-opacity ordering, and the `PROGRAMMABLE_EFFECT_GRAPH` execution-plan marker. Real integration must render effect-bearing programmable image/video nodes and verify changed pixel/luminance output; the renderer shape fixture must prove a rasterized shape effect reaches the same FFmpeg path. Blur, brightness, contrast, saturation, hue, grayscale, sepia, deterministic noise, and vignette are accepted through the linear/raster path. Text/fill/solid/surface effects remain explicit unsupported paths until isolated visual-layer execution exists.

### Effect compositor execution tests

Cover shadow/glow branch construction, declaration-order preservation when compositor and linear effects are interleaved, deterministic transparent bounds padding, and position compensation for both explicit and centered placement. Real FFmpeg integration must verify visible shadow/glow pixels outside the source image bounds and the `PROGRAMMABLE_EFFECT_COMPOSITOR_GRAPH` marker. Unsafe compositor color tokens, excessive padding, effect-bearing advanced wipes, and spatial effects combined with non-normal blend modes must fail explicitly instead of bypassing or approximating the effect chain.

### Isolated text effect execution tests

Cover text effect normalization at the project boundary, programmable-scene text lowering, isolated transparent-layer construction, effect-before-opacity/fade ordering, text position/font-size keyframes, and `TEXT_ISOLATED_EFFECT_GRAPH`. Real FFmpeg integration must render effect-bearing text without modifying background pixels outside the text layer. Linear and compositor effects must reuse the shared effect compiler; effect-bearing text wipes/crossfades must fail explicitly until the advanced transition graph supports isolated text.

### Renderer fill and solid execution tests

Cover renderer materialization for every `solid` node plus effect-bearing `fill` nodes, managed-workspace SVG-to-PNG rasterization, generated-asset cleanup, preservation of timing/z/opacity/effects, reuse of the normal image/FFmpeg effect path, and explicit `RENDER_PRIMITIVE_UNSUPPORTED` failures for width/height/rotation/scale/anchor scene transforms. Keep plain representable fills on the project-background fast path. `surface` remains a serializable application-owned renderer contract and must stay fail-closed until a renderer registration/execution API is defined.

### Transition contract and authoring tests

Cover fade, slide, wipe, push, zoom, and circular iris transition normalization; positive frame durations; deterministic linear easing and left-direction defaults; explicit easing/direction overrides; immutable in/out transition pairs; stable serialization; typed invalid duration/easing/direction failures; and browser-entry parity. Scene normalization must reject a transition longer than its owning node, React visual components must preserve normalized transition intent, and renderer-owned shape/fill/solid raster substitution must carry transitions forward.

### Programmable fade execution tests

Cover scene-to-project preservation of the shared fade contract, frame-to-second conversion from the actual project FPS, fade-in/fade-out boundary expressions, all four easing modes, effect -> opacity -> transition ordering, isolated text execution, renderer-materialized primitives, and the `PROGRAMMABLE_TRANSITION_GRAPH` marker. Programmable visual transitions must not implicitly change audio fades.

### Programmable slide and wipe execution tests

Cover scene-to-project preservation of slide/wipe contracts, all four directions, in/out timing, frame-to-second conversion, easing, slide composition with authored x/y placement, wipe alpha ordering after effects and opacity, isolated text execution, and renderer-materialized shapes/fills/solids. Real FFmpeg integration must exercise both transition kinds and expose `PROGRAMMABLE_SLIDE_TRANSITION_GRAPH` plus `PROGRAMMABLE_WIPE_TRANSITION_GRAPH`. Non-normal blend-mode combinations remain explicit fail-closed paths rather than approximations.

### Programmable push execution tests

Cover paired full-canvas video push planning, all four directions, project-FPS frame conversion, all shared easing modes, exact overlap validation, source-trim boundaries, opposite foreground/background motion, concat assembly, and the `PROGRAMMABLE_PUSH_TRANSITION_GRAPH` marker. Push must remain fail-closed for image/text/scene-leaf usage, outgoing-only declarations, non-full-canvas clips, effects/blend/opacity/keyframe/spatial combinations, mismatched overlap, extra clip transitions, and unsupported multi-clip chains. Programmable push must not implicitly change audio fades.

### Programmable zoom execution tests

Cover scene-to-project zoom preservation, in/out frame-to-second timing, all shared easing modes, effect -> opacity -> zoom ordering, center-preserving positioned image/video geometry, isolated text centering, renderer-materialized primitives, and the `PROGRAMMABLE_ZOOM_TRANSITION_GRAPH` marker. Animated transform geometry and non-normal blend modes combined with zoom must fail explicitly instead of drifting or changing blend semantics. Real FFmpeg integration must exercise zoom on a renderer-rasterized visual.

### Programmable circular iris execution tests

Cover scene-to-project iris preservation, in/out frame-to-second timing, all shared easing modes, effect -> opacity -> iris ordering, layer-centered radial geometry, fully-closed/open boundary behavior, isolated text execution, renderer-materialized primitives, and the `PROGRAMMABLE_IRIS_TRANSITION_GRAPH` marker. Real FFmpeg integration must exercise iris on a renderer-rasterized visual. Non-normal blend-mode combinations must fail explicitly instead of bypassing the alpha mask.

### Programmable typography styling tests

Cover text-style normalization for stroke, shadow, horizontal alignment, and integer line spacing; immutable scene values; browser serialization parity; unchanged scene-to-project lowering; and deterministic invalid-value failures. FFmpeg planning must verify left/center/right anchor semantics, border/shadow drawtext options, multiline spacing, Windows font-path preservation, and parity between the direct text path and the isolated text path used by effects/transitions.

### Local-font readiness tests

Cover explicit absolute and relative local fonts, execution-root resolution, default-font injection, immutable project input, hidden/disabled text behavior, missing explicit fonts, missing platform defaults, and invalid `VEXA_VIDEO_FONT_FILE` overrides. `VideoProject` and the bundle-backed composition renderer must use the same resolver before FFmpeg planning; renderer failures must surface as `RENDER_FONT_UNAVAILABLE`. A successfully prepared renderer plan must contain an explicit `fontfile` rather than relying on FFmpeg/fontconfig fallback.

### Remote-font adapter tests

Cover browser-safe normalization/serialization of provider, family, optional weight, and normal/italic style; local/remote mutual exclusion; scene-to-project preservation; and direct FFmpeg/readiness rejection while the reference is unresolved. Bundle-render integration must exercise a provider adapter returning a real absolute local font path and verify the resulting FFmpeg graph contains `fontfile`. Missing providers, duplicate adapter providers, adapter failures, relative returned paths, unreadable returned files, and cancellation must fail deterministically through the renderer's typed boundaries. Provider/network SDKs must not become dependencies of core, React, or FFmpeg.

### Composition caption foundation tests

Cover deterministic `CaptionDocument` normalization on programmable scenes and `VideoProjectAst`, browser serialization parity, scene render-graph preservation, unchanged scene-to-project lowering, cue-end validation against explicit composition duration, and caption contribution to inferred project duration. Font readiness must resolve relative/absolute caption font files and inject the same controlled local default used by text clips without mutating the caller's project. Project FFmpeg planning must append the existing caption graph after the final composed visual stream, expose `CAPTION_DRAW_TEXT_GRAPH`, retain word-timing/animation optimization markers, and preserve captions through still/frame/range/video execution. Renderer rasterization of shapes/fills/solids must not discard scene captions.

### Active-word caption tests

Cover browser-safe `wordMode: "active-word"` normalization, optional `activeWordColor`, required word timings, deterministic sort order, and rejection of overlapping active-word intervals. FFmpeg compilation must emit one drawtext primitive per word interval, preserve the cue's font/size/outline/background/position and animation semantics, use the deterministic active-word color fallback when no override is supplied, omit the whole sentence from active-word rendering, and expose `ACTIVE_WORD_CAPTION_GRAPH` plus `WORD_LEVEL_TIMING_MODEL`. The real bundled shape-showcase render must exercise active-word captions after renderer-owned rasterization and succeed through frame/range/video planning. Do not accept approximate inline word placement based on character counts or guessed glyph widths.

### Speaker-aware caption tests

Cover trimmed `CaptionCue.speaker` identity, deterministic/sorted `speakerStyles`, duplicate normalized speaker ids, browser serialization parity, scene/project preservation, and rejection of speaker overrides for `fontFile` or `wordMode`. FFmpeg compilation must apply a matching speaker style after cue/template visual defaults, preserve cue-owned font/timing semantics, support speaker-specific `activeWordColor`, and expose `SPEAKER_AWARE_CAPTION_GRAPH` only when a mapped speaker is actually used. Automatic AI caption generation must preserve normalized transcription `segment.speaker` values and caller-provided speaker styles. Real renderer integration must exercise the same speaker-aware active-word fixture after shape/primitive rasterization.

### Visual fixtures

Create Vexa-owned frames for:

- every shape primitive;
- representative effect combinations;
- transition start/mid/end;
- local font;
- missing font;
- caption sentence mode;
- active-word mode;
- speaker-aware caption style.

### Snapshot strategy

Snapshots should compare normalized images with documented tolerance for platform font/antialias differences.

Do not accept a high tolerance that hides timing, geometry, or color regressions.

### Font test

The renderer must wait for declared fonts before a frame is considered ready.

## V2.10 — Extended programmable media

### Surface renderer adapter foundation tests

Cover renderer-id normalization, duplicate adapters, missing adapters, ambiguous static+frame adapters, adapter exceptions, empty/malformed SVG output, valid PNG-byte output, corrupt/truncated PNG rejection, APNG rejection on the static path, cancellation, translation-only transform enforcement, and managed-workspace cleanup after success or failure. A real bundled surface fixture must render an inactive frame, an active SVG-backed frame, a PNG-result frame, and a video range while preserving authored timing plus effects/transitions after surface-to-image substitution. Frame-aware coverage must render the complete local frame sequence with exact local/absolute frame contexts, reject a corrupt animation frame before the final render, materialize an alpha-capable managed video intermediary, preserve transition execution after surface-to-video substitution, compare a single-frame render with the same frame produced through the frame-range path, and verify frame PNGs plus the temporary animation input are removed after render completion. Audit `@vexa-video/core` and the normal `@vexa-video/sdk` dependency graphs so renderer/integration dependencies do not leak into those packages.

### GIF integration tests

Cover logical source-id resolution, relative host-path resolution, invalid surface/source options, missing/corrupt/non-GIF inputs, deterministic first/second frame differences, loop wrap, non-loop final-frame hold, RGBA PNG results, cancellation, private extraction-workspace cleanup, and a dependency audit proving `@vexa-video/gif` does not enter core or the normal SDK. The generic frame-aware renderer tests remain the end-to-end timing/effects/transitions acceptance path and also verify adapter-thrown process timeouts retain `RENDER_TIMEOUT`.

### Waveform integration tests

Cover logical source-id resolution, relative host-path resolution, invalid adapter/surface styling, missing/corrupt/audio-less inputs, deterministic PNG output, per-surface color/background overrides, cancellation, private raster-workspace cleanup, and a dependency audit proving `@vexa-video/waveform` does not enter core or the normal SDK. The generic static surface renderer tests remain the end-to-end timing/effects/transitions acceptance path.

### Sound-effect catalog tests

Cover stable logical-id ordering, deterministic generated audio asset IDs, static and storage-backed asset sources, per-effect preload/playback defaults, per-instance playback overrides, repeated use of one asset without duplicate source definitions, invalid/duplicate normalized IDs, missing-effect lookup, invalid frame/rate/volume values, and a dependency audit proving `@vexa-video/sound-effects` depends only on `@vexa-video/core`. Existing programmable-scene/project tests remain the execution acceptance path because the package emits normal audio assets/nodes rather than introducing another renderer.

Each optional integration must have:

- an isolated package/dependency boundary;
- success fixture;
- invalid/corrupt asset fixture;
- cleanup/unmount behavior;
- preview/render timing test;
- a dependency audit showing it did not become part of core packages.

For 3D/WebGL features, document GPU/browser skips explicitly.

### Completion gate

V2.10 closes when the generic surface-adapter acceptance path, GIF integration, waveform integration, sound-effect catalog coverage, dependency-boundary audits, typecheck, full test suite, build, and repository guards all pass together. The Windows closure run passed the focused sound-effect suite, the complete 331-test suite, `npm run typecheck`, `npm run build`, `npm run verify`, `git diff --check`, the public-README terminology guard, and the repository-wide prohibited-dependency-reference guard. Future Lottie, Rive, Three.js, or custom canvas/WebGL packages remain additive follow-ons rather than prerequisites for V2.10 completion.

## V2.11 — Browser rendering/WebCodecs

### Capability tests

The first V2.11 slice covers capability normalization and deterministic browser/backend planning independently of frame capture and muxing. The probe runtime is injectable so non-browser unit tests can exercise the public contract without pretending that Node provides browser encoder APIs.

The second slice adds injectable video-encoder execution coverage for deterministic frame timestamps/keyframes, encoded chunk copying, frame closure, bounded-queue flushes, progress completion, cancellation/reset, and frame-render failure mapping. These tests validate the browser execution contract without misrepresenting raw encoded chunks as a playable container.

The third slice adds deterministic WebM muxing tests for EBML/container identity, VP9/AV1 codec IDs, Blob type/size metadata, browser File creation, and keyframe-first/monotonic packet validation.

The fourth slice adds H.264/MP4 coverage for WebCodecs decoder-config preservation, owned AVC codec-private bytes, explicit AVC/realtime encoder configuration, fragmented-MP4 box identity (`ftyp`/`moov`/`avcC`/`moof`/`mdat`), `video/mp4` Blob metadata, and typed refusal when required decoder metadata is absent or invalid.

The fifth slice adds injectable `AudioEncoder` coverage for deterministic sample-window timing, AAC/Opus encoder configuration, encoded-chunk ownership, decoder-config copying, AudioData cleanup, progress completion, cancellation/reset, and typed render/encode failures. Container tests remain video-only until the following audio-muxing slice.

The sixth slice adds A/V container coverage for AAC `mp4a`/`esds` tracks in fragmented MP4, Opus `A_OPUS`/`OpusHead` tracks in WebM, zero-origin and monotonic stream validation, duration-skew rejection, codec/container mismatch rejection, and Blob metadata for combined audio/video output.

The seventh slice adds capture-adapter coverage for Canvas dimension matching, deterministic per-frame paint hooks, DOM SVG/`foreignObject` snapshot construction, reusable raster canvases, immediate ImageBitmap cleanup, stable dimensions, cancellation, and fail-closed unsupported DOM surfaces.

The closure acceptance test composes the Canvas adapter with injected `VideoFrame`/`VideoEncoder` execution and the real WebM muxer, covering the capture-to-encoded-chunk-to-container handoff in one deterministic test without pretending that Node exposes native browser codecs.

Cover:

- WebCodecs unavailable;
- supported H.264 path;
- supported VP9/AV1 where runtime exposes them;
- unsupported codec response;
- audio support detection;
- cancellation;
- progress;
- output Blob metadata.

### Real-browser render inspection

For browser/release acceptance on a runtime that actually exposes the selected WebCodecs, decode/inspect generated output and validate:

- duration;
- dimensions;
- frame count tolerance;
- audio/video presence;
- playable container.

### Fallback

If browser rendering is unsupported, the public API must provide a typed reason suitable for choosing backend rendering.

## V2.12 — Templates and parameterized compositions

The first slice covers deterministic schema normalization, required/optional object properties, default-prop validation at definition time, runtime validation before custom validators, nested array/object paths, numeric/string bounds, enum values, unknown-property rejection, frozen schema metadata, and deterministic JSON serialization. The second slice adds deterministic template metadata normalization, JSON-safe catalog entries, stable id ordering, duplicate rejection, atomic bulk registration, and missing-template errors while preserving the wrapped composition identity. The third slice adds sorted/frozen variant normalization, JSON-safe variant props, duplicate-id rejection, normal composition/schema validation during variant resolution, and fail-closed aspect-ratio verification. The fourth slice adds deterministic JSON-safe invocation normalization plus catalog resolution that merges variant presets before caller prop overrides and preserves the normal schema/custom-validation/dynamic-metadata path. The fifth slice reuses `ProgrammableSceneAsset` normalization for deterministic reusable template asset descriptors and catalog discovery.

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

without modifying its code between runs. Variant acceptance must resolve all three through one composition definition and its normal dynamic-metadata path.

### Invocation tests

Cover:

- deterministic JSON round trip for `templateId`, optional `variantId`, and caller props;
- catalog lookup and missing-template/variant failures;
- variant preset props merged before caller overrides;
- input-schema/custom validation after invocation merging;
- dynamic metadata and aspect-ratio verification after the final props resolve;
- rejection of non-JSON values and non-finite numbers.

### Reusable asset tests

Cover:

- static and storage-backed image/video/audio descriptors through the existing scene asset contract;
- deterministic asset id ordering and frozen JSON-safe catalog metadata;
- existing preload defaults;
- duplicate asset-id rejection;
- static HTTP URLs rejected in favor of the storage/http source boundary;
- no template-specific filesystem, fetch, or media-resolution path.

### V2.12 closure evidence

Windows 11 acceptance for the completed template/parameterization stage:

- focused template suite: **9/9 passed**;
- focused programmable-scene suite: **26/26 passed**;
- focused programmable-composition suite: **12/12 passed**;
- repository `npm test`: **365/365 passed**;
- `npm run typecheck`, `npm run build`, and `npm run verify`: passed;
- the `npm run verify` test phase repeated **365/365 passed** before the final TypeScript build;
- root `README.md` `Milestone` guard: no matches;
- repository prohibited-runtime guard: no matches;
- `git diff --check`: clean.

## V2.13 — Hosted/serverless composition rendering

The first slice tests request normalization independently of worker execution: bundle/composition/output identities are required, input props remain deterministic JSON, frame/range bounds fail closed, video ranges require both endpoints, idempotency is preserved, and `HostedRenderer.submitComposition()` delegates the normalized request through the existing adapter.

The second slice tests the real worker boundary without requiring a cloud vendor: an in-memory `JobQueue` receives `composition.render`, injected resolvers map provider bundle/output identities into local worker paths, the existing renderer surface receives still/frame/range/video options, renderer progress becomes job progress, and renderer cancellation maps back to the job's cancelled state. The registration contract is shared with distributed workers, provider callbacks are validated eagerly, and no second queue implementation is introduced.

The third slice covers remote-output publication through provider-neutral seams: single-file renders upload through the existing `Storage` adapter boundary, the caller destination/artifact id remain stable, publication uses overwrite-safe retry behavior and job cancellation, frame-range directories use an explicit publisher callback, returned artifact metadata is normalized, and a request with `output.destination` fails closed when no publisher is configured.

The closure slice adds a forced transient publication failure with `maxAttempts: 2`. Acceptance requires the second attempt to reuse the same provider-resolved local output, caller artifact id, remote destination, and overwrite-enabled render/upload behavior before succeeding. This is the concrete retry/idempotency proof for external artifact writes.

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

A retried job must use deterministic output identity or an explicitly documented idempotent external write strategy. V2.13 closure verifies this directly by failing the first artifact upload and asserting attempt 2 uses the same artifact id, local output, remote destination, and overwrite-safe publication.

### V2.13 closure acceptance

Before committing the closure, run the focused hosted worker, SDK hosted, and core hosted suites; repository typecheck/test/build/verify; the root README guard; the repository prohibited-runtime guard; and `git diff --check`. The hosted worker suite must include request-to-render mapping, cancellation, resolver validation, missing-bundle resolution failure, single-file publication, frame-range publication, fail-closed missing publication, and retry-safe publication.

## V2.14 — Agent/MCP/CLI workflows

The first slice must verify the real CLI against the checked-in TypeScript composition fixture rather than only parser mocks. Acceptance covers deterministic `vexa compositions` JSON output, persisted `vexa bundle` manifest output, explicit project-root/output/mode/source-map options, and preservation of the existing media-file `render` command semantics. The monorepo root does not contain the normal project default `src/video.tsx`, so repository acceptance passes the fixture entry explicitly and writes generated output under the ignored `.tmp` directory.

```powershell
npm run cli -- compositions `
  .\packages\bundler\test\fixtures\basic\entry.ts `
  --json

npm run cli -- bundle `
  .\packages\bundler\test\fixtures\basic\entry.ts `
  --out-dir .\.tmp\v2.14-cli-bundle `
  --json
```

The second slice adds real renderer-backed CLI acceptance. Automated tests bundle the checked-in executable renderer fixture, render a two-frame MP4 subrange, render a true still PNG, and render a selected video frame to WebP. They assert machine-readable results, real non-empty artifacts, and terminal progress while keeping media-file `render` as the fallback for existing paths, URLs, and filename-like sources.

Repository-level PowerShell acceptance uses the executable fixture explicitly. The repository `npm run cli --` script passes through npm and `cmd.exe` on Windows, which can strip the inner quotes from inline JSON before Node receives `--props`. Commands without structured JSON may keep using the npm wrapper; `--props` acceptance invokes the already-built CLI entry point directly so the JSON reaches Vexa unchanged.

```powershell
npm run cli -- bundle `
  .\packages\renderer\test\fixtures\acceptance\entry.tsx `
  --out-dir .\.tmp\v2.14-cli-render-bundle `
  --source-map none `
  --json

node .\packages\cli\dist\bin.js render product-demo .\.tmp\v2.14-product-demo.mp4 `
  --manifest .\.tmp\v2.14-cli-render-bundle\vexa.bundle.json `
  --start-frame 0 `
  --end-frame 30 `
  --props '{"background":"#223344"}' `
  --json

node .\packages\cli\dist\bin.js still product-demo .\.tmp\v2.14-product-demo-frame.png `
  --manifest .\.tmp\v2.14-cli-render-bundle\vexa.bundle.json `
  --frame 15 `
  --props '{"background":"#334455"}' `
  --json

node .\packages\cli\dist\bin.js still social-square .\.tmp\v2.14-social-square.png `
  --manifest .\.tmp\v2.14-cli-render-bundle\vexa.bundle.json `
  --props '{"background":"#445566"}' `
  --json
```

The third slice adds renderer-level inspection/resolution acceptance and machine-readable CLI coverage. Tests must prove default-prop and schema discovery, valid prop merging, schema rejection, custom `validateProps` rejection, dynamic metadata resolution, typed missing-composition errors, and fail-closed manifest/executable metadata mismatches. CLI acceptance must cover `vexa inspect`, `vexa validate`, and typed JSON failures without adding an MCP-specific schema or validation path.

```powershell
npm run cli -- inspect product-demo --manifest .\.tmp\v2.14-cli-render-bundle\vexa.bundle.json --json
node .\packages\cli\dist\bin.js validate product-demo --manifest .\.tmp\v2.14-cli-render-bundle\vexa.bundle.json --props '{"background":"#223344","fps":24}' --json
```

The fourth slice introduces the transport-neutral `@vexa-video/mcp` tool adapter. Focused tests must prove a stable six-tool catalog with strict JSON-object input schemas, renderer-backed list/inspect/validate delegation, preservation of renderer validation error codes, `HostedRenderer`-compatible start/get/cancel delegation, rejection of unsupported command/shell fields before hosted submission, and typed failures for malformed or unknown tool calls.

The fifth/closure slice adds official MCP protocol and stdio acceptance without changing that adapter. An in-memory MCP client/server pair must verify `tools/list`, successful `tools/call`, and typed Vexa validation failures returned with `isError: true`. A second test must spawn the Vexa stdio fixture through `StdioClientTransport`, list the same six tools, and execute a render-state call across real stdin/stdout. Both paths must prove the protocol layer delegates to `VexaMcpCompositionTools` rather than adding another schema/validator or arbitrary command surface.

```powershell
node --import tsx --test "packages/mcp/**/*.test.ts"
```

### V2.14 closure acceptance

Before committing the closure, require the focused MCP suite, repository typecheck/test/build/verify, release check/pack, the root README guard, the prohibited-runtime guard, and `git diff --check`. The focused MCP suite should contain the six transport-neutral operation tests plus protocol and spawned-stdio acceptance.

### CLI acceptance

PowerShell commands must cover:

```powershell
npm run cli -- compositions
npm run cli -- inspect ProductDemo --json
node .\packages\cli\dist\bin.js validate ProductDemo --props '{"headline":"Launch"}' --json
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

The first slice establishes the reusable Node-side frame comparison surface before cross-runtime parity is layered on top. Focused tests must cover exact PNG equality, per-channel tolerance, changed-pixel-ratio tolerance, dimension mismatch, malformed/unsupported PNG rejection, typed assertion failures, deterministic checkpoint naming/order, unsafe/duplicate checkpoint rejection, and a real renderer round trip. The real acceptance must bundle the checked-in executable renderer fixture, render named PNG checkpoints through `VexaCompositionRenderer`, prove an unchanged frame is byte-visual-equivalent on repeat, and prove a changed background is detected as a visual mismatch.

```powershell
node --import tsx --test "packages/test/**/*.test.ts"
```

The PNG comparator intentionally supports the ordinary 8-bit, non-interlaced grayscale/RGB/grayscale-alpha/RGBA output classes used by Vexa's renderer acceptance. Unsupported bit depths, palette/interlaced images, malformed compressed data, and dimension mismatches must fail closed rather than being silently converted with platform-specific image libraries.

The second slice must add reviewed checked-in baselines rather than only repeat-render comparisons. Acceptance uses a Vexa-owned, font-free 64×36 wipe composition with one transition-bearing fill and exactly these checkpoints: `start` frame 0, `pre-transition` frame 1, `transition-midpoint` frame 4, `post-transition` frame 6, and `final-visible` frame 10. Baselines must prove the pre-transition image matches start, midpoint differs from both endpoints, and post-transition matches the final visible frame. The real renderer must match all five through `assertVisualCheckpointBaselines()`. Keep `channelTolerance` narrow and permit at most one transition-boundary column of changed pixels; do not widen tolerance to hide incorrect timing, geometry, or colors.

The third slice must reuse that exact reviewed manifest for runtime timing parity. The manifest carries `width`, `height`, `fps`, and `durationInFrames`; Node renderer outputs must report matching metadata for all five checkpoint renders. Player and Studio must seek those same named frames, while `encodeWebVideoFrames()` must expose matching selected `VexaWebVideoFrameContext` values during its normal frame loop. `assertRuntimeCheckpointParity()` must require all five observations for `player`, `studio`, and `browser-renderer`, and compare exact `frame`, dimensions, fps, duration, `timestampUs`, and `durationUs`. Missing observations and one-microsecond timing drift must fail with typed runtime/checkpoint/field diagnostics. This is semantic runtime parity, not simulated browser-pixel parity; do not claim browser pixels match unless an actual browser capture is compared.

The fourth slice must capture actual Studio pixels for that same wipe fixture. `programmableTransitionVisibility()` must reproduce the FFmpeg transition progress/easing contract for in/out edges, and Studio must use it to apply deterministic wipe geometry without importing Node execution code. `npm run verify:studio` must run an installed Chrome/Edge/Chromium at device scale factor 1, pin `#studioSceneSurface` to exactly 64×36 with presentation borders/shadows removed, seek all five reviewed checkpoints, capture each surface through the DevTools screenshot API, and compare every PNG with the checked-in Node baseline using the manifest's existing tolerance. A browser mismatch may consume at most the documented one-column boundary budget; never substitute a Node-rendered image for the browser capture or widen tolerance to hide incorrect preview timing, geometry, or colors.

The fifth slice must cover every remaining deterministic fixture class through one Vexa-owned matrix: shape/text timing, image, video, audio, captions, and parameterized props. Generate tiny media inputs through the repository's configured FFmpeg/ffprobe boundary, inject them through `resolvedAssets`, and keep the fixture at 64×36, 10fps, 12 frames (1.2s). Image/video assertions must compare meaningful source/render checkpoints, caption and prop checkpoints must visibly differ when their authored state changes, and the audio composition must render a real MP4 containing both video and audio streams. `assertMediaDurationSync()` must compare each stream with the frame-derived 1.2s duration and enforce no more than 50ms duration drift or A/V skew.

### V2.15 closure acceptance

The closure audit maps each requirement to an existing acceptance surface rather than adding another runtime:

- `@vexa-video/test` owns PNG decoding/comparison, selected-frame rendering, reviewed-baseline assertions, runtime timing comparison, and media duration/A/V-sync comparison;
- the reviewed wipe fixture covers transition geometry/timing through Node-rendered PNG baselines;
- Node renderer metadata is checked against the reviewed manifest for every wipe checkpoint;
- Player, Studio, and browser renderer share exact frame, dimensions, fps, duration, `timestampUs`, and `durationUs` observations;
- `npm run verify:studio` supplies the real Chromium/Edge Studio pixel path against the same reviewed Node baselines;
- the deterministic fixture matrix covers shape/text, image, video, audio, captions, and parameterized props through the existing renderer plus `resolvedAssets`;
- the audio-bearing fixture probes both video and audio stream durations against the frame-derived 1.2s timeline with a 50ms duration/skew budget;
- `@vexa-video/test` remains Node-only, so browser packages do not acquire Node/FFmpeg test dependencies.

Before committing V2.15 closure, run:

```powershell
node --import tsx --test "packages/test/**/*.test.ts"
npm run verify:studio
npm run format:check
npm run typecheck
npm test
npm run build
npm run verify
npm run release:check
npm run release:pack
rg -n "Milestone" README.md
$prohibitedRuntime = "remo" + "tion"
rg -n -i $prohibitedRuntime . -g "!node_modules/**" -g "!dist/**"
git diff --check
```

The focused `@vexa-video/test` closure suite contains 16 tests. V2.15 may be marked complete only when that focused suite and the repository-wide gates above are green together.

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

**Status:** Complete

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
npm run release:install-check
npm run release:ffmpeg-check
npm run release:trusted-publish-check
```

`release:install-check` is the clean-install gate: it packs all eighteen public workspaces into real tarballs, installs those tarballs into an isolated temporary consumer instead of using workspace links, verifies synchronized installed versions plus exported runtime/type and bin files, rejects symlinked package roots, imports every shipped runtime export, and compiles an isolated Angular consumer against the installed `@vexa-video/angular` package with Angular's `ngc` compiler. The Angular acceptance also verifies the packed package remains ESM-only, side-effect-free, exposes explicit declaration/runtime export targets, and keeps Angular/RxJS as peer dependencies. Set `VEXA_RELEASE_KEEP_TEMP=1` only when diagnosing a failed local release check and remove the preserved temporary workspace afterward.

The packed-install gate is required by the protected release workflow. V2.16 cross-platform acceptance is centralized in `.github/workflows/release-acceptance.yml` so normal CI and tagged/publish releases cannot drift. The repository matrix runs Node 24.21 verification and packed-install acceptance on Ubuntu, Windows, and macOS plus a Node 26 Ubuntu compatibility lane. The browser matrix runs the existing Studio/CDP acceptance in Ubuntu Chrome, Windows Chrome, Windows Edge, and macOS Chrome. `VEXA_STUDIO_BROWSER_FAMILY` pins the expected browser family and the verifier records the concrete browser version in its JSON summary. Cross-platform/browser closure on commit `cd6076f14031d6d63e34737f89cf774fb3ba5049` passed all eight lanes in CI run `38870137968`.

The macOS lanes install Homebrew `ffmpeg-full`, prepend its keg-only `bin` directory to `PATH`, and assert that the `drawtext` filter is available before acceptance. Vexa's text/caption rendering requires that FFmpeg capability, so a reduced FFmpeg build must fail during environment setup rather than appear as a renderer regression.

HLS packaging executes FFmpeg from the prepared package directory and uses relative `v%v/...` variant paths. This keeps generated playlist URIs portable and avoids FFmpeg's Windows cross-drive directory-creation failure when a caller's temporary output directory is on a different drive from the process that invoked Vexa. Studio browser acceptance also waits for the props editor to enter the `draft` state before applying negative-render props, verifies frame stepping relative to the actual paused frame, requires resolved props state to be rendered after composition evaluation, and waits for the specific source revision to return to `Watching` + `Bundle ready` before rendering. Studio prevents bundle rebuilds and composition renders from overlapping so a hot reload cannot remove `vexa.bundle.json` while the renderer is consuming it.

A release may not publish unless every reusable-workflow matrix lane succeeds. Windows Edge Studio acceptance exercises the embedded Player play/pause/frame-step contract as part of the same real browser session, satisfying the Edge Player requirement without a second browser automation stack.

V2.16.3 closed on commit `39ead3e6eb2480f141d8d202c7ea93d58a662a36` with all eight release lanes green. The packed-install lanes on Ubuntu, Windows, and macOS compile an isolated Angular consumer with `types: []`, so browser-facing declaration leaks such as `NodeJS.*` fail before publication.

`release:trusted-publish-check` runs in static mode through `release:check`, validating the canonical repository URL, `release.yml`, `id-token: write`, `npm-release` environment, registry URL, and tokenless publish contract. The protected workflow reruns it with `VEXA_TRUSTED_PUBLISH_RUNTIME=1`, which additionally requires the live GitHub OIDC request variables and exact repository/workflow/environment identity. `release:publish` repeats those runtime requirements and refuses non-tag or token-backed publication. `release:ffmpeg-check` requires FFmpeg and ffprobe 6.1+ plus `drawtext`, `libx264`, and AAC; it runs across every release-acceptance OS/browser lane and again before protected publication.

Release dry-run `38913399579` on commit `875dce3442ea4fb0c384915bd3b5c106de1b4d02` passed seven of eight reusable acceptance lanes. The macOS Chrome lane completed its Studio functional assertions and FFmpeg baseline, then failed only while deleting Chrome's temporary profile with `ENOTEMPTY`. The Studio acceptance harness therefore must wait for browser/server child termination and tolerate bounded transient recursive-removal races before V2.16.4 can close; a replacement non-publishing release run must reach and pass the live `npm-release` OIDC preflight.

V2.16.4 closed on commit `3df98475d01e730fd78fa6daa1bb6f084f652c95`. Release dry-run `38925542900` passed all eight reusable acceptance lanes plus the protected `verify-and-release` job. The live `npm-release` OIDC/trusted-publishing preflight, FFmpeg baseline, repository verification, metadata validation, package dry-run, and clean packed-package install all passed; npm publication and GitHub release creation were correctly skipped with `publish=false`. An earlier live run exposed `setup-node@v4` injecting a placeholder `NODE_AUTH_TOKEN`; the tokenless guard correctly rejected it, and the protected release job moved to `checkout@v7` / `setup-node@v7` rather than weakening the guard.

V2.16.5 hardens CI runtime determinism by moving the reusable repository/browser matrix to `checkout@v7` / `setup-node@v7` and pinning all Linux acceptance plus protected-release jobs to `ubuntu-24.04`. The Node 26 compatibility lane stays on that same OS so a Node compatibility result cannot be conflated with GitHub's `ubuntu-latest` image migration.

V2.16.5 closed on commit `579d81e03724f8d61b55936bc7c92bee9ea5c281`. Final non-publishing release run `38929706513` passed all eight reusable acceptance lanes and `verify-and-release`; the live trusted-publishing/OIDC preflight, FFmpeg baseline, repository verification, metadata validation, package dry-run, and clean packed-package install passed, while npm publication and GitHub release creation were correctly skipped.

The exact `2.0.0` release-cut commit must repeat the local release gates, all eight PR acceptance lanes, and a `publish=false` `release.yml` run before PR #1 may merge. That post-cut validation proves the synchronized manifests and npm-generated lockfile without changing the already-closed V2.16 implementation surface.

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

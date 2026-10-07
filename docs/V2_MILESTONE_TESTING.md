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

## Clean-room validation rule

Tests and fixtures for Remotion-inspired capabilities must be Vexa-owned.

Do not copy:

- Remotion test source;
- snapshot images;
- example projects;
- media fixtures;
- internal package behavior that is not part of the capability being independently implemented.

The purpose of parity testing is to verify Vexa's documented behavior, not byte-for-byte compatibility with Remotion.

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

**Status:** Next

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

Generate a deterministic vector of animation results in Node and browser. Values must match within documented floating-point tolerance.

### Repeatability

Run the same test vector multiple times and ensure output is identical.

## V2.3 — Scene graph and media elements

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

### End-to-end tests

Using browser automation:

- start Studio;
- list compositions;
- switch composition;
- play/pause preview;
- scrub timeline;
- change props;
- surface validation error;
- hot reload source;
- preserve frame where expected;
- start render;
- show progress;
- expose render failure.

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

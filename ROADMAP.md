# Vexa Video SDK Roadmap

This document tracks product capabilities and the next engineering priorities for Vexa Video SDK. It is intentionally concise: implementation details belong in the architecture and testing guides.

## Status legend

| Status | Meaning |
| --- | --- |
| **Complete** | Implemented with automated coverage and integrated into the public SDK surface |
| **Validation** | Implemented; local/browser/platform acceptance is still being completed |
| **Next** | Highest-priority planned work |
| **Planned** | Important future work without an active implementation commitment |

## Current product baseline

| Area | Status | Highlights |
| --- | --- | --- |
| Repository foundation | **Complete** | npm workspaces, TypeScript project references, CI, contribution/security policy |
| Media probing | **Complete** | ffprobe normalization, typed metadata, timeouts/cancellation |
| Video editing | **Complete** | trim, resize, crop, rotate, thumbnail, audio extraction, export |
| Execution planning | **Complete** | serializable pipeline AST, deterministic plans, stream copy, codec/container validation |
| Timeline composition | **Complete** | video/audio/image/text tracks, keyframes, transitions, blend modes, z-order |
| Audio engine | **Complete** | normalization, fades, channel mapping, ducking, silence detection, waveforms |
| Captions | **Complete** | SRT/WebVTT/ASS, styles/templates, word timings, burn-in |
| Adaptive streaming | **Complete** | HLS, DASH, rendition ladders, aligned segments, preview sprites |
| Hardware acceleration | **Complete** | NVENC, Quick Sync, AMF, VideoToolbox, runtime verification, CPU fallback |
| Storage and remote media | **Complete** | safe HTTPS staging, workspaces, S3/GCS/Azure adapter hooks |
| Jobs and workers | **Complete** | local pool, retries, idempotency, cancellation, Redis distributed transport |
| Angular browser package | **Complete** | DI providers, uploads, render jobs, Signals, RxJS, replaceable transport |
| Runnable Angular demo | **Validation** | browser client + Node render API; final dependency/browser acceptance remains part of local verification |
| Plugin system | **Complete** | lifecycle, package loading, custom operations/storage/jobs/backends/encoders |
| AI extension | **Validation** | transcription adapters, automatic captions, scenes, silence removal, smart reframe, highlights |
| Ecosystem and distribution | **Validation** | CLI, REST/Docker templates, React/Vue examples, editor foundation, hosted-render contract, release tooling |

## Architecture commitments

These constraints are treated as product guarantees unless intentionally changed through a documented API revision:

1. `@vexa-video/core` remains backend-neutral and serializable where practical.
2. `@vexa-video/sdk` remains a Node.js execution package.
3. Browser packages must not import Node execution code, FFmpeg wrappers, Redis clients, or `node:*` runtime modules.
4. FFmpeg processes are launched with explicit argument arrays rather than shell-concatenated command strings.
5. Execution plans remain inspectable before expensive media work begins.
6. Windows, Linux, and macOS behavior should be validated explicitly when paths, fonts, manifests, or hardware are involved.
7. New capabilities must update public documentation and acceptance coverage in the same change.

## Plugin and AI extension layers

The plugin host is implemented and keeps extension points explicit: lifecycle-managed custom video operations, storage adapters, job handlers, render backends, encoder providers, package manifests, and browser-safe metadata catalogs.

The optional `@vexa-video/ai` package builds on that modular direction without adding model/provider dependencies to deterministic media packages. Its current scope includes:

- provider-neutral transcription adapters and normalized word/segment timing;
- automatic `CaptionDocument` generation;
- built-in FFmpeg scene-boundary detection;
- silence-removal planning/rendering through the existing audio + timeline APIs;
- subject-tracking hooks and smart-reframe project generation;
- highlight-extraction hooks and highlight-project generation.

The runnable Angular demo remains a separate validation item; AI/provider adapters do not change the browser/Node runtime boundary.

## Ecosystem and distribution

The ecosystem/distribution implementation is in place: CLI and REST surfaces, Docker worker recipe, React/Vue examples, framework-neutral timeline-editor state, hosted-render contracts, synchronized package metadata, and controlled release automation. Public registry publication and clean-install tarball verification remain operator/release validation items.

## Package and release readiness

Release preparation now includes public package metadata, explicit exports/files, package READMEs, semantic-versioning policy, npm provenance workflow, dry-run package validation, and synchronized package versions. Remaining release validation items are:

- complete clean-install tests from packed tarballs, not only workspace links;
- verify Angular Package Format expectations in the final public publishing environment;
- configure the protected `npm-release` environment/trusted publisher for the canonical repository;
- document the final supported FFmpeg baseline and platform support matrix for the first public release.

## Version 2 — programmable video creation

Version 2 is the active product direction. It adds a Vexa-native code-defined composition layer built directly on the repository's existing deterministic media, timeline, browser-safety, storage, job, and rendering contracts.

The planned sequence is:

| Stage | Status | Focus |
| --- | --- | --- |
| V2.1 | **Complete** | Composition contracts, registry, stills, dynamic metadata |
| V2.2 | **Complete** | Frame/time semantics, interpolation, easing, springs, loops, deterministic random |
| V2.3 | **Complete** | Composition scene graph and media elements |
| V2.4 | **Complete** | Browser-safe React authoring adapter |
| V2.5 | **Complete** | Browser player and framework-neutral playback state |
| V2.6 | **Complete** | TypeScript/TSX bundling and composition discovery |
| V2.7 | **Complete** | Node composition/still renderer using existing Vexa execution paths |
| V2.8 | **Complete** | Local Vexa Studio development environment |
| V2.9 | **Complete** | Shapes, effects, transitions, fonts, and composition captions; deterministic typography, local/remote font readiness, caption cue rendering, active-word timing, and speaker-aware style overrides execute through the shared project/FFmpeg graph |
| V2.10 | **Complete** | Extended programmable-media boundary plus concrete GIF, waveform, and reusable sound-effect integrations, all preserving dependency separation from core/normal SDK execution |
| V2.11 | **Complete** | Browser/WebCodecs rendering with capability/fallback planning, video plus AAC/Opus audio encoding, H.264/AAC MP4 plus VP9-or-AV1/Opus WebM A/V muxing, Canvas/serializable-DOM capture adapters, Blob/File output, progress, cancellation, and typed backend fallback |
| V2.12 | **Complete** | Parameterized templates and validated input schemas; browser-safe schemas, deterministic template discovery, validated 16:9/9:16/1:1 variants, reusable scene/storage asset descriptors, and JSON-safe service/agent invocation resolve through the same composition and asset contracts |
| V2.13 | **Complete** | Hosted/serverless composition rendering; typed requests, existing job-worker execution, deterministic retry-safe artifact publication, progress/cancellation, and provider-neutral deployment boundaries all reuse the normal renderer, job, and Storage contracts |
| V2.14 | **Complete** | Agent/MCP/CLI composition workflows; CLI, typed agent operations, official MCP protocol handling, and stdio transport all reuse the existing bundler, renderer, and hosted-render contracts |
| V2.15 | **Complete** | Frame-level visual regression with reviewed wipe baselines, exact runtime timing parity, real Chromium Studio pixel parity, deterministic shape/image/video/audio/caption/props fixtures, and frame-derived A/V duration/sync assertions |
| V2.16 | **Planned** | Version 2 release hardening |

V2.1 through V2.7 are complete on the Version 2 branch. V2.7 bundle-backed execution resolves executable compositions and dynamic metadata, materializes still/single-frame images and bounded frame ranges, encodes exact exclusive-end MP4/WebM ranges, exposes progress/cancellation/timeouts/hardware selection, and resolves storage-backed scene assets through managed workspaces. Windows acceptance verified a 1920x1080 H.264 render at 30fps with exactly 60 frames over 2 seconds.

V2.8 is complete. The public browser-safe `@vexa-video/studio` runtime composes the existing Player and Editor contracts for deterministic composition selection, props drafts, resolved metadata, preview/playhead state, timeline viewport state, and safe current-frame preservation. The normal Playground now provides the responsive Vexa Studio workspace, Node-hosted composition bundling/rendering, recursive source watching with SSE hot reload, diagnostics/log recovery, render progress/output/failure handling, and browser automation. Windows Chrome acceptance additionally verifies composition switching, play/pause/scrubbing, dirty-props/frame preservation across source reload, current-frame rendering, deliberate renderer failure/recovery, and execution through a repository alias containing spaces.

V2.12 is complete. Windows 11 acceptance passed the focused template, scene, and composition suites (9/9, 26/26, and 12/12), the full repository suite (365/365), TypeScript typecheck/build, and `npm run verify`; README/prohibited-runtime guards and `git diff --check` were clean. Templates remain descriptors around the existing composition runtime, variants reuse dynamic metadata, and reusable assets reuse the existing scene/storage contract rather than adding parallel execution or media-resolution models.

V2.13 is complete. A provider-neutral composition request envelope carries bundle references, JSON-safe props, still/frame/range/video targets, explicit artifact identity, and idempotency metadata through the existing hosted adapter. `composition.render` runs on the existing local/distributed job registration surface and delegates to `VexaCompositionRenderer` with ordinary progress and cancellation. Requested destinations publish only after rendering: single-file outputs reuse `Storage.upload()` and its S3/GCS/Azure/custom adapter boundary, while frame-range directories require an explicit provider publisher. Retry acceptance verifies the same artifact id, local output, destination, and overwrite-safe publication are reused on a second attempt. No cloud SDK, second queue, second renderer, or parallel storage model is introduced.

V2.14 has started at the CLI boundary without redefining composition semantics. `vexa compositions` delegates to `discoverBundleCompositions()` and defaults to the project-local `src/video.tsx` entry, while `vexa bundle` delegates to `bundleCompositions()` with explicit root/output/mode/source-map options and JSON-safe output. The second slice connects local composition execution to `VexaCompositionRenderer`: `vexa render` keeps existing media-file behavior for real media sources but resolves plain/forced composition ids through a bundle manifest, and `vexa still` renders true stills or selected video frames. The third slice exposes executable composition inspection and props resolution through the same renderer, then maps them to `vexa inspect` and `vexa validate` with JSON-safe output and typed JSON errors. Defaults, input schemas, custom validators, dynamic metadata, and manifest/executable consistency all remain owned by the existing core/renderer contracts.

The fourth slice introduces a transport-neutral `@vexa-video/mcp` adapter above the existing renderer and hosted-render surfaces. Its tool catalog and dispatcher expose composition list/inspect/validate plus hosted render start/get/cancel, preserve existing renderer/hosted error codes, and reject unsupported operation fields rather than accepting raw shell/media commands.

The fifth slice closes V2.14 by mounting that unchanged catalog on the official MCP TypeScript SDK. `@vexa-video/mcp/server` publishes the existing JSON schemas through `tools/list` and routes `tools/call` directly into `VexaMcpCompositionTools`; `@vexa-video/mcp/stdio` connects the same server to the official stdio transport. In-memory protocol acceptance and a spawned Node stdio client/server round trip prove the wire boundary without adding a second validator, renderer, queue, hosted request model, or shell surface.

V2.15 has started with the public Node-only `@vexa-video/test` foundation. Its first slice renders named frame checkpoints through `VexaCompositionRenderer.renderFrame()` and compares 8-bit non-interlaced PNG snapshots after deterministic RGBA normalization. Channel tolerance and maximum changed-pixel ratio are explicit test inputs, while malformed snapshots, unsafe checkpoint names, duplicate names, and exceeded tolerances fail with typed diagnostics. The same acceptance path rerenders the existing executable fixture through FFmpeg to prove repeatability before Player/Studio/browser-renderer parity fixtures are added.

The second slice adds a reviewed, checked-in 64×36 font-free wipe fixture and five semantic baselines: start, pre-transition, transition midpoint, post-transition, and final visible frame. `assertVisualCheckpointBaselines()` pairs rendered outputs with those named PNGs and applies the fixture's explicit channel/pixel tolerances, so transition timing and geometry regressions fail without introducing runtime-specific snapshot semantics. Player/Studio/browser-renderer parity remains the next V2.15 step.

The third slice extends that same wipe manifest with fps and duration, then adds deterministic runtime checkpoint parity. Node renderer acceptance verifies every rendered checkpoint's dimensions/fps/duration against the manifest; Player and Studio seek the same five frames; the browser renderer exposes matching frame/timestamp/duration through its normal `VexaWebVideoFrameContext`. `assertRuntimeCheckpointParity()` requires every named observation and reports typed runtime/checkpoint/field mismatches without introducing another preview or rendering path. Browser pixels are not inferred from Node tests; actual browser-capture visual parity remains separate work.

The fourth slice closes that gap for the reviewed wipe fixture. A browser-safe transition-visibility helper mirrors the existing FFmpeg easing/progress semantics, Studio applies the shared left/right/up/down wipe mask to its real DOM preview, and the existing headless-Chromium Studio verifier captures the same five 64×36 checkpoints at device scale factor 1. Those browser PNGs are compared with the reviewed Node baselines through `@vexa-video/test` using the existing narrow channel/pixel tolerance rather than a browser-specific snapshot model.

The fifth slice expands the deterministic acceptance matrix beyond transitions. Vexa-owned FFmpeg inputs exercise shape/text timing, image and video media, composition captions, parameterized props, and an audio-bearing composition through the existing renderer and `resolvedAssets` boundary. `compareMediaDurationSync()` / `assertMediaDurationSync()` derive the expected duration from fps plus frame count and report typed duration or A/V-skew failures; real MP4 acceptance probes both streams against a 50ms duration/skew budget.

The V2.15 closure audit confirms that every required fixture class is represented and each runtime is tested at the capability it actually owns: Node renderer for reviewed PNG/metadata output; Player and Studio for exact seek/timing state; browser renderer for exact frame/timestamp/duration context; and real Chromium Studio capture for browser pixels. Audio acceptance probes real video/audio streams against the frame-derived duration and bounded A/V skew. `@vexa-video/test` remains Node-only and does not create a browser dependency path. V2.15 is complete; broader browser/codec-specific pixel equivalence remains release-hardening work rather than a parallel snapshot model.

Detailed scope and acceptance:

- [Version 2 implementation plan](./docs/V2_MILESTONE.md)
- [Version 2 testing plan](./docs/V2_MILESTONE_TESTING.md)

### Independent implementation policy

Version 2 capabilities must be designed and implemented as Vexa-native functionality. New APIs, schemas, tests, fixtures, assets, examples, and runtime behavior must be Vexa-owned, derived from Vexa product requirements, and fit the package boundaries documented in this repository. Third-party source code, private implementation details, tests, fixtures, and undocumented internals must not be copied or used as compatibility targets.

## Version 3 — production media platform

The operational/platform work previously considered next is moved behind the Version 2 programmable-composition foundation. Version 3 includes worker hardening, capability-aware scheduling, incremental render caching, advanced hardware pipelines, professional editor semantics, advanced preview/proxy workflows, AI editing, first-party cloud media adapters, streaming expansion, project-format evolution, collaboration, and hosted-render infrastructure.

See [Version 3 implementation plan](./docs/V3_MILESTONE.md).

## Quality gate for every feature area

A feature is not considered ready until it has:

- typed public contracts;
- deterministic validation/planning where applicable;
- automated tests;
- at least one real integration test when FFmpeg or network/process behavior is involved;
- Windows-specific validation when filesystem/path behavior can differ;
- documentation and examples;
- no regression in `npm run verify`.

For the existing 1.x acceptance matrix, see [docs/MILESTONE-TESTING.md](./docs/MILESTONE-TESTING.md). Version 2 work additionally follows [docs/V2_MILESTONE_TESTING.md](./docs/V2_MILESTONE_TESTING.md).

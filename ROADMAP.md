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
| V2.6 | **Next** | TypeScript/TSX bundling and composition discovery |
| V2.7 | **Planned** | Node composition/still renderer using existing Vexa execution paths |
| V2.8 | **Planned** | Local Vexa Studio development environment |
| V2.9 | **Planned** | Shapes, effects, transitions, fonts, and composition captions |
| V2.10 | **Planned** | Optional extended programmable-media integrations |
| V2.11 | **Planned** | Browser/WebCodecs rendering with typed fallback |
| V2.12 | **Planned** | Parameterized templates and validated input schemas |
| V2.13 | **Planned** | Hosted/serverless composition rendering through existing job contracts |
| V2.14 | **Planned** | Agent/MCP/CLI composition workflows |
| V2.15 | **Planned** | Frame-level visual regression and runtime parity testing |
| V2.16 | **Planned** | Version 2 release hardening |

V2.1 through V2.5 are complete on the Version 2 branch. V2.5 acceptance evidence includes the **17/17** focused player suite, **190/190** full repository tests, successful TypeScript build, clean generated browser dependency audits, **9** release-ready public packages, successful release packing, and manual acceptance of the first-class Player workspace through the normal `npm run dev` visual playground. V2.6 is the next implementation target.

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

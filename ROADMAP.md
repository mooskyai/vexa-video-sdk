# Vexa Video SDK Roadmap

This roadmap starts from the **released Version 2.0.0 baseline** and describes the work that remains. It is intentionally outcome-oriented: detailed implementation notes belong in focused design documents and pull requests.

## Current baseline

| Item | Status |
| --- | --- |
| Stable release | **2.0.0** |
| Release tag | `v2.0.0` |
| Release source | `af8d1d8e0c967e2651b8f77c1e02b6f11135a90a` |
| Public packages | **18**, synchronized at `2.0.0` |
| npm `latest` | `2.0.0` |
| Publication | GitHub Actions OIDC trusted publishing with provenance |
| Primary Node baseline | Node.js 24.21.0+ |
| Release acceptance | Windows, Ubuntu, macOS, Chrome, Edge, Node 26 compatibility |

Version 2 is **released**, not release-ready or pending publication.

## What Version 2 established

The 2.0.0 release is the platform contract that Version 3 extends:

- deterministic media probing, editing, planning, timelines, audio, captions and adaptive streaming;
- hardware-accelerated encoding with runtime verification and CPU fallback;
- storage/workspace resolution and local/Redis job execution;
- browser-safe Angular, React, Player, Editor, Studio and WebCodecs layers;
- programmable composition contracts, bundling, Node rendering and browser preview;
- templates, graphics, transitions, captions, GIF/waveform/sound-effect integrations;
- provider-neutral AI, plugins and hosted-rendering contracts;
- CLI and MCP agent workflows;
- deterministic visual/runtime regression tooling;
- protected package validation and provenance-backed npm publishing.

## Version 3 — production media platform

Version 3 turns the Version 2 programmable-video foundation into a more resilient, scalable and collaborative production platform. Existing Version 2 capabilities are reused rather than reimplemented.

| Stage | Focus | V2 foundation | V3 status |
| --- | --- | --- | --- |
| V3.1 | Production hardening | jobs, retries, cancellation, idempotency, workspaces | **In progress** |
| V3.2 | Capability-aware distributed scheduler | Redis transport, hardware detection | Planned |
| V3.3 | Render cache and incremental execution | deterministic plans and composition identity | Planned |
| V3.4 | Advanced hardware pipeline | verified hardware encoders and CPU fallback | Planned |
| V3.5 | Professional editor engine | editor state/history, Studio timeline | Planned |
| V3.6 | Advanced preview/proxy pipeline | Player, Studio, browser renderer | Planned |
| V3.7 | Advanced graphics/motion systems | shapes, typography, effects, transitions | Planned |
| V3.8 | AI editing workflows | transcription, scenes, silence, smart reframe, highlights | Planned |
| V3.9 | First-party cloud media adapters | storage adapter contracts | Planned |
| V3.10 | Streaming 2.0 | HLS/DASH, renditions, segments, preview sprites | Planned |
| V3.11 | Project format 2.0 | serializable projects/compositions | Planned |
| V3.12 | Collaboration contracts | editor/project primitives | Planned |
| V3.13 | Hosted rendering platform | hosted-render requests, jobs, storage publication | Planned |
| V3.14 | Framework/service ecosystem | Angular + React + transport contracts | Planned |
| V3.15 | Plugin ecosystem expansion | plugin host and explicit extension points | Planned |
| V3.16 | Version 3 release | V2 release automation and acceptance model | Planned |

### V3.1 — production hardening

Add operational guarantees around the existing worker/job model:

- worker heartbeat and lease ownership;
- stale-claim and stale-job recovery;
- retry reconciliation and dead-letter handling;
- structured logs, metrics and tracing hooks;
- artifact-retention policy contracts;
- deterministic workspace cleanup and recovery tests.

Current development includes V3.1a lease/heartbeat fencing, V3.1b atomic claim and stale recovery, V3.1c indexed durable dead letters, V3.1d atomic cancellation/retry reconciliation, V3.1e worker-loop resilience and diagnostics, V3.1f targeted queued-orphan repair/workspace reclamation, V3.1g operator-triggered dead-letter retention, and V3.1h live Redis process-death acceptance. V3.1i adds opt-in hosted artifact receipt lookup/recording using a retry-stable request fingerprint. Broad orphan discovery, replay, provider-atomic publication and external artifact finalization remain later work; handler side effects are not exactly once.

**Acceptance:** fault-injection tests must demonstrate that process interruption does not silently lose or duplicate claimed work, retries remain idempotent, and abandoned workspaces/artifacts are handled predictably.

### V3.2 — capability-aware scheduling

Workers advertise platform, CPU/memory/concurrency, codecs, hardware providers and browser/composition capability. Jobs declare requirements and fallback policy. Scheduling must explain why a worker is eligible or rejected.

### V3.3 — render cache and incremental execution

Introduce content fingerprints, operation/render-node hashes, intermediate artifacts, dependency-aware invalidation, resumable execution, cache adapters and diagnostics. Cache correctness must be deterministic and observable.

### V3.4 — advanced hardware pipeline

Extend acceleration beyond final encoding toward hardware decode, GPU-resident frames, GPU-capable filters and hardware encode while preserving a verified CPU fallback.

### V3.5 — professional editor engine

Add split/ripple/slip edits, multi-select, grouping, linked A/V, copy/paste/duplicate, track locks, mute/solo, markers, magnetic timeline, advanced snapping and transaction-aware history.

### V3.6 — advanced preview and proxies

Add proxy media, frame-accurate seeking, quality levels, waveform/caption overlays, preview caching, background decode, large-project optimization and backend-generated fallback assets.

### V3.7 — advanced graphics and motion

Add rich multi-span text, masks, gradients, SVG manipulation, anchor points, reusable animated components, safe zones, responsive rules and cross-aspect-ratio adaptation.

### V3.8 — AI editing workflows

Extend the existing provider-neutral AI layer with diarization, stronger word alignment, filler-word detection, OCR, object/face tracking, scene understanding, semantic search and moderation. AI produces typed edit/composition plans; deterministic Vexa rendering remains authoritative.

### V3.9 — first-party cloud media

Add optional first-party packages for S3, GCS and Azure with multipart/resumable transfer, signed URLs, direct browser uploads, checksums, lifecycle controls and remote render outputs.

### V3.10 — Streaming 2.0

Add CMAF, fragmented MP4, alternate audio, subtitle renditions, language metadata, I-frame playlists, encryption contracts, optional DRM adapters and manifest validation.

### V3.11 — project format 2.0

Add an explicitly versioned project schema, migration API, JSON Schema, canonical normalization, project diff/import/export, annotations and collaboration metadata.

### V3.12 — collaboration contracts

Define backend-neutral revisions, operation logs, comments, annotations, presence metadata, conflict detection and revision comparison without requiring one real-time transport or database.

### V3.13 — hosted rendering platform

Add quotas, priority queues, worker pools, capability scheduling, reconciliation, autoscaling contracts, artifact lifecycle, telemetry and tenant-aware controls around the existing hosted-render contracts.

### V3.14 — framework and service ecosystem

Complete browser-safe integrations around shared contracts. Angular and React already exist; Vue/client work should reuse the same transport and browser/server boundary rather than introduce framework-specific execution paths.

### V3.15 — plugin ecosystem expansion

Expand explicit plugin capabilities for effects, transitions, media sources, storage, AI providers, render backends, encoders, job handlers, Studio panels and templates. Plugins must not bypass Vexa validation, planning or security rules.

### V3.16 — Version 3 release

A V3 release requires synchronized versions, repository verification, packed-tarball consumer installs, relevant Windows/Linux/macOS acceptance, browser acceptance, hosted-render acceptance, migration guidance, security/deployment updates and protected provenance-backed publication.

## Engineering policy

Every new capability must:

1. use typed public contracts;
2. preserve deterministic validation/planning where applicable;
3. keep browser packages free of Node-only execution imports;
4. include automated tests and real integration coverage for external processes/network paths;
5. update user-facing documentation in the same change;
6. preserve or intentionally version public API behavior.

The detailed V3 delivery plan is maintained in [`docs/V3_MILESTONE.md`](./docs/V3_MILESTONE.md).

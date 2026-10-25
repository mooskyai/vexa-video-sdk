# Version 3 Delivery Plan — Production Media Platform

Version 3 builds on the released Vexa Video SDK **2.0.0** contract. It is not a rewrite of programmable compositions, media execution, jobs, storage or browser tooling.

## Baseline

```text
V2 release: 2.0.0
Tag:        v2.0.0
Source:     af8d1d8e0c967e2651b8f77c1e02b6f11135a90a
```

## Planning rule

Each V3 stage must begin by identifying the Version 2 contracts it extends. Parallel queues, renderers, project formats, security models or browser/server boundaries should not be created unless the existing contract is intentionally versioned and the migration is documented.

## V3.1 — Production hardening

### Existing foundation

Version 2 already provides local/Redis jobs, retries, idempotency, cancellation, progress, managed workspaces and deterministic artifact identity in hosted composition workflows.

### Current implementation sequence

- **V3.1a — worker lease + heartbeat foundation:** implemented in the current development slice. Claims carry unique fencing tokens; Redis renews lease heartbeat/expiry atomically; worker save/retry/finish mutations require active ownership; cancellation is preserved across concurrent heartbeat/progress updates.
- **V3.1b — stale claim detection + recovery:** implemented. Redis atomically claims queued jobs, bounded scans safely recover abandoned processing entries, and old claim IDs remain fenced.
- **V3.1c — durable dead letters:** implemented in this development slice. Successful terminal-failure transitions and expired-lease exhaustion atomically persist an indexed failure envelope containing the terminal snapshot and reason; bounded inspection does not alter jobs or retry them.
- **V3.1d — retry reconciliation + operational diagnostics:** implemented. Redis validates each due retry against current state; cancellation and index removal are atomic, and bounded queue diagnostics/events expose operational state.
- **V3.1e — worker diagnostics + error-loop resilience:** adds opt-in claim, execution and lease-loss events; bounded backoff on claim/execute transport failures; read-only local counters and active-job IDs. A failed claim no longer permanently exits a worker loop. Lease loss still aborts the handler signal and cannot commit job state.
- **V3.1f — targeted orphan/workspace recovery:** opt-in atomic single-ID repair for unleased queued records missing known Redis references; dry-run-first, bounded operator cleanup for aged Vexa workspace directories. No automatic scans, dead-letter replay or active lease takeover.
- **Later V3.1 slices:** comprehensive orphan reconciliation, operator-controlled replay, retention, metrics/tracing integrations, workspace/artifact cleanup and real Redis process-failure acceptance.

### Add

- worker heartbeat;
- worker leases;
- stale-claim recovery;
- stale-job recovery;
- retry reconciliation;
- dead-letter handling;
- structured logging context;
- metrics and tracing hooks;
- artifact-retention contracts;
- deterministic workspace cleanup/recovery.

### Acceptance

- simulated worker death proves leases expire/recover safely;
- retry reconciliation cannot duplicate committed artifacts;
- dead-letter state preserves actionable failure context;
- workspace cleanup is deterministic after success, cancellation and crash recovery;
- metrics/tracing hooks do not couple the SDK to one observability vendor.

## V3.2 — Capability-aware distributed scheduler

### Existing foundation

Redis transport, job descriptors, hardware detection and composition/browser-render capabilities exist independently.

### Add

Workers advertise platform, CPU, memory, concurrency, NVENC/QSV/AMF/VideoToolbox, codecs and browser/composition capability. Jobs declare requirements and fallback policy.

### Acceptance

Scheduling is deterministic for a stable capability snapshot, explains rejection reasons, honors fallback policy and is tested across mixed worker pools.

## V3.3 — Render cache and incremental execution

Add content fingerprints, render-node hashes, intermediate artifacts, dependency graphs, partial invalidation, resumable execution, local/cloud cache adapters and diagnostics.

Cache hits must be reproducible and never reuse artifacts after a relevant dependency changes.

## V3.4 — Advanced hardware pipeline

Extend hardware use beyond encode:

```text
hardware decode
      -> GPU-resident frames
      -> GPU-capable filters
      -> hardware encode
```

Maintain verified CPU fallback and expose why a pipeline falls back.

## V3.5 — Professional editor engine

Extend `@vexa-video/editor` with split, ripple, multi-select, copy/paste/duplicate, grouping, linked audio/video, slip edits, track locks, mute/solo, markers, magnetic timeline, advanced snapping and transaction-aware history.

Editor commands must remain serializable/testable independently of a framework UI.

## V3.6 — Advanced preview/proxy pipeline

Build on Player/Studio/browser rendering with proxy media, frame-accurate seeking, waveform/caption overlays, quality levels, preview cache, background decoding, large-project optimization and backend-generated fallback assets.

## V3.7 — Advanced graphics and reusable motion

Build on Version 2 shapes/text/effects/transitions with rich multi-span text, masks, gradients, SVG manipulation, anchor points/transform origins, reusable animated components, safe zones, responsive layout and cross-aspect adaptation.

## V3.8 — AI editing workflows

### Already in Version 2

- provider-neutral transcription adapters;
- normalized segment/word timing;
- automatic captions;
- FFmpeg scene detection;
- silence-removal planning/rendering;
- subject-tracking hooks/smart reframe;
- highlight hooks/project generation.

### V3 additions

- diarization;
- improved word alignment;
- filler-word detection;
- OCR;
- object/face tracking adapters;
- scene understanding;
- semantic search;
- moderation.

AI output must normalize into typed Vexa-owned edit/composition plans. Model output is not the authoritative render representation.

## V3.9 — First-party cloud media adapters

Add optional packages:

```text
@vexa-video/storage-s3
@vexa-video/storage-gcs
@vexa-video/storage-azure
```

Support multipart/resumable transfer, signed URLs, direct browser uploads, checksums, lifecycle/retention policies and remote render outputs without pulling cloud SDKs into core packages.

## V3.10 — Streaming 2.0

Build on HLS/DASH/rendition/segment support with CMAF, fragmented MP4, alternate audio, subtitle renditions, language metadata, I-frame playlists, encryption contracts, optional DRM-provider adapters and manifest validation.

## V3.11 — Project format 2.0

Introduce an explicit versioned project schema, migration API, JSON Schema, canonical normalization, project diff, import/export, annotations and collaboration metadata.

Persisted formats must have migration tests and canonical round-trip fixtures.

## V3.12 — Collaboration contracts

Add backend-neutral revisions, operation logs, comments, annotations, presence metadata, conflict detection and revision comparison. Do not require a specific realtime transport or database.

## V3.13 — Hosted rendering platform

Extend existing hosted requests/jobs/storage publication with quotas, priority queues, worker pools, capability scheduling, retry reconciliation, autoscaling contracts, artifact lifecycle, telemetry and tenant-aware controls.

## V3.14 — Framework and service ecosystem

Angular and React foundations already exist. Complete shared browser/service integration patterns, including Vue/client packages where justified, while preserving the same serializable transport contracts and Node/browser separation.

## V3.15 — Plugin ecosystem expansion

Add explicit plugin capabilities for effects, transitions, media sources, storage, AI providers, render backends, encoders, job handlers, Studio panels and templates.

Plugins remain opt-in host code and cannot bypass normal validation/security/planning.

## V3.16 — Version 3 release

Release only after:

- synchronized public package versions;
- repository verification;
- packed-tarball isolated consumer installs;
- relevant Windows/Linux/macOS acceptance;
- browser acceptance;
- hosted/distributed acceptance;
- migration and deployment guidance;
- security documentation updates;
- protected OIDC/provenance publication.

## Recommended sequence

```text
V3.1  Production hardening
  |
V3.2  Capability-aware scheduling
  |
V3.3  Render cache / resumability
  |
V3.4  Advanced hardware pipeline
  |
V3.5  Professional editor
  |
V3.6  Preview / proxies
  |
V3.7  Advanced graphics
  |
V3.8  AI editing
  |
V3.9  First-party cloud media
  |
V3.10 Streaming 2.0
  |
V3.11 Project format 2.0
  |
V3.12 Collaboration
  |
V3.13 Hosted rendering platform
  |
V3.14 Framework/service ecosystem
  |
V3.15 Plugin ecosystem
  |
V3.16 Version 3 release
```

## Definition of done for a V3 stage

A stage is complete only when public contracts, validation/planning, tests, real integration coverage, docs and migration/compatibility impact are all complete. A partial foundation from Version 2 does not make the V3 stage complete by itself.

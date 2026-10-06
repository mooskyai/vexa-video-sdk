# Vexa Video SDK — Version 3 Milestone Plan

Version 3 contains the production-platform, scaling, professional-editor, cloud-media, and advanced infrastructure work that follows the programmable composition foundation planned for Version 2.

Version 3 should not begin until the core Version 2 composition/runtime model is stable enough that infrastructure work will not lock Vexa into the wrong render contract.

## V3.1 — Production hardening

- worker heartbeat;
- worker leases;
- stale-claim recovery;
- stale-job recovery;
- retry reconciliation;
- dead-letter handling;
- structured logging;
- metrics and tracing hooks;
- artifact retention;
- deterministic workspace cleanup.

## V3.2 — Capability-aware distributed scheduler

Workers advertise:

- platform;
- CPU capacity;
- memory;
- concurrency;
- NVENC/QSV/AMF/VideoToolbox availability;
- supported codecs;
- composition/browser-render capability.

Jobs declare requirements and fallback policy.

## V3.3 — Render cache and incremental execution

- content fingerprints;
- operation/render-node hashes;
- intermediate artifact cache;
- dependency graph;
- partial invalidation;
- resumable execution;
- local/cloud cache adapters;
- cache diagnostics.

## V3.4 — Advanced hardware pipeline

Extend acceleration beyond encode:

```text
hardware decode
      |
      v
GPU-resident frames
      |
      v
GPU-capable filters
      |
      v
hardware encode
```

Maintain verified CPU fallback.

## V3.5 — Professional editor engine

Expand `@vexa-video/editor` with:

- split;
- ripple edits;
- multi-select;
- copy/paste/duplicate;
- grouping;
- linked audio/video;
- slip editing;
- track locks;
- mute/solo;
- markers;
- magnetic timeline;
- advanced snapping;
- history transactions.

## V3.6 — Advanced preview/proxy pipeline

Build on the Version 2 player/browser renderer:

- proxy media;
- frame-accurate seeking;
- waveform/caption overlays;
- preview quality levels;
- preview cache;
- background decoding;
- large-project optimization;
- backend-generated fallback assets.

## V3.7 — Advanced graphics and reusable motion systems

- rich multi-span text;
- masks;
- gradients;
- SVG manipulation;
- anchor points/transform origins;
- reusable animated components;
- safe zones;
- responsive layout rules;
- cross-aspect-ratio composition adaptation.

## V3.8 — AI editing workflows

Expand `@vexa-video/ai` with provider-neutral contracts for:

- transcription;
- diarization;
- word alignment;
- filler-word detection;
- OCR;
- object/face tracking;
- scene understanding;
- semantic search;
- highlight extraction;
- moderation.

AI produces typed edit/composition plans; deterministic Vexa rendering remains authoritative.

## V3.9 — First-party cloud media adapters

Optional packages:

```text
@vexa-video/storage-s3
@vexa-video/storage-gcs
@vexa-video/storage-azure
```

Support:

- multipart/resumable transfers;
- signed URLs;
- direct browser uploads;
- checksums;
- retention/lifecycle policies;
- remote render outputs.

## V3.10 — Streaming 2.0

- CMAF;
- fragmented MP4;
- alternate audio;
- subtitle renditions;
- language metadata;
- I-frame playlists;
- encryption contracts;
- optional DRM-provider adapters;
- manifest validation.

## V3.11 — Project format 2.0

- versioned project schema;
- migration API;
- JSON Schema;
- canonical normalization;
- project diff;
- import/export;
- annotations;
- collaboration metadata.

## V3.12 — Collaboration contracts

Backend-neutral primitives for:

- revisions;
- operation logs;
- comments;
- annotations;
- presence metadata;
- conflict detection;
- revision comparison.

Do not require a specific realtime transport or database.

## V3.13 — Hosted rendering platform

- render quotas;
- priority queues;
- worker pools;
- capability scheduling;
- retries/reconciliation;
- autoscaling contracts;
- artifact lifecycle;
- telemetry;
- tenant-aware controls where needed.

## V3.14 — Framework and service ecosystem

Complete browser-safe integrations around shared Vexa contracts:

```text
@vexa-video/angular
@vexa-video/react
@vexa-video/vue
@vexa-video/client
```

Framework packages remain free of Node/FFmpeg execution dependencies.

## V3.15 — Plugin ecosystem expansion

Potential plugin capabilities:

- effects;
- transitions;
- media sources;
- storage;
- AI providers;
- render backends;
- encoders;
- job handlers;
- Studio panels;
- templates.

Plugins remain explicit and must not silently bypass Vexa planning/security rules.

## V3.16 — Version 3 release

Release requires:

- synchronized package versions;
- `npm run verify`;
- release checks and packed-tarball installs;
- Windows/Linux/macOS platform acceptance appropriate to changed code;
- browser acceptance;
- hosted-render acceptance;
- migration documentation;
- updated security/deployment guidance.

## Recommended order

```text
V3.1  Production hardening
  |
V3.2  Distributed scheduler
  |
V3.3  Render cache
  |
V3.4  Advanced hardware pipeline
  |
V3.5  Professional editor
  |
V3.6  Advanced preview/proxies
  |
V3.7  Advanced graphics
  |
V3.8  AI editing
  |
V3.9  Cloud media
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

# Architecture

This document describes the released Vexa Video SDK **2.0.0** architecture. Planned Version 3 work is documented separately and must not be treated as current behavior.

## Design goals

Vexa is designed around five constraints:

1. public APIs express media intent instead of raw shell commands;
2. plans are typed, inspectable and deterministic where practical;
3. browser runtimes never depend on Node/FFmpeg execution code;
4. optional providers/plugins remain explicit and replaceable;
5. new surfaces reuse the same renderer, jobs, storage and validation contracts.

## Runtime layers

```text
Browser / framework layer
Angular | React | Player | Editor | Studio | Web Renderer
                         |
                         | serializable contracts / explicit transport
                         v
Shared contracts
@vexa-video/core
                         |
            +------------+------------+
            |                         |
            v                         v
Composition toolchain            Media SDK
Bundler -> Renderer              @vexa-video/sdk
            |                         |
            +------------+------------+
                         |
                         v
Planning / execution
@vexa-video/ffmpeg
                         |
                         v
FFmpeg / ffprobe / filesystem / storage / workers
```

## Browser boundary

The following packages are designed to remain browser-safe at runtime:

- `@vexa-video/core` shared contracts;
- `@vexa-video/angular`;
- `@vexa-video/react`;
- `@vexa-video/player`;
- `@vexa-video/editor`;
- `@vexa-video/studio`;
- `@vexa-video/web-renderer`;
- `@vexa-video/sound-effects`.

They must not runtime-import `@vexa-video/sdk`, Node process modules, FFmpeg executors or Redis clients.

## Node media path

A normal `Video` workflow is:

```text
Video API
  -> immutable operation AST
  -> validation
  -> execution plan
  -> optimization/hardware decision
  -> FFmpeg argument graph
  -> process execution
  -> typed progress/result/error
```

Process launch uses explicit argument arrays. Compatible untouched streams can be copied instead of re-encoded.

## Timeline/project path

`VideoProjectAst` is the serializable multi-track representation for video/audio/image/text composition. Project rendering lowers track/clip/keyframe/transition intent into the same deterministic media/FFmpeg planning path rather than spawning a separate engine.

## Programmable composition path

```text
TS/TSX source
  -> @vexa-video/bundler
  -> bundle + manifest
  -> composition discovery/validation
  -> @vexa-video/renderer
  -> project/surface lowering
  -> existing execution path
```

Browser preview and Node rendering share timing/composition contracts but use runtime-appropriate implementations.

## Jobs and workers

Version 2 provides:

- local worker pools;
- serializable job descriptors;
- retries;
- idempotency keys;
- cancellation;
- progress reporting;
- Redis-backed distributed transport.

The current V3 development line extends the same serializable job contract with a lease attached to an active distributed claim. A lease carries a unique `claimId`, owning `workerId`, acquisition time, latest heartbeat time, and expiry time. Redis treats that lease as authoritative: heartbeat, progress save, retry, and finish mutations must present the active claim token, and control-plane cancellation is merged without overwriting lease state.

A worker that cannot renew its lease fails closed: it aborts its handler signal and does not publish a result through the lost claim. V3.1b makes dequeue-plus-lease assignment one atomic Redis Lua operation (rather than `BRPOPLPUSH` followed by a separate lease write), closing the unleased claim crash window for new workers. Existing processing entries are checked in bounded periodic scans; a Lua script rechecks expiry and ownership before requeuing, cancelling, or failing an exhausted job.

**Execution semantics:** lease fencing prevents stale workers from committing Redis job state after ownership changes. V3.1c additionally writes a dead-letter envelope and sorted index in the same Redis Lua transaction that commits a terminal failed job (normal worker failure or stale-lease exhaustion). The record preserves the failure, attempt, reason and terminal job snapshot; cancelled or retried jobs are not dead-lettered. `getDeadLetter()` and `listDeadLetters()` inspect these records without claiming/replaying work. These records have no automatic retention or replay policy yet.

V3.1d introduces an atomic queued/delayed cancellation transition. Redis also verifies the current snapshot before promoting each due retry, discarding stale index references rather than resurrecting cancelled or terminal jobs. `reconcileDueRetries(batchSize)` returns bounded promotion/discard counters, `getQueueDiagnostics()` returns read-only approximate queue sizes, and the optional `onDiagnostic` callback receives non-blocking retry/recovery event envelopes. A callback failure cannot roll back a Redis transition. Queued/retrying cancellations still do not create dead letters.

V3.1e hardens the distributed worker loop: transient claim or execution-path errors emit structured worker-local diagnostics and back off before polling again instead of terminating a worker task. `getDiagnostics()` exposes worker-local counts and current active job IDs; opt-in `onDiagnostic` events are synchronous and contain no payload/stack trace. A renewal failure emits `lease-lost` and aborts the handler, with no attempt to commit stale results. This does not guarantee idempotence for external side effects or replace Redis recovery.

V3.1f adds `reconcileQueuedOrphan(jobId)` as an explicit single-ID Lua reconciliation: only unleased `queued` records absent from ready, processing and delayed indexes can be restored (requires Redis 6.0.6+ for `LPOS`). No keyspace sweep, retry acceleration, failed-job replay or lease takeover occurs. `MediaWorkspace.reclaimAbandoned()` requires an explicit workspace root, `vexa-` prefix, age and entry bound; it defaults to dry-run. Destructive sweeps must be operator-confirmed with affected workers stopped, since directory age cannot prove abandonment.

V3.1g adds a separately triggered `pruneDeadLetters({minAgeMs, limit, dryRun})` retention operation. Its Redis Lua transaction samples at most `limit` old index members and, only when `dryRun: false`, removes indexed envelopes. Archive age is determined by sorted-index scores. It does not mutate `:job:<id>` snapshots, idempotency keys, retries, or media. Retention is not automatic; operators should export failures before deletion.

V3.1h's test-only RESP2 client exercises the unmodified Redis transport against loopback Redis 7, including a child worker process kill and replacement claim, fencing, cancellation and promotion races. It is not included in `npm run verify`.

V3.1i adds optional hosted-render publication receipts. The worker hashes the normalized request payload with sorted JSON keys, passes its fingerprint to provider hooks, checks an existing provider receipt before renderer construction, and reuses a matching receipt on retry. Mismatched receipts or lookup errors fail closed. An optional writer records the receipt after publication but before committing the job result; neither receipt persistence nor remote upload is atomic with Redis, so provider publication must remain idempotent at a stable artifact identity. This slice does not implement remote provider transactions or automated artifact sweeps.

V3.1j supplies `RedisHostedCompositionReceiptStore`: a tenant-scoped, destination-hashed Redis key indexes an immutable request fingerprint and artifact receipt, and Lua atomically rejects conflicting writes from competing workers. Provider `verifyArtifact` must confirm remote existence/identity before saving and on every reuse; a missing object or validation failure stops work rather than blindly publishing. Neither a Redis receipt nor lease fencing prevents an upload racing ahead of a conflicting receipt write; providers still need conditional/object-versioned publication and cleanup policies.

V3.1k introduces explicit `reconcileUnrecordedArtifact()` for the upload-before-receipt crash window. It checks any existing Redis receipt first, invokes an opt-in authoritative `inspectArtifact` callback for the exact destination, refuses mismatched request fingerprints/destinations, verifies the remote object, persists through the existing Lua CAS and reads back with fresh provider verification. Returning `null` is permitted only when the provider establishes the remote object is absent. This is not a keyspace sweep or exactly-once protocol; provider metadata, stable conditional uploads, and manual handling of conflicts remain necessary.

V3.1l stores a Redis-server-time creation marker alongside newly committed receipts without changing immutable receipt CAS payloads. `retireMissingReceipt()` is dry-run first, scoped to one known destination, requires provider-confirmed remote absence and a caller-supplied job/reference guard, and atomically rechecks age and raw receipt contents before removing only receipt/marker keys. Older records without markers are not eligible. Operators must prevent new publication/lease races; no remote media deletion is performed.

V3.1m layers bounded operator diagnostics over V3.1l dry-run retirement: explicit destination candidates (max 100) are preflight-validated, inspected serially without keyspace scans or destructive Redis operations, classified using the existing provider-authoritative absence and reference checks, and summarized with redacted per-entry provider failures. Optional diagnostic callbacks cannot alter the result if they throw. Findings are snapshots, not a distributed lock or permission to retire active outputs.

V3.1n exposes synchronous, optional `onMetric` and `onSpan` sinks on `DistributedJobWorker`. Monotonic elapsed time produces attempt duration samples, while completed spans include explicit outcome and job/claim correlation. Metrics only tag stable job type/outcome (never job or claim identifiers), and no payload, exception text or stack is exported by these hooks. Exporters are application-owned: callbacks that throw cannot disrupt job mutations, but high-volume exporters should use nonblocking bounded queues. Span completion reflects observed worker attempts, not exactly-once remote storage publication.

V3.1p introduces a separate CI acceptance job for Redis/process-death and S3-compatible conditional publication, plus a [production go/no-go audit](./V3_1P_PRODUCTION_HARDENING_REVIEW.md). These do not alter worker/Redis/object protocols or establish exactly-once external publication; deterministic crash-workspace cleanup and provider-specific artifact lifecycle remain explicit gates.

Arbitrary media output, uploads and other external handler side effects are still at-least-once, not exactly once; use idempotent artifact identities and later reconciliation. Stop old V3 worker processes before deploying protocol changes. Pre-existing failures are not retroactively backfilled into the dead-letter index.

## Storage

The storage/workspace layer resolves local and remote media into managed execution paths and exposes adapter hooks for cloud providers. S3/GCS/Azure hooks in 2.0.0 are contracts, not first-party cloud SDK packages.

First-party cloud packages are planned for Version 3.

## Hardware

Version 2 detects and verifies eligible encoding providers:

- CPU;
- NVIDIA NVENC;
- Intel Quick Sync;
- AMD AMF;
- Apple VideoToolbox.

Automatic selection verifies a provider with a real encode before use and supports CPU fallback. A fully GPU-resident decode/filter/encode pipeline is future Version 3 work.

## Hosted rendering

Hosted composition requests reuse existing renderer/job/storage contracts. Typed requests preserve artifact identity and idempotency; single-file remote publication reuses the storage upload boundary.

The full multi-tenant hosted platform—quotas, priority queues, autoscaling, capability scheduling, reconciliation and tenant controls—is planned for Version 3.

## Plugins

The plugin host supports explicit lifecycle-managed registration for operations, storage adapters, jobs, render backends and encoder providers. Plugin metadata can be consumed by tooling, but plugin runtime code is loaded only by the host.

Plugins are not a sandbox and must not bypass normal planning/security rules.

## AI extension

`@vexa-video/ai` is separate from deterministic media packages. Provider adapters normalize transcription/tracking/highlight data into Vexa-owned types, then deterministic Vexa APIs produce edit/composition plans.

This prevents model-provider output from becoming the authoritative render format.

## Error and lifecycle model

Long-running execution paths should preserve:

- typed validation errors before work begins where possible;
- cancellation through `AbortSignal`/existing lifecycle contracts;
- structured progress;
- bounded timeouts where supported;
- deterministic cleanup of managed temporary resources.

## Architecture commitments

Unless intentionally changed through a documented API revision:

1. `@vexa-video/core` remains backend-neutral;
2. `@vexa-video/sdk` remains Node execution code;
3. browser packages remain free of Node execution imports;
4. FFmpeg processes use explicit arguments, not shell-concatenated strings;
5. plans remain inspectable before expensive execution;
6. new surfaces reuse existing validators/renderers/jobs/storage instead of parallel engines;
7. Windows, Linux and macOS differences are tested where paths/processes/fonts/hardware are involved.

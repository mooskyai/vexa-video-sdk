# @vexa-video/sdk

The primary high-level Node.js API for media editing, audio, captions, timeline projects, streaming, storage, hardware, jobs/workers, plugins and hosted-render adapters.

> Stable baseline: **2.0.0** · Node.js only; may execute FFmpeg/ffprobe and access the filesystem/network.

## Install

```bash
npm install @vexa-video/sdk@2.0.0
```

## When to use it

Start here for a Node service, CLI-like application, worker, media API or server-side render workflow.

## Capabilities

- Immutable `Video` and `Audio` workflows with inspectable plans
- `VideoProject` timeline composition
- Streaming, storage and safe remote-media resolution
- Local/Redis-backed jobs, retries, idempotency, progress and cancellation
- Runtime-verified hardware acceleration with CPU fallback
- Plugin and hosted-render integration points

### V3 development: distributed-worker leases

The unreleased V3 worker path extends `DistributedJobWorker` and `RedisJobTransport` with renewable leases. Each claim receives a unique `claimId`; heartbeats extend `heartbeatAt`/`expiresAt`; and save, retry, and terminal mutations are rejected when the worker no longer owns the claim. `leaseDurationMs` defaults to 30 seconds and `heartbeatIntervalMs` defaults to one third of the lease duration, capped at 10 seconds.

The unreleased V3.1b Redis transport adds atomic queue-to-processing claiming plus bounded stale-claim recovery (`recoveryIntervalMs` defaults to 1 second, `recoveryBatchSize` defaults to 100). Call `transport.recoverStaleClaims()` for an explicit pass, or let active workers trigger periodic passes. Expired claims are requeued when attempts remain; cancelled claims become terminal; exhausted claims fail with `JOB_STALE_LEASE_EXHAUSTED`. Recovery never overwrites a still-valid lease and always fences the previous claim token.

To upgrade between V3 development builds, stop old workers first: mixed claim protocols are not supported. Recovery has at-least-once execution semantics; handlers publishing external artifacts must be idempotent.

V3.1c archives failed and exhausted distributed jobs atomically in Redis (`:dead:index` sorted by failure time and immutable `:dead:entry:<jobId>` records). Use `await transport.getDeadLetter(jobId)` or `await transport.listDeadLetters(offset, limit)` (default page 100, max 1,000) to inspect terminal failures. Cancelled jobs and pending retries are excluded.

V3.1d adds `await transport.reconcileDueRetries(batchSize)` (default 100, max 1,000), with `{scanned, promoted, discarded}`. Each due retry is checked against the authoritative job record; stale, missing, cancelled or terminal entries are discarded. `transport.cancel(jobId)` atomically finalizes unleased queued/retrying jobs or requests cancellation from an active lease holder. `await transport.getQueueDiagnostics()` reads approximate `{queued, processing, delayed, deadLetters}` counts without mutating state. Supply `onDiagnostic: (event) => { ... }` to observe structured `retry-reconciliation` and `stale-recovery` summaries. Callback errors do not affect Redis transitions. External output reconciliation, automatic replay and retention are still separate work.

V3.1e adds `new DistributedJobWorker(transport, { errorBackoffMs: 250, onDiagnostic: (event) => { ... } })`. The worker emits synchronous `claim-error`, `execution-error`, `started`, and `lease-lost` events; a throwing listener is isolated. `worker.getDiagnostics()` returns local claim/execute/lease-loss counts and active job IDs. A claim or execution-path transport failure backs off before retrying the worker loop, while a lost lease still fails closed. Use this for worker telemetry; it does not enable replay, global metrics or exactly-once handler side effects.

V3.1f adds `await transport.reconcileQueuedOrphan(jobId)` for one known, unleased queued job missing its ready/processing/delayed index entry. This operator-triggered atomic action uses `LPOS` (Redis 6.0.6+) and never bypasses retry delays or active lease fencing. For workspaces, inspect `await MediaWorkspace.reclaimAbandoned({ root, prefix: "vexa-media-", minAgeMs: 86400000 })` first (dry-run default). Only after stopping affected workers should an operator set `dryRun: false`. At most 100 matching names are scanned per call by default (max 1,000); mtime is not proof of abandonment.

V3.1g: inspect `await transport.pruneDeadLetters({ minAgeMs: 7 * 86400000, limit: 100 })` first, then explicitly set `dryRun: false` to remove the oldest qualifying Redis failure envelopes and index entries. Minimum age is one day; batch limit defaults to 100 (maximum 1,000). This action is irreversible for the archived failure envelope and has no scheduler side effects: original job snapshots, retries, idempotency and published artifacts remain unchanged. Export important dead letters before pruning; no automatic retention loop or replay is provided.

V3.1h real Redis acceptance (Redis 7 on localhost): start `docker run -d --name vexa-v31h-redis -p 127.0.0.1:6389:6379 redis:7-alpine`, set `$env:VEXA_TEST_REDIS_URL = "redis://127.0.0.1:6389"` in PowerShell, then run `npm run test:redis`. The command fails if the endpoint is missing or is not loopback. Four tests exercise real Lua transactions, cross-process death and recovery, owner fencing, cancellation and delayed-retry races. The suite deletes only randomly prefixed test keys; it never flushes a database. Stop and remove the dedicated container after testing (`docker rm -f vexa-v31h-redis`). `npm run verify` remains the fast 442-test gate; the live Redis gate must pass separately before V3.1h sign-off.

## Minimal example

```ts
import { Video } from "@vexa-video/sdk";

await Video.load("input.mp4")
  .trim({ start: 2, duration: 10 })
  .resize({ width: 1280, height: 720, fit: "contain" })
  .export("output.mp4", { videoCodec: "h264", audioCodec: "aac" });
```

## Runtime boundary

Do not import this package into browser bundles. Browser packages communicate with Node execution through HTTP or another application-owned transport.

## Documentation

- [getting-started.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/getting-started.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)
- [hosted-rendering.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/hosted-rendering.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

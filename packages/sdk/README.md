# @vexa-video/sdk

**Unreleased V3.1t workspace option:** `RedisWorkspaceQuiescence(client, { prefix })` gives deployment-enrolled producers/consumers `acquire`/`renew`/`release`, and can be passed as `quiescence` to `MediaWorkspace.reclaimAbandoned` with a mandatory external `confirmAbandoned` callback. Dry run remains the default; failed authority checks and live owners deny deletion. See [the integration contract](../../docs/V3_1T_DISTRIBUTED_WORKSPACE_OWNERSHIP.md).

**V3.1s development release gate:** [review and evidence inventory](../../docs/V3_1S_RELEASE_GATE_REVIEW.md) record historical CI success but general production **NO-GO**. This is not a new SDK API or a change to the released `2.0.0` installation instructions.

The primary high-level Node.js API for media editing, audio, captions, timeline projects, streaming, storage, hardware, jobs/workers, plugins and hosted-render adapters.

> Stable baseline: **2.0.0** · Node.js only; may execute FFmpeg/ffprobe and access the filesystem/network.

## Install

```bash
npm install @vexa-video/sdk@2.0.0
```

## When to use it

Start here for a Node service, CLI-like application, worker, media API or server-side render workflow.

## Capabilities

V3.1r (unreleased) exports `planArtifactLifecycleReview({ tenantId, nowMs, policy, candidates })` as a **read-only** operator pre-screening API. It holds job snapshots and remote media unconditionally; dead-letter/receipt/workspace review requires explicit age, reference and authority evidence. Output `review` means *human review*, not deletion permission. See [`docs/V3_1R_ARTIFACT_RETENTION_POLICY.md`](../../docs/V3_1R_ARTIFACT_RETENTION_POLICY.md) for the five-resource retention matrix and operator runbook.

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

V3.1h real Redis acceptance (Redis 7 on localhost): start `docker run -d --name vexa-v31h-redis -p 127.0.0.1:6389:6379 redis:7-alpine`, set `$env:VEXA_TEST_REDIS_URL = "redis://127.0.0.1:6389"` in PowerShell, then run `npm run test:redis`. V3.1m extends this opt-in suite to twelve live Redis tests; the standard `npm run verify` remains separate. The hosted receipt hook and `RedisHostedCompositionReceiptStore` are exported from `@vexa-video/renderer`, not SDK.

V3.1n worker observability: pass `onMetric: (metric) => { ... }` and `onSpan: (span) => { ... }` to `new DistributedJobWorker(transport, options)`. Counter names cover claim/execution failures, lost leases and observed attempts; histograms report attempt duration in milliseconds. Completed spans include start/end times, outcome, worker/job/claim IDs and job type. **Metric attributes never include job/claim IDs.** Neither callback receives job payloads, stack traces or error messages. Implement aggregation, redaction, backpressure and exporter delivery in the application; hooks are synchronous, best effort and cannot change worker outcomes.

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

V3.1q workspace recovery: `MediaWorkspace.reclaimAbandoned({ root, prefix, minAgeMs, confirmAbandoned: async (path) => ... })` optionally checks application-owned durable lease/reference authority before listing and deleting an aged candidate. The callback must return literal `true` for eligibility; `false` skips and exceptions abort. It is rechecked immediately before `{ dryRun: false }` deletion. Defaults remain dry-run-first and legacy age-only cleanup remains available; neither is a distributed lock. Run `npm run test:workspace-crash` for the opt-in FFmpeg child-process fixture; see `docs/V3_1Q_WORKSPACE_CRASH_ACCEPTANCE.md`.

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

To upgrade from the V3.1a worker implementation, stop old workers before deploying new workers: mixed claim protocols are not supported. Recovery has at-least-once execution semantics; handlers publishing external artifacts must be idempotent. Full dead-letter persistence and external output reconciliation are not yet available.

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

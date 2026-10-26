# Hosted Rendering

Vexa separates the portable render contract from provider infrastructure. Applications can submit/get/cancel/wait through `HostedRenderer` while the adapter owns authentication, vendor SDKs, queues and deployment details.

## Basic adapter usage

```ts
import { HostedRenderer } from "@vexa-video/sdk";

const renderer = new HostedRenderer(myHostedAdapter);

const job = await renderer.submit({
  schemaVersion: 1,
  type: "video.render",
  payload: {
    source: "s3://media/input.mp4",
    output: "s3://media/output.mp4"
  },
  idempotencyKey: "customer-42-render-7"
});

const result = await renderer.wait(job.id);
console.log(result);
```

## Composition-hosted rendering

Version 2 composition requests carry typed bundle/props/target/artifact/idempotency information through the existing hosted/job boundary. The job handler delegates to `VexaCompositionRenderer` rather than implementing a second renderer.

Single-file publication can reuse the normal `Storage.upload()` adapter boundary. Directory/frame-sequence publication requires an explicit provider publisher because it has different atomicity/lifecycle semantics.

## Adapter responsibilities

A hosted adapter should own:

- provider authentication;
- request transport;
- provider-specific queue/job identifiers;
- retryable network behavior;
- output/event translation;
- tenant/authorization context required by the provider.

Vexa owns the portable request/state/cancel/wait contract.

## Idempotency

Use stable idempotency keys for user actions that may be retried. External side effects must still be idempotent because distributed retries can occur after an operation has partially completed.

V3.1i optionally lets `registerHostedCompositionRenderWorker` accept `lookupPublishedArtifact` and `recordPublishedArtifact`. Both receive a retry-stable SHA-256 fingerprint of the normalized hosted composition request. A matching provider-backed receipt skips rendering and uploading on a retry, including after a worker failed after recording publication but before committing its job result. Mismatched receipts and lookup errors fail closed; no remote destination is overwritten blindly. `publishArtifact` receives the same `context.fingerprint` so providers can attach it to artifact metadata. Receipt writers must be durable, repeat-safe and validate the remote artifact before returning it. A crash between upload and receipt write can still cause another upload, so stable artifact destinations and provider idempotence are required. This is not exactly-once delivery.

V3.1j exports `RedisHostedCompositionReceiptStore` from `@vexa-video/renderer`. Create it with `{ prefix: "vexa:tenant-a", verifyArtifact: async (receipt, output) => ... }` and an existing Redis client implementing `sendCommand`; pass `store.lookupPublishedArtifact` and `store.recordPublishedArtifact` to `registerHostedCompositionRenderWorker`. `verifyArtifact` must check the actual remote object's identity/existence, not just trust the receipt. The Redis receipt index is keyed by a SHA-256 hash of the destination within an explicitly tenant-scoped prefix. Atomic Lua compare-and-set refuses overwriting another request's immutable receipt; a missing or invalid remote object aborts reuse. Receipt keys have no automatic TTL or sweeping. Concurrent uploads can still race before recording, so use destination-aware conditional writes/versioning at the provider and isolate tenants.

V3.1k adds opt-in `store.reconcileUnrecordedArtifact(output, payload, context)`. Configure `inspectArtifact` to query the **actual** remote destination and extract its independently stored request fingerprint and artifact identity. If there is no Redis receipt, this method validates the remote fingerprint and exact URL, invokes `verifyArtifact`, then records through Redis compare-and-set and verifies again. `null` must mean an authoritative remote absence, not a timeout or permission error; errors and mismatches stop recovery. Operators can call the method for one known artifact or deliberately wire it as `lookupPublishedArtifact` to attempt recovery before rendering. This does not delete or alter external objects, serialize uploads or remove the pre-upload race; provider conditional writes remain necessary.

V3.1l adds `store.retireMissingReceipt(output, payload, context, { minAgeMs: 86400000 })`. It defaults to a **dry run** (`eligible` means no deletion); `dryRun: false` permits deleting the one aged Redis receipt only after `inspectArtifact` authoritatively returns `null` and `isReceiptUnreferenced` confirms no active jobs, leases or external consumers. Both callbacks are required and must fail closed on errors. Redis rechecks the stored value and server-time age atomically. The minimum age is 24 hours. Receipts created before V3.1l lack an age marker and return `untracked`, never auto-backfilled. Remote media is never deleted; coordinate with producers because the callbacks are not a transactional lock.

## Version 2 vs Version 3

Version 2 provides portable hosted-render contracts and job/storage integration. It does **not** claim a complete multi-tenant hosted platform.

Version 3 plans:

- quotas;
- priority queues;
- worker pools;
- capability-aware scheduling;
- retry reconciliation;
- autoscaling contracts;
- artifact lifecycle;
- telemetry;
- tenant-aware platform controls.

Do not design a Version 2 deployment assuming those planned platform features already exist.

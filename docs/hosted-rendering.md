# Hosted Rendering

**V3.1t boundary:** managed local workspaces can opt into Redis-backed ownership admission and a persistent reclamation seal, but hosted workers must explicitly register every producer/consumer, renew leases, handle lost claims and verify external references before cleanup. This is not deployed provider finalization, remote deletion or approval to release; [details](./V3_1T_DISTRIBUTED_WORKSPACE_OWNERSHIP.md).

**V3.1s production gate:** [review and machine-readable evidence](./V3_1S_RELEASE_GATE_REVIEW.md) record **NO-GO** for a general hosted deployment. Passing isolated Redis/S3-compatible CI does not demonstrate real provider conditional-write, multipart cleanup, tenant isolation, producer quiescence or disaster recovery in a deployed system.

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

For operator retention decisions in the unreleased V3.1r branch, `planArtifactLifecycleReview()` offers a read-only five-resource review matrix in `@vexa-video/sdk`. A receipt is only reviewable after independently verified remote absence, current no-reference authority and minimum age; the report never deletes or authorizes deletion. See [V3.1r retention policy](./V3_1R_ARTIFACT_RETENTION_POLICY.md).

Use stable idempotency keys for user actions that may be retried. External side effects must still be idempotent because distributed retries can occur after an operation has partially completed.

V3.1i optionally lets `registerHostedCompositionRenderWorker` accept `lookupPublishedArtifact` and `recordPublishedArtifact`. Both receive a retry-stable SHA-256 fingerprint of the normalized hosted composition request. A matching provider-backed receipt skips rendering and uploading on a retry, including after a worker failed after recording publication but before committing its job result. Mismatched receipts and lookup errors fail closed; no remote destination is overwritten blindly. `publishArtifact` receives the same `context.fingerprint` so providers can attach it to artifact metadata. Receipt writers must be durable, repeat-safe and validate the remote artifact before returning it. A crash between upload and receipt write can still cause another upload, so stable artifact destinations and provider idempotence are required. This is not exactly-once delivery.

V3.1j exports `RedisHostedCompositionReceiptStore` from `@vexa-video/renderer`. Create it with `{ prefix: "vexa:tenant-a", verifyArtifact: async (receipt, output) => ... }` and an existing Redis client implementing `sendCommand`; pass `store.lookupPublishedArtifact` and `store.recordPublishedArtifact` to `registerHostedCompositionRenderWorker`. `verifyArtifact` must check the actual remote object's identity/existence, not just trust the receipt. The Redis receipt index is keyed by a SHA-256 hash of the destination within an explicitly tenant-scoped prefix. Atomic Lua compare-and-set refuses overwriting another request's immutable receipt; a missing or invalid remote object aborts reuse. Receipt keys have no automatic TTL or sweeping. Concurrent uploads can still race before recording, so use destination-aware conditional writes/versioning at the provider and isolate tenants.

V3.1k adds opt-in `store.reconcileUnrecordedArtifact(output, payload, context)`. Configure `inspectArtifact` to query the **actual** remote destination and extract its independently stored request fingerprint and artifact identity. If there is no Redis receipt, this method validates the remote fingerprint and exact URL, invokes `verifyArtifact`, then records through Redis compare-and-set and verifies again. `null` must mean an authoritative remote absence, not a timeout or permission error; errors and mismatches stop recovery. Operators can call the method for one known artifact or deliberately wire it as `lookupPublishedArtifact` to attempt recovery before rendering. This does not delete or alter external objects, serialize uploads or remove the pre-upload race; provider conditional writes remain necessary.

V3.1l adds `store.retireMissingReceipt(output, payload, context, { minAgeMs: 86400000 })`. It defaults to a **dry run** (`eligible` means no deletion); `dryRun: false` permits deleting the one aged Redis receipt only after `inspectArtifact` authoritatively returns `null` and `isReceiptUnreferenced` confirms no active jobs, leases or external consumers. Both callbacks are required and must fail closed on errors. Redis rechecks the stored value and server-time age atomically. The minimum age is 24 hours. Receipts created before V3.1l lack an age marker and return `untracked`, never auto-backfilled. Remote media is never deleted; coordinate with producers because the callbacks are not a transactional lock.

V3.1m adds `store.inspectKnownReceipts([{ output, payload, context }], { minAgeMs: 86400000, onDiagnostic })` for up to 100 explicitly supplied, unique destinations. It applies the V3.1l dry-run authority checks and returns immutable per-destination statuses plus aggregate counts. Provider callback errors are redacted to `INSPECTION_FAILED` and cannot hide the status of other candidates; diagnostic observer exceptions are ignored. Inputs are prevalidated before Redis access, no keys are enumerated, and no receipts or remote objects are mutated. `eligible` is an operator finding, not an authorization to run cleanup without coordinating producers and validating live references.

V3.1o adds a test-only isolated S3-compatible SILO + Redis acceptance suite. A separate process exits after S3 PUT and (in a second case) after Redis receipt CAS; fresh clients inspect authoritative remote metadata and recover without overwriting. Conflicting conditional writes, missing metadata, missing remote objects and auth failures must fail closed. See [the V3.1o acceptance guide](./V3_1O_OBJECT_STORAGE_ACCEPTANCE.md). This is not a bundled production provider adapter or exactly-once guarantee.

V3.1p keeps production hosted publication status at **NO-GO** pending [the acceptance review](./V3_1P_PRODUCTION_HARDENING_REVIEW.md): the isolated SILO tests are not a deployment-specific S3/GCS/Azure adapter certification, and neither Redis CAS nor conditional PUT makes publication globally exactly once.

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

V3.1q independently tests managed workspace artifacts across abrupt child-process death, safe restart and normal cancellation. The optional `confirmAbandoned(path)` callback lets a deployment reject workspaces still referenced by running workers; the SDK does not infer abandonment from Redis receipts or directory age alone. See [the V3.1q operator guide](./V3_1Q_WORKSPACE_CRASH_ACCEPTANCE.md).

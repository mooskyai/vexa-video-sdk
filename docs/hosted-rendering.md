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

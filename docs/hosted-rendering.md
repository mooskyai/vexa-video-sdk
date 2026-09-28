# Hosted and cloud rendering contract

Vexa keeps hosted rendering provider-neutral. `HostedRenderer` wraps an application-supplied adapter with one small contract: submit, inspect, and cancel a remote render job.

```ts
import { HostedRenderer } from "@moosky-video/sdk";

const renderer = new HostedRenderer({
  async submit(request, options) {
    return cloudClient.submit(request, options?.signal);
  },
  async get(jobId, options) {
    return cloudClient.get(jobId, options?.signal);
  },
  async cancel(jobId, options) {
    return cloudClient.cancel(jobId, options?.signal);
  }
});

const submitted = await renderer.submit({
  schemaVersion: 1,
  type: "video.render",
  payload: {
    source: "s3://media/input.mp4",
    output: "s3://media/output.mp4"
  },
  idempotencyKey: "customer-42-render-7"
});

const terminal = await renderer.wait(submitted.id, {
  pollIntervalMs: 1000,
  timeoutMs: 30 * 60 * 1000
});
```

The adapter decides how jobs map to a cloud vendor, hosted Vexa service, Kubernetes job, serverless queue, or another execution plane. Vexa does not embed provider credentials or vendor SDKs in the core contract.

Artifacts are represented by portable URLs plus optional content type, byte size, and metadata. Cancellation is best-effort and should map to the provider's native cancellation semantics.

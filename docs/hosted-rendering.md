# Hosted and cloud rendering contract

Vexa keeps hosted rendering provider-neutral. `HostedRenderer` wraps an application-supplied adapter with one small contract: submit, inspect, and cancel a remote render job.

```ts
import { HostedRenderer } from "@vexa-video/sdk";

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

const compositionJob = await renderer.submitComposition(
  {
    schemaVersion: 1,
    bundle: { id: "bundle-42", manifest: "s3://bundles/42/vexa.bundle.json" },
    compositionId: "ProductDemo",
    target: { kind: "video", startFrame: 30, endFrameExclusive: 90, container: "mp4" },
    inputProps: { title: "Launch" },
    output: {
      artifactId: "customer-42/render-7",
      destination: "s3://renders/customer-42/render-7.mp4"
    }
  },
  { idempotencyKey: "customer-42-render-7" }
);

const terminal = await renderer.wait(compositionJob.id, {
  pollIntervalMs: 1000,
  timeoutMs: 30 * 60 * 1000
});
```

`submitComposition()` is only a typed transport boundary. Worker execution reuses the existing Node renderer and job registration contract rather than adding a hosted-only scheduler. `@vexa-video/renderer` exposes `registerHostedCompositionRenderWorker()`: the host resolves the provider-owned bundle reference and output identity into worker-local paths, while Vexa maps the request into the normal still/frame/range/video renderer, forwards renderer progress into job progress, and preserves cancellation through the existing `AbortSignal` contract.

```ts
import { JobQueue } from "@vexa-video/sdk";
import { registerHostedCompositionRenderWorker } from "@vexa-video/renderer";

const queue = new JobQueue({ concurrency: 2 });

registerHostedCompositionRenderWorker(queue, {
  async resolveManifest(bundle) {
    return await bundleCache.materialize(bundle);
  },
  async resolveOutput(output) {
    return renderWorkspace.pathFor(output.artifactId);
  }
});
```

The same registration shape is implemented by Vexa's distributed worker. The bridge deliberately stops at the local render artifact. Uploading that artifact to `output.destination` and returning a portable hosted artifact URL remains provider-owned until the remote-output slice lands.

The adapter decides how jobs map to a cloud vendor, hosted Vexa service, Kubernetes job, serverless queue, or another execution plane. Vexa does not embed provider credentials or vendor SDKs in the core contract.

Artifacts are represented by portable URLs plus optional content type, byte size, and metadata. Cancellation is best-effort and should map to the provider's native cancellation semantics.

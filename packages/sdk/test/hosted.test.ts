import assert from "node:assert/strict";
import test from "node:test";
import type { HostedRenderAdapter, HostedRenderJob, HostedRenderRequest } from "@vexa-video/core";
import { HostedRenderer } from "../src/hosted.js";

class FakeHostedAdapter implements HostedRenderAdapter {
  reads = 0;
  job: HostedRenderJob = { id: "job-1", state: "queued" };
  lastRequest: HostedRenderRequest | undefined;

  async submit<TPayload, TResult>(request: HostedRenderRequest<TPayload>): Promise<HostedRenderJob<TResult>> {
    assert.ok(request.type === "video.render" || request.type === "composition.render");
    this.lastRequest = request as HostedRenderRequest;
    return this.job as HostedRenderJob<TResult>;
  }

  async get<TResult>(): Promise<HostedRenderJob<TResult>> {
    this.reads += 1;
    if (this.reads >= 2) this.job = { id: "job-1", state: "succeeded", result: { output: "x.mp4" } };
    else this.job = { id: "job-1", state: "running", progress: { percent: 50 } };
    return this.job as HostedRenderJob<TResult>;
  }

  async cancel<TResult>(): Promise<HostedRenderJob<TResult>> {
    this.job = { id: "job-1", state: "cancelled" };
    return this.job as HostedRenderJob<TResult>;
  }
}

test("HostedRenderer submits, polls, and returns terminal jobs", async () => {
  const adapter = new FakeHostedAdapter();
  const renderer = new HostedRenderer(adapter);
  const submitted = await renderer.submit({ schemaVersion: 1, type: "video.render", payload: { source: "a.mp4" } });
  assert.equal(submitted.id, "job-1");
  const terminal = await renderer.wait<{ output: string }>(submitted.id, { pollIntervalMs: 1, timeoutMs: 100 });
  assert.equal(terminal.state, "succeeded");
  assert.equal(terminal.result?.output, "x.mp4");
});

test("HostedRenderer cancellation delegates to the adapter", async () => {
  const renderer = new HostedRenderer(new FakeHostedAdapter());
  const cancelled = await renderer.cancel("job-1");
  assert.equal(cancelled.state, "cancelled");
});


test("HostedRenderer submits normalized programmable composition requests", async () => {
  const adapter = new FakeHostedAdapter();
  const renderer = new HostedRenderer(adapter);
  const submitted = await renderer.submitComposition(
    {
      schemaVersion: 1,
      bundle: { id: "bundle-42", manifest: "s3://render-bundles/bundle-42/vexa.bundle.json" },
      compositionId: "product-demo",
      target: { kind: "video", startFrame: 30, endFrameExclusive: 90, container: "mp4" },
      inputProps: { title: "Launch", nested: { enabled: true } },
      output: { artifactId: "product-demo/customer-42/render-7", destination: "s3://renders/output.mp4" }
    },
    { idempotencyKey: "customer-42-render-7" }
  );
  assert.equal(submitted.id, "job-1");
  assert.equal(adapter.lastRequest?.type, "composition.render");
  assert.equal(adapter.lastRequest?.idempotencyKey, "customer-42-render-7");
  assert.deepEqual(
    (adapter.lastRequest?.payload as { target?: unknown } | undefined)?.target,
    { kind: "video", startFrame: 30, endFrameExclusive: 90, container: "mp4" }
  );
});

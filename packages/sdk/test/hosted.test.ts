import assert from "node:assert/strict";
import test from "node:test";
import type { HostedRenderAdapter, HostedRenderJob, HostedRenderRequest } from "@moosky-video/core";
import { HostedRenderer } from "../src/hosted.js";

class FakeHostedAdapter implements HostedRenderAdapter {
  reads = 0;
  job: HostedRenderJob = { id: "job-1", state: "queued" };

  async submit<TPayload, TResult>(request: HostedRenderRequest<TPayload>): Promise<HostedRenderJob<TResult>> {
    assert.equal(request.type, "video.render");
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

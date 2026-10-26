import assert from "node:assert/strict";
import test from "node:test";
import { createHostedCompositionRenderRequest } from "@vexa-video/core";
import { JobQueue } from "@vexa-video/sdk";
import {
  registerHostedCompositionRenderWorker,
  type HostedCompositionWorkerResult
} from "../src/index.js";
import {
  fingerprintHostedCompositionPublication,
  type HostedCompositionPublicationReceipt
} from "../src/publication-recovery.js";

function request() {
  return createHostedCompositionRenderRequest({
    schemaVersion: 1,
    bundle: { id: "bundle-a", manifest: "provider://bundle-a/manifest.json" },
    compositionId: "Main",
    target: { kind: "video", container: "mp4" },
    inputProps: { title: "Launch", count: 2 },
    output: { artifactId: "customer/film-1", destination: "s3://renders/customer/film-1.mp4" }
  });
}

function fakeRenderer(onRender: () => void) {
  return {
    renderStill: async () => ({} as never),
    renderFrame: async () => ({} as never),
    renderFrameRange: async () => ({} as never),
    renderVideo: async () => { onRender(); return {} as never; }
  };
}

test("publication fingerprint is independent of object key order and changes with request content", () => {
  const first = request().payload;
  const same = { ...first, inputProps: { count: 2, title: "Launch" } };
  const different = { ...first, inputProps: { count: 3, title: "Launch" } };
  assert.equal(fingerprintHostedCompositionPublication(first), fingerprintHostedCompositionPublication(same));
  assert.notEqual(fingerprintHostedCompositionPublication(first), fingerprintHostedCompositionPublication(different));
  assert.match(fingerprintHostedCompositionPublication(first), /^[a-f0-9]{64}$/u);
});

test("retry recovers a recorded remote artifact without re-rendering or republishing", async () => {
  const queue = new JobQueue({ workerId: "receipt-worker" });
  const receipt = new Map<string, HostedCompositionPublicationReceipt>();
  let renderCount = 0;
  let publishCount = 0;
  let recordCount = 0;
  let lookupCount = 0;
  registerHostedCompositionRenderWorker(queue, {
    resolveManifest: () => "C:\\bundle\\manifest.json",
    resolveOutput: () => "C:\\renders\\film.mp4",
    createRenderer: async () => fakeRenderer(() => { renderCount += 1; }),
    lookupPublishedArtifact: (_output, _payload, context) => {
      lookupCount += 1;
      return receipt.get(context.fingerprint) ?? null;
    },
    publishArtifact: (_output, payload, context) => {
      publishCount += 1;
      assert.match(context.fingerprint, /^[a-f0-9]{64}$/u);
      return {
        url: payload.output.destination!,
        name: payload.output.artifactId,
        contentType: context.contentType
      };
    },
    recordPublishedArtifact: (saved, _output, _payload, context) => {
      recordCount += 1;
      assert.equal(saved.fingerprint, context.fingerprint);
      receipt.set(context.fingerprint, saved);
      // Simulate the provider persisting the receipt before the worker saves its job result.
      throw new Error("connection interrupted after durable receipt write");
    }
  });
  const hosted = request();
  const terminal = await queue.submit<typeof hosted.payload, HostedCompositionWorkerResult>(
    hosted.type, hosted.payload, {
      retry: { maxAttempts: 2, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 }
    }
  ).wait();
  assert.equal(terminal.state, "succeeded");
  assert.equal(terminal.attempt, 2);
  assert.equal(terminal.result?.artifact?.url, hosted.payload.output.destination);
  assert.equal(renderCount, 1);
  assert.equal(publishCount, 1);
  assert.equal(recordCount, 1);
  assert.equal(lookupCount, 2);
});

test("mismatched publication receipts fail closed without invoking the renderer", async () => {
  const queue = new JobQueue({ workerId: "receipt-mismatch" });
  let rendered = 0;
  registerHostedCompositionRenderWorker(queue, {
    resolveManifest: () => "C:\\bundle\\manifest.json",
    resolveOutput: () => "C:\\renders\\film.mp4",
    createRenderer: async () => fakeRenderer(() => { rendered += 1; }),
    lookupPublishedArtifact: () => ({
      fingerprint: "incorrect-fingerprint",
      artifact: { url: "s3://renders/someone-elses-film.mp4", name: "other", contentType: "video/mp4" }
    })
  });
  const hosted = request();
  const terminal = await queue.submit(hosted.type, hosted.payload).wait();
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.error?.code, "RENDER_ARTIFACT_PUBLISH_FAILED");
  assert.equal(rendered, 0);
});

test("remote lookup failures stop publication rather than silently replacing an artifact", async () => {
  const queue = new JobQueue({ workerId: "receipt-lookup-error" });
  let rendered = 0;
  registerHostedCompositionRenderWorker(queue, {
    resolveManifest: () => "C:\\bundle\\manifest.json",
    resolveOutput: () => "C:\\renders\\film.mp4",
    createRenderer: async () => fakeRenderer(() => { rendered += 1; }),
    lookupPublishedArtifact: () => { throw new Error("remote receipt store unavailable"); }
  });
  const hosted = request();
  const terminal = await queue.submit(hosted.type, hosted.payload).wait();
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.error?.code, "RENDER_ARTIFACT_PUBLISH_FAILED");
  assert.equal(rendered, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_COMPOSITION_RENDER_TYPE,
  createHostedCompositionRenderRequest
} from "@vexa-video/core";
import { JobQueue } from "@vexa-video/sdk";
import {
  VexaRendererError,
  registerHostedCompositionRenderWorker,
  type HostedCompositionWorkerResult
} from "../src/index.js";

function request(target: Parameters<typeof createHostedCompositionRenderRequest>[0]["target"]) {
  return createHostedCompositionRenderRequest(
    {
      schemaVersion: 1,
      bundle: {
        id: "bundle-1",
        manifest: "provider://bundle-1/vexa.bundle.json"
      },
      compositionId: "ProductDemo",
      target,
      inputProps: { title: "Launch", count: 2 },
      output: { artifactId: "customer/render-1" }
    },
    { idempotencyKey: "customer-render-1" }
  );
}

test("hosted composition worker maps all targets into the existing renderer contract", async () => {
  const calls: Array<{ method: string; options: Record<string, unknown> }> = [];
  const queue = new JobQueue({ workerId: "hosted-test" });

  registerHostedCompositionRenderWorker(queue, {
    resolveManifest(bundle) {
      assert.equal(bundle.id, "bundle-1");
      return "C:\\resolved\\vexa.bundle.json";
    },
    resolveOutput(output, payload) {
      return payload.target.kind === "frame-range"
        ? `C:\\renders\\${output.artifactId.replaceAll("/", "-")}`
        : `C:\\renders\\${output.artifactId.replaceAll("/", "-")}.${
            payload.target.kind === "video" ? "webm" : "png"
          }`;
    },
    createRenderer: async () => ({
      async renderStill(options) {
        calls.push({ method: "still", options: options as unknown as Record<string, unknown> });
        options.onProgress?.({
          target: "still",
          phase: "complete",
          completedFrames: 1,
          totalFrames: 1,
          percent: 100
        });
        return {} as never;
      },
      async renderFrame(options) {
        calls.push({ method: "frame", options: options as unknown as Record<string, unknown> });
        options.onProgress?.({
          target: "frame",
          phase: "complete",
          completedFrames: 1,
          totalFrames: 1,
          percent: 100
        });
        return {} as never;
      },
      async renderFrameRange(options) {
        calls.push({ method: "frame-range", options: options as unknown as Record<string, unknown> });
        options.onProgress?.({
          target: "frame-range",
          phase: "complete",
          completedFrames: options.endFrameExclusive - options.startFrame,
          totalFrames: options.endFrameExclusive - options.startFrame,
          percent: 100
        });
        return {} as never;
      },
      async renderVideo(options) {
        calls.push({ method: "video", options: options as unknown as Record<string, unknown> });
        options.onProgress?.({
          target: "video",
          phase: "complete",
          completedFrames: 20,
          totalFrames: 20,
          percent: 100
        });
        return {} as never;
      }
    })
  });

  const targets = [
    { kind: "still", format: "png" },
    { kind: "frame", frame: 7, format: "webp" },
    { kind: "frame-range", startFrame: 10, endFrameExclusive: 14, format: "jpeg" },
    { kind: "video", startFrame: 20, endFrameExclusive: 40, container: "webm" }
  ] as const;

  for (const [index, target] of targets.entries()) {
    const hosted = request(target);
    const handle = queue.submit<typeof hosted.payload, HostedCompositionWorkerResult>(
      hosted.type,
      hosted.payload,
      { idempotencyKey: `${hosted.idempotencyKey}-${index}` }
    );
    const terminal = await handle.wait();
    assert.equal(terminal.state, "succeeded");
    assert.equal(terminal.result?.artifactId, "customer/render-1");
    assert.equal(terminal.result?.target, target.kind);
    assert.equal(terminal.progress?.percent, 100);
  }

  assert.deepEqual(calls.map((call) => call.method), [
    "still",
    "frame",
    "frame-range",
    "video"
  ]);
  assert.equal(calls[1]!.options.frame, 7);
  assert.equal(calls[2]!.options.startFrame, 10);
  assert.equal(calls[2]!.options.endFrameExclusive, 14);
  assert.equal(calls[3]!.options.format, "webm");
  assert.deepEqual(calls[3]!.options.inputProps, { count: 2, title: "Launch" });
  assert.equal(calls[3]!.options.overwrite, true);
});

test("hosted composition worker preserves JobQueue cancellation semantics", async () => {
  const queue = new JobQueue({ workerId: "hosted-cancel-test" });
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });

  registerHostedCompositionRenderWorker(queue, {
    resolveManifest: () => "C:\\resolved\\vexa.bundle.json",
    resolveOutput: () => "C:\\renders\\cancelled.mp4",
    createRenderer: async () => ({
      renderStill: async () => ({} as never),
      renderFrame: async () => ({} as never),
      renderFrameRange: async () => ({} as never),
      async renderVideo(options) {
        resolveStarted();
        await new Promise<never>((_resolve, reject) => {
          const fail = () =>
            reject(new VexaRendererError("cancelled", "RENDER_ABORTED"));
          if (options.signal?.aborted) fail();
          else options.signal?.addEventListener("abort", fail, { once: true });
        });
        return {} as never;
      }
    })
  });

  const hosted = request({ kind: "video", container: "mp4" });
  assert.equal(hosted.type, HOSTED_COMPOSITION_RENDER_TYPE);
  const handle = queue.submit(hosted.type, hosted.payload);
  await started;
  assert.equal(handle.cancel(), true);

  const terminal = await handle.wait();
  assert.equal(terminal.state, "cancelled");
  assert.equal(terminal.cancellationRequested, true);
});

test("hosted composition worker validates provider resolvers before registration", () => {
  const queue = new JobQueue();
  assert.throws(
    () =>
      registerHostedCompositionRenderWorker(queue, {
        resolveManifest: undefined as never,
        resolveOutput: () => "out.mp4"
      }),
    /resolveManifest/
  );

  assert.throws(
    () =>
      registerHostedCompositionRenderWorker(queue, {
        resolveManifest: () => "bundle.json",
        resolveOutput: undefined as never
      }),
    /resolveOutput/
  );
});

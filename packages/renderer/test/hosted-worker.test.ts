import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HOSTED_COMPOSITION_RENDER_TYPE,
  createHostedCompositionRenderRequest
} from "@vexa-video/core";
import { JobQueue, Storage } from "@vexa-video/sdk";
import {
  VexaRendererError,
  registerHostedCompositionRenderWorker,
  type HostedCompositionWorkerResult
} from "../src/index.js";

function request(
  target: Parameters<typeof createHostedCompositionRenderRequest>[0]["target"],
  output: {
    destination?: string;
    contentType?: string;
  } = {}
) {
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
      output: {
        artifactId: "customer/render-1",
        ...output
      }
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

test("hosted composition worker publishes single-file destinations through Storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-hosted-artifact-"));
  try {
    const localOutput = join(root, "render.webm");
    const uploads: Array<{
      sourcePath: string;
      destination: string;
      overwrite: boolean | undefined;
    }> = [];
    const storage = new Storage({
      adapters: [
        Storage.s3({
          async download() {
            throw new Error("unused");
          },
          async upload(sourcePath, reference, options) {
            const bytes = (await readFile(sourcePath)).byteLength;
            const destination = `s3://${reference.bucket}/${reference.key}`;
            uploads.push({
              sourcePath,
              destination,
              overwrite: options.overwrite
            });
            return {
              provider: "s3",
              source: sourcePath,
              destination,
              destinationReference: reference,
              bytesTransferred: bytes,
              contentType: "video/webm"
            };
          }
        })
      ]
    });
    const queue = new JobQueue({ workerId: "hosted-publish-test" });

    registerHostedCompositionRenderWorker(queue, {
      resolveManifest: () => "C:\\resolved\\vexa.bundle.json",
      resolveOutput: () => localOutput,
      artifactStorage: storage,
      createRenderer: async () => ({
        renderStill: async () => ({} as never),
        renderFrame: async () => ({} as never),
        renderFrameRange: async () => ({} as never),
        async renderVideo(options) {
          await writeFile(options.output, "video");
          return {} as never;
        }
      })
    });

    const hosted = request(
      { kind: "video", container: "webm" },
      { destination: "s3://renders/customer/render-1.webm" }
    );
    const handle = queue.submit<typeof hosted.payload, HostedCompositionWorkerResult>(
      hosted.type,
      hosted.payload
    );
    const terminal = await handle.wait();

    assert.equal(terminal.state, "succeeded");
    assert.equal(terminal.result?.output, localOutput);
    assert.equal(
      terminal.result?.artifact?.url,
      "s3://renders/customer/render-1.webm"
    );
    assert.equal(terminal.result?.artifact?.name, "customer/render-1");
    assert.equal(terminal.result?.artifact?.contentType, "video/webm");
    assert.equal(terminal.result?.artifact?.sizeBytes, 5);
    assert.equal(terminal.progress?.phase, "complete");
    assert.deepEqual(uploads, [
      {
        sourcePath: localOutput,
        destination: "s3://renders/customer/render-1.webm",
        overwrite: true
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hosted composition worker uses a general publisher for frame-range destinations", async () => {
  const queue = new JobQueue({ workerId: "hosted-frame-range-publish-test" });
  let publishedLocalOutput = "";

  registerHostedCompositionRenderWorker(queue, {
    resolveManifest: () => "C:\\resolved\\vexa.bundle.json",
    resolveOutput: () => "C:\\renders\\customer-render-1",
    publishArtifact(output, payload, context) {
      publishedLocalOutput = context.localOutput;
      assert.equal(payload.target.kind, "frame-range");
      assert.equal(context.contentType, "application/zip");
      assert.equal(output.destination, "https://cdn.example.com/customer/render-1.zip");
      return {
        url: output.destination!,
        sizeBytes: 123
      };
    },
    createRenderer: async () => ({
      renderStill: async () => ({} as never),
      renderFrame: async () => ({} as never),
      async renderFrameRange() {
        return {} as never;
      },
      renderVideo: async () => ({} as never)
    })
  });

  const hosted = request(
    {
      kind: "frame-range",
      startFrame: 3,
      endFrameExclusive: 6,
      format: "png"
    },
    {
      destination: "https://cdn.example.com/customer/render-1.zip",
      contentType: "application/zip"
    }
  );
  const handle = queue.submit<typeof hosted.payload, HostedCompositionWorkerResult>(
    hosted.type,
    hosted.payload
  );
  const terminal = await handle.wait();

  assert.equal(terminal.state, "succeeded");
  assert.equal(publishedLocalOutput, "C:\\renders\\customer-render-1");
  assert.equal(
    terminal.result?.artifact?.url,
    "https://cdn.example.com/customer/render-1.zip"
  );
  assert.equal(terminal.result?.artifact?.name, "customer/render-1");
  assert.equal(terminal.result?.artifact?.contentType, "application/zip");
  assert.equal(terminal.result?.artifact?.sizeBytes, 123);
});

test("hosted composition worker fails closed when a destination has no publisher", async () => {
  const queue = new JobQueue({ workerId: "hosted-publish-required-test" });
  let rendererCreated = false;

  registerHostedCompositionRenderWorker(queue, {
    resolveManifest: () => "C:\\resolved\\vexa.bundle.json",
    resolveOutput: () => "C:\\renders\\render.mp4",
    createRenderer: async () => {
      rendererCreated = true;
      return {
        renderStill: async () => ({} as never),
        renderFrame: async () => ({} as never),
        renderFrameRange: async () => ({} as never),
        renderVideo: async () => ({} as never)
      };
    }
  });

  const hosted = request(
    { kind: "video", container: "mp4" },
    { destination: "s3://renders/customer/render-1.mp4" }
  );
  const handle = queue.submit<typeof hosted.payload, HostedCompositionWorkerResult>(
    hosted.type,
    hosted.payload
  );
  const terminal = await handle.wait();

  assert.equal(terminal.state, "failed");
  assert.equal(rendererCreated, false);
  assert.equal(terminal.error?.code, "RENDER_ARTIFACT_PUBLISH_FAILED");
  assert.match(terminal.error?.message ?? "", /artifactStorage or publishArtifact/);
});

test("hosted composition worker surfaces missing bundle resolution failures", async () => {
  const queue = new JobQueue({ workerId: "hosted-missing-bundle-test" });
  let rendererCreated = false;

  registerHostedCompositionRenderWorker(queue, {
    resolveManifest() {
      throw new Error("bundle manifest is unavailable");
    },
    resolveOutput: () => "C:\\renders\\missing-bundle.mp4",
    createRenderer: async () => {
      rendererCreated = true;
      return {
        renderStill: async () => ({} as never),
        renderFrame: async () => ({} as never),
        renderFrameRange: async () => ({} as never),
        renderVideo: async () => ({} as never)
      };
    }
  });

  const hosted = request({ kind: "video", container: "mp4" });
  const terminal = await queue
    .submit<typeof hosted.payload, HostedCompositionWorkerResult>(
      hosted.type,
      hosted.payload
    )
    .wait();

  assert.equal(terminal.state, "failed");
  assert.equal(rendererCreated, false);
  assert.match(terminal.error?.message ?? "", /bundle manifest is unavailable/);
});

test("hosted composition worker retries publication with stable artifact identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-hosted-retry-"));
  try {
    const localOutput = join(root, "retry.mp4");
    const resolverAttempts: number[] = [];
    const renderedOutputs: Array<{ output: string; overwrite: boolean | undefined }> = [];
    const uploads: Array<{
      sourcePath: string;
      destination: string;
      overwrite: boolean | undefined;
    }> = [];
    const storage = new Storage({
      adapters: [
        Storage.s3({
          async download() {
            throw new Error("unused");
          },
          async upload(sourcePath, reference, options) {
            const destination = `s3://${reference.bucket}/${reference.key}`;
            uploads.push({ sourcePath, destination, overwrite: options.overwrite });
            if (uploads.length === 1) throw new Error("temporary upload failure");
            return {
              provider: "s3",
              source: sourcePath,
              destination,
              destinationReference: reference,
              bytesTransferred: (await readFile(sourcePath)).byteLength,
              contentType: "video/mp4"
            };
          }
        })
      ]
    });
    const queue = new JobQueue({ workerId: "hosted-retry-test" });

    registerHostedCompositionRenderWorker(queue, {
      resolveManifest(_bundle, context) {
        resolverAttempts.push(context.attempt);
        return "C:\\resolved\\vexa.bundle.json";
      },
      resolveOutput: () => localOutput,
      artifactStorage: storage,
      createRenderer: async () => ({
        renderStill: async () => ({} as never),
        renderFrame: async () => ({} as never),
        renderFrameRange: async () => ({} as never),
        async renderVideo(options) {
          renderedOutputs.push({
            output: options.output,
            overwrite: options.overwrite
          });
          await writeFile(options.output, "video");
          return {} as never;
        }
      })
    });

    const hosted = request(
      { kind: "video", container: "mp4" },
      { destination: "s3://renders/customer/render-1.mp4" }
    );
    const handle = queue.submit<typeof hosted.payload, HostedCompositionWorkerResult>(
      hosted.type,
      hosted.payload,
      {
        idempotencyKey: hosted.idempotencyKey,
        retry: {
          maxAttempts: 2,
          backoffMs: 0,
          backoffMultiplier: 1,
          maxBackoffMs: 0
        }
      }
    );
    const terminal = await handle.wait();

    assert.equal(terminal.state, "succeeded");
    assert.equal(terminal.attempt, 2);
    assert.deepEqual(resolverAttempts, [1, 2]);
    assert.deepEqual(renderedOutputs, [
      { output: localOutput, overwrite: true },
      { output: localOutput, overwrite: true }
    ]);
    assert.deepEqual(uploads, [
      {
        sourcePath: localOutput,
        destination: "s3://renders/customer/render-1.mp4",
        overwrite: true
      },
      {
        sourcePath: localOutput,
        destination: "s3://renders/customer/render-1.mp4",
        overwrite: true
      }
    ]);
    assert.equal(terminal.result?.artifactId, "customer/render-1");
    assert.equal(
      terminal.result?.artifact?.url,
      "s3://renders/customer/render-1.mp4"
    );
    assert.equal(terminal.result?.artifact?.name, "customer/render-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

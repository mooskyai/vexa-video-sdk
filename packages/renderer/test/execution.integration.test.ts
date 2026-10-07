import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import { bundleCompositions } from "@vexa-video/bundler";
import { Storage } from "@vexa-video/sdk";
import {
  VexaCompositionRenderer,
  VexaRendererError,
  createCompositionRenderer,
  type VexaRenderProgress
} from "../src/index.js";
import type { VexaBundleManifest } from "@vexa-video/bundler";

function planningManifest(): VexaBundleManifest {
  return {
    schemaVersion: 1,
    mode: "development",
    entry: "compositions/entry.tsx",
    browserEntry: "index.js",
    environment: [],
    compositions: [{ id: "still-a", kind: "still", width: 100, height: 100 }],
    files: []
  };
}

async function createBundledRenderer(tempRoot: string): Promise<VexaCompositionRenderer> {
  const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const bundle = await bundleCompositions({
    rootDir: repoRoot,
    entry: "examples/visual-playground/compositions/entry.tsx",
    publicDir: "examples/visual-playground/compositions/public",
    outDir: join(tempRoot, "bundle"),
    mode: "development",
    sourceMap: "none"
  });
  return await VexaCompositionRenderer.fromManifest(bundle.manifestPath, {
    timeoutMs: 30_000
  });
}

test("manifest-object renderers stay planning-only until a bundle location is known", async () => {
  const renderer = createCompositionRenderer(planningManifest());
  await assert.rejects(
    () => renderer.renderStill({ compositionId: "still-a", output: "out/still.png" }),
    (error: unknown) =>
      error instanceof VexaRendererError && error.code === "RENDER_EXECUTABLE_BUNDLE_REQUIRED"
  );
});

test("composition Playground renderer controls remain valid JavaScript", async () => {
  const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const source = await readFile(
    join(repoRoot, "examples/visual-playground/public/bundler-workspace.js"),
    "utf8"
  );
  assert.doesNotThrow(() => new Script(source, { filename: "bundler-workspace.js" }));
  const responsiveSource = await readFile(
    join(repoRoot, "examples/visual-playground/public/workspace-responsive.js"),
    "utf8"
  );
  assert.doesNotThrow(() => new Script(responsiveSource, { filename: "workspace-responsive.js" }));
});

test("bundled executable compositions resolve storage assets and render stills, ranges, and video", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-render-execution-"));
  const stillOutput = join(tempRoot, "social-square.png");
  const frameOutput = join(tempRoot, "product-demo-frame.png");
  const storageFrameOutput = join(tempRoot, "product-demo-storage-frame.png");
  const rangeOutput = join(tempRoot, "product-demo-frames");
  const videoOutput = join(tempRoot, "product-demo.mp4");

  try {
    const renderer = await createBundledRenderer(tempRoot);

    const stillProgress: VexaRenderProgress[] = [];
    const still = await renderer.renderStill({
      compositionId: "social-square",
      output: stillOutput,
      inputProps: { background: "#14213d" },
      onProgress(progress) { stillProgress.push(progress); }
    });
    assert.equal(still.metadata.kind, "still");
    assert.equal(still.executionPlan.task, "project-frame-render");
    assert.deepEqual(stillProgress.map((progress) => progress.phase), ["starting", "complete"]);
    const png = await readFile(stillOutput);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const frame = await renderer.renderFrame({
      compositionId: "product-demo",
      frame: 12,
      output: frameOutput,
      format: "png",
      inputProps: { background: "#0b132b", fps: 24 }
    });
    assert.equal(frame.frame, 12);
    assert.equal(frame.metadata.kind, "video");
    assert.equal(frame.metadata.kind === "video" ? frame.metadata.fps : null, 24);
    assert.equal(frame.executionPlan.fps, 24);
    const framePng = await readFile(frameOutput);
    assert.deepEqual([...framePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const managedAssetRoot = join(tempRoot, "managed-render-assets");
    await mkdir(managedAssetRoot, { recursive: true });
    const storage = new Storage({
      workspaceRoot: managedAssetRoot,
      adapters: [
        Storage.adapter("custom", {
          async download(_reference, destination) {
            await copyFile(stillOutput, destination);
          }
        })
      ]
    });
    const storageFrame = await renderer.renderFrame({
      compositionId: "product-demo",
      frame: 13,
      output: storageFrameOutput,
      format: "png",
      inputProps: {
        background: "#0b132b",
        fps: 24,
        storageAssetKey: "fixture/product-art.png"
      },
      storage
    });
    assert.ok(
      storageFrame.executionPlan.inputs.some((input) => input.source.startsWith(managedAssetRoot)),
      "storage-backed scene assets should be materialized through the managed renderer workspace"
    );
    assert.deepEqual(await readdir(managedAssetRoot), []);
    const storageFramePng = await readFile(storageFrameOutput);
    assert.deepEqual([...storageFramePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const failedAssetRoot = join(tempRoot, "failed-render-assets");
    await mkdir(failedAssetRoot, { recursive: true });
    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "product-demo",
        frame: 14,
        output: join(tempRoot, "missing-storage-frame.png"),
        inputProps: {
          background: "#0b132b",
          fps: 24,
          storageAssetKey: "fixture/missing.png"
        },
        storage: new Storage({ workspaceRoot: failedAssetRoot })
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_ASSET_RESOLUTION_FAILED"
    );
    assert.deepEqual(await readdir(failedAssetRoot), []);

    const rangeProgress: VexaRenderProgress[] = [];
    const range = await renderer.renderFrameRange({
      compositionId: "product-demo",
      startFrame: 2,
      endFrameExclusive: 5,
      output: rangeOutput,
      format: "png",
      concurrency: 2,
      inputProps: { background: "#0b132b", fps: 24 },
      onProgress(progress) { rangeProgress.push(progress); }
    });
    assert.deepEqual(range.frames.map((item) => item.frame), [2, 3, 4]);
    assert.deepEqual(
      range.frames.map((item) => item.output.slice(-16)),
      ["frame-000002.png", "frame-000003.png", "frame-000004.png"]
    );
    assert.equal(rangeProgress.at(0)?.percent, 0);
    assert.equal(rangeProgress.at(-1)?.percent, 100);
    assert.equal(rangeProgress.at(-1)?.completedFrames, 3);
    for (const output of range.frames) {
      const contents = await readFile(output.output);
      assert.deepEqual([...contents.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }

    const videoProgress: VexaRenderProgress[] = [];
    const video = await renderer.renderVideo({
      compositionId: "product-demo",
      startFrame: 6,
      endFrameExclusive: 18,
      output: videoOutput,
      format: "mp4",
      inputProps: { background: "#0b132b", fps: 24 },
      hardwareAcceleration: "cpu",
      onProgress(progress) { videoProgress.push(progress); }
    });
    assert.equal(video.plan.frames.frameCount, 12);
    assert.equal(video.executionPlan.durationSeconds, 0.5);
    assert.equal(video.executionPlan.startFrame, 6);
    assert.equal(video.executionPlan.endFrameExclusive, 18);
    assert.equal(video.executionPlan.hardware?.selected, "cpu");
    assert.match(video.executionPlan.filterComplex, /trim=start_frame=6:end_frame=18/u);
    assert.equal(videoProgress.at(0)?.phase, "starting");
    assert.equal(videoProgress.at(-1)?.phase, "complete");
    assert.equal(videoProgress.at(-1)?.percent, 100);
    assert.ok(videoProgress.some((progress) => progress.media !== undefined));
    const mp4 = await readFile(videoOutput);
    assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("renderer maps AbortSignal cancellation to a typed renderer error", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-render-abort-"));
  try {
    const renderer = await createBundledRenderer(tempRoot);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "product-demo",
        frame: 0,
        output: join(tempRoot, "cancelled.png"),
        signal: controller.signal
      }),
      (error: unknown) => error instanceof VexaRendererError && error.code === "RENDER_ABORTED"
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("renderer maps FFmpeg timeout to a typed renderer error", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-render-timeout-"));
  try {
    const renderer = await createBundledRenderer(tempRoot);
    await assert.rejects(
      () => renderer.renderVideo({
        compositionId: "product-demo",
        startFrame: 0,
        endFrameExclusive: 60,
        output: join(tempRoot, "timeout.mp4"),
        timeoutMs: 1
      }),
      (error: unknown) => error instanceof VexaRendererError && error.code === "RENDER_TIMEOUT"
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

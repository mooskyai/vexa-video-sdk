import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import { Resvg } from "@resvg/resvg-js";
import { bundleCompositions } from "@vexa-video/bundler";
import { resolveDefaultFontFile } from "@vexa-video/ffmpeg";
import { Storage } from "@vexa-video/sdk";
import {
  VexaCompositionRenderer,
  VexaRendererError,
  createCompositionRenderer,
  type VexaRenderProgress,
  type VexaSurfaceRendererAdapter
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

async function createSurfaceBundledRenderer(tempRoot: string): Promise<VexaCompositionRenderer> {
  const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const fixtureRoot = join(repoRoot, "packages/renderer/test/fixtures/surface");
  const bundle = await bundleCompositions({
    rootDir: fixtureRoot,
    entry: "entry.ts",
    outDir: join(tempRoot, "surface-bundle"),
    mode: "development",
    sourceMap: "none"
  });
  return await VexaCompositionRenderer.fromManifest(bundle.manifestPath, { timeoutMs: 30_000 });
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
  const shapeFrameOutput = join(tempRoot, "shape-showcase-frame.png");
  const shapeRangeOutput = join(tempRoot, "shape-showcase-frames");
  const shapeVideoOutput = join(tempRoot, "shape-showcase.mp4");

  try {
    const renderer = await createBundledRenderer(tempRoot);

    const shapeFrame = await renderer.renderFrame({
      compositionId: "shape-showcase",
      frame: 8,
      output: shapeFrameOutput,
      format: "png",
      inputProps: { background: "#0f172a", unsupportedRotation: false }
    });
    const generatedInputs = shapeFrame.executionPlan.inputs.filter(
      (input) => input.kind === "image" && input.source.toLowerCase().endsWith(".png")
    );
    assert.equal(generatedInputs.length, 9);
    assert.equal(
      generatedInputs.filter((input) => /[\\/]primitives[\\/]/u.test(input.source)).length,
      2
    );
    assert.match(shapeFrame.executionPlan.filterComplex, /lutrgb=/u);
    const shapeFramePng = await readFile(shapeFrameOutput);
    assert.deepEqual([...shapeFramePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    for (const input of generatedInputs) {
      await assert.rejects(
        () => readFile(input.source),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
      );
    }

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "shape-showcase",
        frame: 8,
        output: join(tempRoot, "shape-showcase-unsupported.png"),
        inputProps: { background: "#0f172a", unsupportedRotation: true }
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_SHAPE_UNSUPPORTED"
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "shape-showcase",
        frame: 8,
        output: join(tempRoot, "shape-showcase-primitive-unsupported.png"),
        inputProps: {
          background: "#0f172a",
          unsupportedRotation: false,
          unsupportedPrimitiveRotation: true
        }
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_PRIMITIVE_UNSUPPORTED"
    );

    const shapeRange = await renderer.renderFrameRange({
      compositionId: "shape-showcase",
      startFrame: 8,
      endFrameExclusive: 10,
      output: shapeRangeOutput,
      concurrency: 2,
      inputProps: { background: "#0f172a", unsupportedRotation: false }
    });
    assert.deepEqual(shapeRange.frames.map((item) => item.frame), [8, 9]);
    for (const output of shapeRange.frames) {
      const contents = await readFile(output.output);
      assert.deepEqual([...contents.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }

    const shapeVideo = await renderer.renderVideo({
      compositionId: "shape-showcase",
      startFrame: 0,
      endFrameExclusive: 12,
      output: shapeVideoOutput,
      hardwareAcceleration: "cpu",
      inputProps: { background: "#0f172a", unsupportedRotation: false }
    });
    assert.equal(shapeVideo.executionPlan.inputs.filter(
      (input) => input.kind === "image" && input.source.toLowerCase().endsWith(".png")
    ).length, 9);
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_EFFECT_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_EFFECT_COMPOSITOR_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_SLIDE_TRANSITION_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_WIPE_TRANSITION_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_ZOOM_TRANSITION_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("PROGRAMMABLE_IRIS_TRANSITION_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("CAPTION_DRAW_TEXT_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("WORD_LEVEL_TIMING_MODEL"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("ACTIVE_WORD_CAPTION_GRAPH"));
    assert.ok(shapeVideo.executionPlan.optimizations.includes("SPEAKER_AWARE_CAPTION_GRAPH"));
    assert.match(shapeVideo.executionPlan.filterComplex, /drawtext=text='Vexa'/u);
    assert.match(shapeVideo.executionPlan.filterComplex, /drawtext=text='shapes'/u);
    assert.match(shapeVideo.executionPlan.filterComplex, /fontcolor=#38bdf8/u);
    assert.doesNotMatch(shapeVideo.executionPlan.filterComplex, /Vexa shapes/u);
    assert.equal(shapeVideo.executionPlan.durationSeconds, 1);
    const shapeMp4 = await readFile(shapeVideoOutput);
    assert.equal(shapeMp4.subarray(4, 8).toString("ascii"), "ftyp");

    const stillProgress: VexaRenderProgress[] = [];
    const still = await renderer.renderStill({
      compositionId: "social-square",
      output: stillOutput,
      inputProps: { background: "#14213d" },
      onProgress(progress) { stillProgress.push(progress); }
    });
    assert.equal(still.metadata.kind, "still");
    assert.equal(still.executionPlan.task, "project-frame-render");
    assert.match(still.executionPlan.filterComplex, /fontfile='/u);
    assert.match(still.executionPlan.filterComplex, /Composition captions/u);
    assert.deepEqual(stillProgress.map((progress) => progress.phase), ["starting", "complete"]);
    const png = await readFile(stillOutput);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const remoteFontFile = await resolveDefaultFontFile();
    assert.ok(remoteFontFile, "renderer integration requires a readable platform default font");
    let remoteFontCalls = 0;
    const remoteFontOutput = join(tempRoot, "social-square-remote-font.png");
    const remoteStill = await renderer.renderStill({
      compositionId: "social-square",
      output: remoteFontOutput,
      inputProps: {
        background: "#14213d",
        remoteFontProvider: "fixture-fonts",
        remoteFontFamily: "Fixture Sans"
      },
      fontAdapters: [{
        provider: "fixture-fonts",
        async resolveFont(reference, context) {
          remoteFontCalls += 1;
          assert.equal(reference.family, "Fixture Sans");
          assert.equal(reference.weight, 700);
          assert.equal(context.compositionId, "social-square");
          assert.equal(context.clipId, "font-readiness-title");
          return remoteFontFile;
        }
      }]
    });
    assert.equal(remoteFontCalls, 1);
    assert.match(remoteStill.executionPlan.filterComplex, /fontfile='/u);
    const remotePng = await readFile(remoteFontOutput);
    assert.deepEqual([...remotePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const remoteProps = {
      background: "#14213d",
      remoteFontProvider: "fixture-fonts",
      remoteFontFamily: "Fixture Sans"
    };

    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-remote-font-missing-adapter.png"),
        inputProps: { ...remoteProps, remoteFontProvider: "missing-provider" }
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_FONT_UNAVAILABLE" &&
        /No remote font adapter is registered/u.test(error.message)
    );

    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-remote-font-relative.png"),
        inputProps: remoteProps,
        fontAdapters: [{ provider: "fixture-fonts", resolveFont: () => "relative-font.ttf" }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_FONT_UNAVAILABLE" &&
        /absolute local font path/u.test(error.message)
    );

    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-remote-font-unreadable.png"),
        inputProps: remoteProps,
        fontAdapters: [{
          provider: "fixture-fonts",
          resolveFont: () => join(tempRoot, "missing-remote-font.ttf")
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_FONT_UNAVAILABLE"
    );

    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-remote-font-provider-failure.png"),
        inputProps: remoteProps,
        fontAdapters: [{
          provider: "fixture-fonts",
          resolveFont() { throw new Error("provider unavailable"); }
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_FONT_UNAVAILABLE" &&
        /provider unavailable/u.test(error.message)
    );

    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-remote-font-duplicate.png"),
        inputProps: remoteProps,
        fontAdapters: [
          { provider: "fixture-fonts", resolveFont: () => remoteFontFile },
          { provider: "fixture-fonts", resolveFont: () => remoteFontFile }
        ]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "INVALID_RENDERER_OPTIONS"
    );

    const abortedFontRender = new AbortController();
    abortedFontRender.abort();
    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-remote-font-aborted.png"),
        inputProps: remoteProps,
        signal: abortedFontRender.signal,
        fontAdapters: [{ provider: "fixture-fonts", resolveFont: () => remoteFontFile }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_ABORTED"
    );

    await assert.rejects(
      () => renderer.renderStill({
        compositionId: "social-square",
        output: join(tempRoot, "social-square-missing-font.png"),
        inputProps: {
          background: "#14213d",
          fontFile: join(tempRoot, "missing-font.ttf")
        }
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_FONT_UNAVAILABLE"
    );

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

test("surface renderer adapters materialize static SVG and PNG intent with timing and cleanup", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-surface-adapter-"));
  const workspaceRoot = join(tempRoot, "workspaces");
  const inactiveOutput = join(tempRoot, "surface-inactive.png");
  const activeOutput = join(tempRoot, "surface-active.png");
  const pngOutput = join(tempRoot, "surface-png-result.png");
  const videoOutput = join(tempRoot, "surface.mp4");

  try {
    await mkdir(workspaceRoot, { recursive: true });
    const renderer = await createSurfaceBundledRenderer(tempRoot);
    const storage = new Storage({ workspaceRoot });
    const calls: Array<{
      readonly compositionId: string;
      readonly nodeId: string;
      readonly absoluteStartFrame: number;
      readonly durationInFrames: number;
      readonly fps: number;
    }> = [];
    const adapter: VexaSurfaceRendererAdapter = {
      rendererId: "fixture.surface",
      renderSurface(surface, context) {
        assert.equal(surface.kind, "svg");
        assert.equal(surface.data?.label, "Surface adapter");
        assert.equal(surface.data?.fill, "#22c55e");
        calls.push({
          compositionId: context.compositionId,
          nodeId: context.nodeId,
          absoluteStartFrame: context.absoluteStartFrame,
          durationInFrames: context.durationInFrames,
          fps: context.fps
        });
        return {
          kind: "svg",
          svg: [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}">`,
            '<rect x="20" y="20" width="120" height="50" rx="8" fill="#22c55e" />',
            "</svg>"
          ].join("")
        };
      }
    };
    let pngCalls = 0;
    const pngAdapter: VexaSurfaceRendererAdapter = {
      rendererId: "fixture.surface",
      renderSurface(_surface, context) {
        pngCalls += 1;
        return {
          kind: "png",
          png: new Resvg(
            [
              `<svg xmlns="http://www.w3.org/2000/svg" width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}">`,
              '<rect x="36" y="18" width="92" height="56" rx="12" fill="#3b82f6" />',
              "</svg>"
            ].join(""),
            { font: { loadSystemFonts: false } }
          ).render().asPng()
        };
      }
    };
    const animatedPng = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 8, 97, 99, 84, 76,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0
    ]);

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-missing-adapter.png"),
        storage
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_SURFACE_UNAVAILABLE"
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-duplicate-adapter.png"),
        storage,
        surfaceAdapters: [adapter, adapter]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "INVALID_RENDERER_OPTIONS"
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-adapter-failure.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderSurface() { throw new Error("fixture adapter failed"); }
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_SURFACE_FAILED" &&
        /fixture adapter failed/u.test(error.message)
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-empty-svg.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderSurface: () => ({ kind: "svg", svg: "   " })
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_SURFACE_FAILED"
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-invalid-svg.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderSurface: () => ({ kind: "svg", svg: "not-svg" })
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_SURFACE_FAILED"
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-invalid-png.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderSurface: () => ({
            kind: "png",
            png: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
          })
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_SURFACE_FAILED" &&
        /invalid PNG bytes/u.test(error.message)
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-animated-png.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderSurface: () => ({ kind: "png", png: animatedPng })
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_SURFACE_FAILED" &&
        /animated PNG is not supported/u.test(error.message)
    );


    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-unsupported-transform.png"),
        storage,
        inputProps: { unsupportedRotation: true },
        surfaceAdapters: [adapter]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_SURFACE_UNSUPPORTED"
    );

    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-aborted.png"),
        storage,
        signal: aborted.signal,
        surfaceAdapters: [adapter]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "RENDER_ABORTED"
    );

    const inactive = await renderer.renderFrame({
      compositionId: "surface-showcase",
      frame: 2,
      output: inactiveOutput,
      storage,
      surfaceAdapters: [adapter]
    });
    const active = await renderer.renderFrame({
      compositionId: "surface-showcase",
      frame: 6,
      output: activeOutput,
      storage,
      surfaceAdapters: [adapter]
    });
    assert.notEqual(Buffer.compare(await readFile(inactiveOutput), await readFile(activeOutput)), 0);
    assert.match(active.executionPlan.filterComplex, /a='alpha\(X,Y\)\*/u);
    const activeSurfaceInput = active.executionPlan.inputs.find(
      (input) => input.kind === "image" && /[\\/]surfaces[\\/]/u.test(input.source)
    );
    if (!activeSurfaceInput) throw new Error("expected a renderer-owned surface image input");
    await assert.rejects(
      () => readFile(activeSurfaceInput.source),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );

    const pngFrame = await renderer.renderFrame({
      compositionId: "surface-showcase",
      frame: 6,
      output: pngOutput,
      storage,
      surfaceAdapters: [pngAdapter]
    });
    assert.equal(pngCalls, 1);
    assert.deepEqual(
      [...(await readFile(pngOutput)).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
    const pngSurfaceInput = pngFrame.executionPlan.inputs.find(
      (input) => input.kind === "image" && /[\\/]surfaces[\\/]/u.test(input.source)
    );
    if (!pngSurfaceInput) throw new Error("expected a renderer-owned PNG surface input");
    await assert.rejects(
      () => readFile(pngSurfaceInput.source),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );

    const video = await renderer.renderVideo({
      compositionId: "surface-showcase",
      startFrame: 0,
      endFrameExclusive: 12,
      output: videoOutput,
      storage,
      surfaceAdapters: [adapter],
      hardwareAcceleration: "cpu"
    });
    assert.equal(video.executionPlan.durationSeconds, 1.2);
    assert.ok(video.executionPlan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
    const videoSurfaceInput = video.executionPlan.inputs.find(
      (input) => input.kind === "image" && /[\\/]surfaces[\\/]/u.test(input.source)
    );
    if (!videoSurfaceInput) throw new Error("expected a renderer-owned surface video input");
    const mp4 = await readFile(videoOutput);
    assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp");
    await assert.rejects(
      () => readFile(videoSurfaceInput.source),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );

    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.compositionId, "surface-showcase");
      assert.equal(call.nodeId, "surface-card");
      assert.equal(call.absoluteStartFrame, 4);
      assert.equal(call.durationInFrames, 8);
      assert.equal(call.fps, 10);
    }
    assert.deepEqual(await readdir(workspaceRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("frame-aware surface adapters preserve authored animation timing and cleanup", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-surface-animation-"));
  const workspaceRoot = join(tempRoot, "workspaces");
  const frameOutput = join(tempRoot, "surface-animation-frame.png");
  const rangeOutput = join(tempRoot, "surface-animation-range");
  const videoOutput = join(tempRoot, "surface-animation.mp4");

  try {
    await mkdir(workspaceRoot, { recursive: true });
    const renderer = await createSurfaceBundledRenderer(tempRoot);
    const storage = new Storage({ workspaceRoot });

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-ambiguous-adapter.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderSurface: () => ({ kind: "svg", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" />" }),
          renderFrame: () => ({ kind: "svg", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" />" })
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError && error.code === "INVALID_RENDERER_OPTIONS"
    );

    await assert.rejects(
      () => renderer.renderFrame({
        compositionId: "surface-showcase",
        frame: 6,
        output: join(tempRoot, "surface-corrupt-animation-frame.png"),
        storage,
        surfaceAdapters: [{
          rendererId: "fixture.surface",
          renderFrame(_surface, context) {
            if (context.localFrame === 3) {
              return { kind: "png", png: Uint8Array.from([137, 80, 78, 71]) };
            }
            return {
              kind: "png",
              png: new Resvg(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${context.width}" height="${context.height}"><rect width="${context.width}" height="${context.height}" fill="#111827" /></svg>`,
                { font: { loadSystemFonts: false } }
              ).render().asPng()
            };
          }
        }]
      }),
      (error: unknown) =>
        error instanceof VexaRendererError &&
        error.code === "RENDER_SURFACE_FAILED" &&
        /invalid PNG bytes/u.test(error.message)
    );

    const calls: Array<{
      readonly localFrame: number;
      readonly absoluteFrame: number;
      readonly progress: number;
    }> = [];
    const adapter: VexaSurfaceRendererAdapter = {
      rendererId: "fixture.surface",
      renderFrame(surface, context) {
        assert.equal(surface.kind, "svg");
        calls.push({
          localFrame: context.localFrame,
          absoluteFrame: context.absoluteFrame,
          progress: context.progress
        });
        const x = 16 + context.localFrame * 10;
        return {
          kind: "png",
          png: new Resvg(
            [
              `<svg xmlns="http://www.w3.org/2000/svg" width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}">`,
              `<rect x="${x}" y="20" width="40" height="50" rx="8" fill="#f97316" />`,
              "</svg>"
            ].join(""),
            { font: { loadSystemFonts: false } }
          ).render().asPng()
        };
      }
    };

    const frame = await renderer.renderFrame({
      compositionId: "surface-showcase",
      frame: 6,
      output: frameOutput,
      storage,
      surfaceAdapters: [adapter]
    });
    const animatedFrameInput = frame.executionPlan.inputs.find(
      (input) =>
        input.kind === "video" &&
        /[\\/]surfaces[\\/]/u.test(input.source) &&
        input.source.toLowerCase().endsWith(".mov")
    );
    if (!animatedFrameInput) throw new Error("expected a renderer-owned animated surface input");
    assert.match(frame.executionPlan.filterComplex, /a='alpha\(X,Y\)\*/u);
    await assert.rejects(
      () => readFile(animatedFrameInput.source),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );

    const range = await renderer.renderFrameRange({
      compositionId: "surface-showcase",
      startFrame: 6,
      endFrameExclusive: 7,
      output: rangeOutput,
      storage,
      surfaceAdapters: [adapter]
    });
    assert.equal(range.frames.length, 1);
    assert.equal(range.frames[0]!.frame, 6);
    assert.equal(
      frame.executionPlan.filterComplex,
      range.frames[0]!.executionPlan.filterComplex
    );
    assert.deepEqual(
      [...(await readFile(range.frames[0]!.output)).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );

    const video = await renderer.renderVideo({
      compositionId: "surface-showcase",
      startFrame: 0,
      endFrameExclusive: 12,
      output: videoOutput,
      storage,
      surfaceAdapters: [adapter],
      hardwareAcceleration: "cpu"
    });
    assert.ok(video.executionPlan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
    const animatedVideoInput = video.executionPlan.inputs.find(
      (input) =>
        input.kind === "video" &&
        /[\\/]surfaces[\\/]/u.test(input.source) &&
        input.source.toLowerCase().endsWith(".mov")
    );
    if (!animatedVideoInput) throw new Error("expected an animated surface video input");
    const mp4 = await readFile(videoOutput);
    assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp");
    await assert.rejects(
      () => readFile(animatedVideoInput.source),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );

    assert.equal(calls.length, 24);
    for (let renderIndex = 0; renderIndex < 3; renderIndex += 1) {
      const renderCalls = calls.slice(renderIndex * 8, renderIndex * 8 + 8);
      assert.deepEqual(renderCalls.map((call) => call.localFrame), [0, 1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(renderCalls.map((call) => call.absoluteFrame), [4, 5, 6, 7, 8, 9, 10, 11]);
      assert.equal(renderCalls[0]?.progress, 0);
      assert.equal(renderCalls.at(-1)?.progress, 1);
    }
    assert.deepEqual(await readdir(workspaceRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("surface adapter execution stays outside core and normal SDK dependencies", async () => {
  const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  for (const packagePath of ["packages/core/package.json", "packages/sdk/package.json"]) {
    const manifest = JSON.parse(await readFile(join(repoRoot, packagePath), "utf8")) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly optionalDependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
      ...(manifest.peerDependencies ?? {})
    };
    assert.equal(dependencies["@vexa-video/renderer"], undefined);
    assert.equal(dependencies["@resvg/resvg-js"], undefined);
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

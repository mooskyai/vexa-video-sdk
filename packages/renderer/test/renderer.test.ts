import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  VexaCompositionRenderer,
  VexaRendererError,
  createCompositionRenderer
} from "../src/index.js";
import type { VexaBundleManifest } from "@vexa-video/bundler";

function manifest(): VexaBundleManifest {
  return {
    schemaVersion: 1,
    mode: "development",
    entry: "src/entry.tsx",
    browserEntry: "index.js",
    environment: [],
    compositions: [
      { id: "video-b", kind: "video", width: 1920, height: 1080, fps: 30, durationInFrames: 90 },
      { id: "still-a", kind: "still", width: 1080, height: 1080 }
    ],
    files: []
  };
}

function expectRendererError(fn: () => unknown, code: VexaRendererError["code"]): VexaRendererError {
  assert.throws(fn, (error: unknown) => error instanceof VexaRendererError && error.code === code);
  try {
    fn();
  } catch (error) {
    return error as VexaRendererError;
  }
  throw new Error("Expected renderer error.");
}

test("renderer lists bundle compositions in stable ID order", () => {
  const renderer = createCompositionRenderer(manifest());
  assert.deepEqual(renderer.listCompositions().map((item) => item.id), ["still-a", "video-b"]);
});

test("renderer selects compositions and returns typed missing-composition errors", () => {
  const renderer = createCompositionRenderer(manifest());
  assert.equal(renderer.requireComposition("video-b").kind, "video");
  const error = expectRendererError(
    () => renderer.requireComposition("missing"),
    "RENDER_COMPOSITION_NOT_FOUND"
  );
  assert.equal(error.compositionId, "missing");
});

test("still plans use one frame and image output", () => {
  const renderer = createCompositionRenderer(manifest());
  const plan = renderer.planStill({ compositionId: "still-a", output: "out/still.png" });
  assert.equal(plan.target, "still");
  assert.equal(plan.format, "png");
  assert.deepEqual(plan.frames, { startFrame: 0, endFrameExclusive: 1, frameCount: 1 });
});

test("still planning rejects video compositions", () => {
  const renderer = createCompositionRenderer(manifest());
  expectRendererError(
    () => renderer.planStill({ compositionId: "video-b", output: "out/still.png" }),
    "RENDER_KIND_MISMATCH"
  );
});

test("single-frame plans validate composition bounds", () => {
  const renderer = createCompositionRenderer(manifest());
  assert.equal(
    renderer.planFrame({ compositionId: "video-b", frame: 89, output: "out/frame.webp", format: "webp" }).frames.startFrame,
    89
  );
  expectRendererError(
    () => renderer.planFrame({ compositionId: "video-b", frame: 90, output: "out/frame.png" }),
    "RENDER_FRAME_OUT_OF_RANGE"
  );
});

test("still compositions expose only frame zero", () => {
  const renderer = createCompositionRenderer(manifest());
  assert.equal(renderer.planFrame({ compositionId: "still-a", frame: 0, output: "out/frame.png" }).frames.frameCount, 1);
  expectRendererError(
    () => renderer.planFrame({ compositionId: "still-a", frame: 1, output: "out/frame.png" }),
    "RENDER_FRAME_OUT_OF_RANGE"
  );
});

test("frame-range plans use an exclusive end frame", () => {
  const renderer = createCompositionRenderer(manifest());
  const plan = renderer.planFrameRange({
    compositionId: "video-b",
    startFrame: 10,
    endFrameExclusive: 20,
    output: "out/frames"
  });
  assert.deepEqual(plan.frames, { startFrame: 10, endFrameExclusive: 20, frameCount: 10 });
});

test("frame-range planning rejects invalid and still ranges", () => {
  const renderer = createCompositionRenderer(manifest());
  expectRendererError(
    () => renderer.planFrameRange({ compositionId: "video-b", startFrame: 20, endFrameExclusive: 20, output: "out/frames" }),
    "INVALID_RENDER_RANGE"
  );
  expectRendererError(
    () => renderer.planFrameRange({ compositionId: "still-a", startFrame: 0, endFrameExclusive: 1, output: "out/frames" }),
    "RENDER_KIND_MISMATCH"
  );
});

test("video plans default to the complete composition range", () => {
  const renderer = createCompositionRenderer(manifest());
  const plan = renderer.planVideo({ compositionId: "video-b", output: "out/video.mp4" });
  assert.equal(plan.format, "mp4");
  assert.deepEqual(plan.frames, { startFrame: 0, endFrameExclusive: 90, frameCount: 90 });
});

test("video plans can target a deterministic subrange", () => {
  const renderer = createCompositionRenderer(manifest());
  const plan = renderer.planVideo({
    compositionId: "video-b",
    startFrame: 15,
    endFrameExclusive: 45,
    output: "out/video.webm",
    format: "webm"
  });
  assert.deepEqual(plan.frames, { startFrame: 15, endFrameExclusive: 45, frameCount: 30 });
});

test("video planning rejects still compositions", () => {
  const renderer = createCompositionRenderer(manifest());
  expectRendererError(
    () => renderer.planVideo({ compositionId: "still-a", output: "out/video.mp4" }),
    "RENDER_KIND_MISMATCH"
  );
});

test("concurrency and timeout defaults are deterministic and overridable", () => {
  const renderer = createCompositionRenderer(manifest(), { concurrency: 3, timeoutMs: 9000 });
  const inherited = renderer.planVideo({ compositionId: "video-b", output: "out/video.mp4" });
  assert.equal(inherited.concurrency, 3);
  assert.equal(inherited.timeoutMs, 9000);
  const overridden = renderer.planVideo({
    compositionId: "video-b",
    output: "out/video.mp4",
    concurrency: 2,
    timeoutMs: 4000
  });
  assert.equal(overridden.concurrency, 2);
  assert.equal(overridden.timeoutMs, 4000);
});

test("render plans reject output extensions that do not match the selected format", () => {
  const renderer = createCompositionRenderer(manifest());
  expectRendererError(
    () => renderer.planVideo({ compositionId: "video-b", output: "out/video.png" }),
    "INVALID_RENDER_OUTPUT"
  );
  expectRendererError(
    () => renderer.planFrame({ compositionId: "video-b", frame: 0, output: "out/frame.mp4" }),
    "INVALID_RENDER_OUTPUT"
  );
});

test("invalid renderer options fail before execution", () => {
  expectRendererError(() => createCompositionRenderer(manifest(), { concurrency: 0 }), "INVALID_RENDERER_OPTIONS");
  const renderer = createCompositionRenderer(manifest());
  expectRendererError(
    () => renderer.planVideo({ compositionId: "video-b", output: "", timeoutMs: 0 }),
    "INVALID_RENDERER_OPTIONS"
  );
});

test("renderer can load a persisted Vexa bundle manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-renderer-"));
  const path = join(root, "vexa.bundle.json");
  try {
    await writeFile(path, `${JSON.stringify(manifest())}\n`, "utf8");
    const renderer = await VexaCompositionRenderer.fromManifest(path);
    assert.deepEqual(renderer.listCompositions().map((item) => item.id), ["still-a", "video-b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

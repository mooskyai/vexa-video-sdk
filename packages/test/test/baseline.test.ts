import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bundleCompositions } from "@vexa-video/bundler";
import { VexaCompositionRenderer } from "@vexa-video/renderer";
import {
  VexaVisualTestError,
  assertVisualCheckpointBaselines,
  comparePngSnapshotFiles,
  renderVisualCheckpoints,
  type VexaVisualCheckpoint
} from "../src/index.js";

interface BaselineManifest {
  readonly schemaVersion: 1;
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly tolerance: {
    readonly channelTolerance: number;
    readonly maxDifferentPixelRatio: number;
  };
  readonly checkpoints: readonly VexaVisualCheckpoint[];
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = join(testDirectory, "fixtures", "wipe-transition");
const baselineDirectory = join(testDirectory, "baselines", "wipe-transition");

async function readBaselineManifest(): Promise<BaselineManifest> {
  return JSON.parse(
    await readFile(join(baselineDirectory, "manifest.json"), "utf8")
  ) as BaselineManifest;
}

test("checked-in wipe baselines encode meaningful transition checkpoints", async () => {
  const manifest = await readBaselineManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.compositionId, "visual-wipe");
  assert.equal(manifest.width, 64);
  assert.equal(manifest.height, 36);
  assert.equal(manifest.fps, 10);
  assert.equal(manifest.durationInFrames, 12);
  assert.deepEqual(manifest.checkpoints, [
    { name: "start", frame: 0 },
    { name: "pre-transition", frame: 1 },
    { name: "transition-midpoint", frame: 4 },
    { name: "post-transition", frame: 6 },
    { name: "final-visible", frame: 10 }
  ]);

  const startVsPre = await comparePngSnapshotFiles(
    join(baselineDirectory, "start.png"),
    join(baselineDirectory, "pre-transition.png")
  );
  assert.equal(startVsPre.matches, true);

  const midpointVsStart = await comparePngSnapshotFiles(
    join(baselineDirectory, "transition-midpoint.png"),
    join(baselineDirectory, "start.png")
  );
  assert.equal(midpointVsStart.matches, false);
  assert.equal(midpointVsStart.differentPixelRatio, 0.5);

  const midpointVsPost = await comparePngSnapshotFiles(
    join(baselineDirectory, "transition-midpoint.png"),
    join(baselineDirectory, "post-transition.png")
  );
  assert.equal(midpointVsPost.matches, false);
  assert.equal(midpointVsPost.differentPixelRatio, 0.5);

  const postVsFinal = await comparePngSnapshotFiles(
    join(baselineDirectory, "post-transition.png"),
    join(baselineDirectory, "final-visible.png")
  );
  assert.equal(postVsFinal.matches, true);
});

test("visual checkpoint baseline assertion reports the named failing checkpoint", async () => {
  const manifest = await readBaselineManifest();
  const root = await mkdtemp(join(tmpdir(), "vexa-visual-baseline-helper-"));
  try {
    const outputs = [];
    for (const checkpoint of manifest.checkpoints) {
      const output = join(root, `${checkpoint.name}.png`);
      await copyFile(join(baselineDirectory, `${checkpoint.name}.png`), output);
      outputs.push({ ...checkpoint, output });
    }

    const comparisons = await assertVisualCheckpointBaselines(outputs, {
      baselineDirectory,
      ...manifest.tolerance
    });
    assert.equal(comparisons.length, manifest.checkpoints.length);
    assert.equal(comparisons.every((entry) => entry.comparison.matches), true);

    await copyFile(
      join(baselineDirectory, "post-transition.png"),
      outputs[2]!.output
    );
    await assert.rejects(
      assertVisualCheckpointBaselines(outputs, {
        baselineDirectory,
        ...manifest.tolerance
      }),
      (error: unknown) =>
        error instanceof VexaVisualTestError &&
        error.code === "VISUAL_SNAPSHOT_MISMATCH" &&
        /transition-midpoint/u.test(error.message)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real renderer frames match the checked-in wipe transition baselines", async () => {
  const manifest = await readBaselineManifest();
  const root = await mkdtemp(join(tmpdir(), "vexa-visual-baseline-real-"));
  try {
    const bundle = await bundleCompositions({
      entry: join(fixtureDirectory, "entry.ts"),
      rootDir: process.cwd(),
      outDir: join(root, "bundle"),
      mode: "development",
      sourceMap: "none"
    });
    const renderer = await VexaCompositionRenderer.fromManifest(bundle.manifestPath);
    const rendered = await renderVisualCheckpoints(renderer, {
      compositionId: manifest.compositionId,
      outputDirectory: join(root, "actual"),
      checkpoints: manifest.checkpoints
    });

    for (const checkpoint of rendered) {
      assert.equal(checkpoint.render.metadata.width, manifest.width);
      assert.equal(checkpoint.render.metadata.height, manifest.height);
      assert.equal(checkpoint.render.metadata.kind, "video");
      if (checkpoint.render.metadata.kind === "video") {
        assert.equal(checkpoint.render.metadata.fps, manifest.fps);
        assert.equal(checkpoint.render.metadata.durationInFrames, manifest.durationInFrames);
      }
    }

    const comparisons = await assertVisualCheckpointBaselines(rendered, {
      baselineDirectory,
      ...manifest.tolerance
    });
    assert.equal(comparisons.length, 5);
    assert.equal(comparisons.every((entry) => entry.comparison.matches), true);
    assert.deepEqual(
      comparisons.map((entry) => [entry.name, entry.frame]),
      manifest.checkpoints.map((checkpoint) => [checkpoint.name, checkpoint.frame])
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

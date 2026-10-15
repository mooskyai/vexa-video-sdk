import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { bundleCompositions } from "@vexa-video/bundler";
import { VexaCompositionRenderer } from "@vexa-video/renderer";
import {
  VexaVisualTestError,
  assertPngSnapshot,
  comparePngSnapshotFiles,
  comparePngSnapshots,
  renderVisualCheckpoints
} from "../src/index.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  // The comparator does not depend on CRC validation. Real renderer acceptance below
  // exercises standards-compliant PNGs emitted by FFmpeg.
  chunk.writeUInt32BE(0, 8 + data.length);
  return chunk;
}

function rgbaPng(width: number, height: number, rgba: readonly number[]): Buffer {
  assert.equal(rgba.length, width * height * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const outputOffset = row * (stride + 1);
    raw[outputOffset] = 0;
    Buffer.from(rgba.slice(row * stride, (row + 1) * stride)).copy(raw, outputOffset + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function expectVisualError(fn: () => unknown, code: VexaVisualTestError["code"]): VexaVisualTestError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof VexaVisualTestError);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error("Expected VexaVisualTestError.");
}

test("PNG snapshot comparison reports exact equality deterministically", () => {
  const snapshot = rgbaPng(2, 1, [
    10, 20, 30, 255,
    40, 50, 60, 255
  ]);
  const comparison = comparePngSnapshots(snapshot, snapshot);
  assert.deepEqual(comparison, {
    matches: true,
    dimensionsMatch: true,
    actualDimensions: { width: 2, height: 1 },
    expectedDimensions: { width: 2, height: 1 },
    totalPixels: 2,
    differentPixels: 0,
    differentPixelRatio: 0,
    maxChannelDelta: 0,
    channelTolerance: 0,
    maxDifferentPixelRatio: 0
  });
});

test("PNG snapshot tolerance separates channel noise from changed-pixel budget", () => {
  const expected = rgbaPng(2, 1, [
    10, 20, 30, 255,
    40, 50, 60, 255
  ]);
  const actual = rgbaPng(2, 1, [
    12, 20, 30, 255,
    80, 50, 60, 255
  ]);

  const strict = comparePngSnapshots(actual, expected, { channelTolerance: 2 });
  assert.equal(strict.matches, false);
  assert.equal(strict.differentPixels, 1);
  assert.equal(strict.differentPixelRatio, 0.5);
  assert.equal(strict.maxChannelDelta, 40);

  const ratioTolerant = comparePngSnapshots(actual, expected, {
    channelTolerance: 2,
    maxDifferentPixelRatio: 0.5
  });
  assert.equal(ratioTolerant.matches, true);
});

test("PNG comparison fails closed on dimensions and invalid tolerance values", () => {
  const onePixel = rgbaPng(1, 1, [0, 0, 0, 255]);
  const twoPixels = rgbaPng(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]);
  const dimensions = comparePngSnapshots(onePixel, twoPixels);
  assert.equal(dimensions.matches, false);
  assert.equal(dimensions.dimensionsMatch, false);
  assert.equal(dimensions.differentPixelRatio, 1);

  expectVisualError(
    () => comparePngSnapshots(onePixel, onePixel, { channelTolerance: 256 }),
    "INVALID_VISUAL_TEST_OPTIONS"
  );
  expectVisualError(
    () => comparePngSnapshots(onePixel, onePixel, { maxDifferentPixelRatio: -0.01 }),
    "INVALID_VISUAL_TEST_OPTIONS"
  );
});

test("PNG comparison rejects malformed or unsupported snapshots with typed errors", () => {
  expectVisualError(
    () => comparePngSnapshots(Buffer.from("not-png"), Buffer.from("not-png")),
    "INVALID_PNG_SNAPSHOT"
  );

  const interlaced = rgbaPng(1, 1, [1, 2, 3, 255]);
  // IHDR interlace byte: signature (8) + length/type (8) + IHDR byte 12.
  interlaced[28] = 1;
  expectVisualError(
    () => comparePngSnapshots(interlaced, interlaced),
    "INVALID_PNG_SNAPSHOT"
  );
});

test("assertPngSnapshot exposes the comparison when a regression exceeds tolerance", () => {
  const expected = rgbaPng(1, 1, [10, 20, 30, 255]);
  const actual = rgbaPng(1, 1, [11, 20, 30, 255]);
  const error = expectVisualError(
    () => assertPngSnapshot(actual, expected),
    "VISUAL_SNAPSHOT_MISMATCH"
  );
  assert.equal(error.comparison?.differentPixels, 1);
  assert.equal(error.comparison?.maxChannelDelta, 1);
});

test("visual checkpoint rendering preserves checkpoint order and rejects unsafe names", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-visual-checkpoints-unit-"));
  const calls: Array<{ frame: number; output: string; format?: string }> = [];
  const renderer = {
    async renderFrame(options: { frame: number; output: string; format?: "png" | "jpeg" | "webp" }) {
      calls.push(options);
      await writeFile(options.output, rgbaPng(1, 1, [options.frame, 0, 0, 255]));
      return {
        target: "frame" as const,
        output: options.output,
        frame: options.frame
      } as never;
    }
  };

  try {
    const checkpoints = await renderVisualCheckpoints(renderer, {
      compositionId: "fixture",
      outputDirectory: root,
      checkpoints: [
        { name: "start", frame: 0 },
        { name: "mid", frame: 5 }
      ]
    });
    assert.deepEqual(checkpoints.map((checkpoint) => [checkpoint.name, checkpoint.frame]), [
      ["start", 0],
      ["mid", 5]
    ]);
    assert.deepEqual(calls.map((call) => [call.frame, call.format]), [[0, "png"], [5, "png"]]);
    assert.equal((await readFile(checkpoints[0]!.output)).length > 0, true);

    await assert.rejects(
      renderVisualCheckpoints(renderer, {
        compositionId: "fixture",
        outputDirectory: root,
        checkpoints: [{ name: "../escape", frame: 0 }]
      }),
      (error: unknown) => error instanceof VexaVisualTestError && error.code === "INVALID_VISUAL_TEST_OPTIONS"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real renderer checkpoints produce repeatable PNG snapshots and detect visual prop changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-visual-checkpoints-real-"));
  try {
    const bundle = await bundleCompositions({
      entry: "packages/renderer/test/fixtures/acceptance/entry.tsx",
      rootDir: process.cwd(),
      outDir: join(root, "bundle"),
      mode: "development",
      sourceMap: "none"
    });
    const renderer = await VexaCompositionRenderer.fromManifest(bundle.manifestPath);

    const first = await renderVisualCheckpoints(renderer, {
      compositionId: "product-demo",
      outputDirectory: join(root, "first"),
      checkpoints: [
        { name: "start", frame: 0 },
        { name: "mid", frame: 150 }
      ],
      inputProps: { background: "#223344" }
    });
    const repeated = await renderVisualCheckpoints(renderer, {
      compositionId: "product-demo",
      outputDirectory: join(root, "repeated"),
      checkpoints: [{ name: "start", frame: 0 }],
      inputProps: { background: "#223344" }
    });
    const changed = await renderVisualCheckpoints(renderer, {
      compositionId: "product-demo",
      outputDirectory: join(root, "changed"),
      checkpoints: [{ name: "start", frame: 0 }],
      inputProps: { background: "#334455" }
    });

    const repeatComparison = await comparePngSnapshotFiles(first[0]!.output, repeated[0]!.output);
    assert.equal(repeatComparison.matches, true);
    assert.deepEqual(repeatComparison.actualDimensions, { width: 1920, height: 1080 });

    const changedComparison = await comparePngSnapshotFiles(first[0]!.output, changed[0]!.output);
    assert.equal(changedComparison.matches, false);
    assert.equal(changedComparison.differentPixelRatio, 1);
    assert.equal(changedComparison.maxChannelDelta > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ProcessAbortedError } from "@vexa-video/core";
import { resolveMediaBinaries, runProcess } from "@vexa-video/ffmpeg";
import {
  VEXA_GIF_SURFACE_RENDERER_ID,
  VexaGifAdapterError,
  createGifSurfaceAdapter
} from "../src/index.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

async function writePpm(path: string, rgb: readonly [number, number, number]): Promise<void> {
  const width = 16;
  const height = 16;
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = rgb[0];
    pixels[offset + 1] = rgb[1];
    pixels[offset + 2] = rgb[2];
  }
  await writeFile(path, Buffer.concat([header, pixels]));
}

async function createGifFixture(path: string): Promise<void> {
  const frames = join(dirname(path), "frames");
  await mkdir(frames, { recursive: true });
  await writePpm(join(frames, "frame-000000.ppm"), [255, 0, 0]);
  await writePpm(join(frames, "frame-000001.ppm"), [0, 0, 255]);
  const binaries = await resolveMediaBinaries();
  await runProcess(binaries.ffmpeg, [
    "-v", "error", "-y",
    "-framerate", "2",
    "-i", join(frames, "frame-%06d.ppm"),
    "-loop", "0",
    path
  ]);
}

function frameContext(localFrame: number) {
  return {
    compositionId: "gif-showcase",
    nodeId: "gif-card",
    width: 64,
    height: 64,
    fps: 2,
    absoluteStartFrame: 4,
    durationInFrames: 4,
    localFrame,
    absoluteFrame: 4 + localFrame,
    progress: localFrame / 3
  } as const;
}

test("GIF surface adapter renders deterministic frames, looping, and cleanup", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-gif-test-"));
  const gifPath = join(tempRoot, "two-frame.gif");
  const corruptPath = join(tempRoot, "corrupt.gif");
  const nonGifPath = join(tempRoot, "still.ppm");
  const workspaceRoot = join(tempRoot, "adapter-workspaces");
  try {
    await createGifFixture(gifPath);
    await writeFile(corruptPath, "not-a-gif");
    await writePpm(nonGifPath, [0, 255, 0]);

    await assert.rejects(
      async () => {
        createGifSurfaceAdapter({
          sources: { invalid: { path: gifPath, loop: "yes" as unknown as boolean } }
        });
      },
      (error: unknown) =>
        error instanceof VexaGifAdapterError && error.code === "INVALID_GIF_ADAPTER_OPTIONS"
    );

    const adapter = createGifSurfaceAdapter({
      sources: {
        spinner: "two-frame.gif",
        corrupt: "corrupt.gif",
        still: "still.ppm"
      },
      baseDirectory: tempRoot,
      workspaceRoot
    });
    assert.equal(adapter.rendererId, VEXA_GIF_SURFACE_RENDERER_ID);
    assert.equal(adapter.renderSurface, undefined);
    assert.equal(typeof adapter.renderFrame, "function");
    if (!adapter.renderFrame) throw new Error("expected GIF frame renderer");

    const surface = {
      kind: "gif" as const,
      rendererId: VEXA_GIF_SURFACE_RENDERER_ID,
      data: { sourceId: "spinner", fit: "contain", loop: true }
    };
    const first = await adapter.renderFrame(surface, frameContext(0));
    const second = await adapter.renderFrame(surface, frameContext(1));
    const looped = await adapter.renderFrame(surface, frameContext(2));
    assert.equal(first.kind, "png");
    assert.equal(second.kind, "png");
    assert.equal(looped.kind, "png");
    if (first.kind !== "png" || second.kind !== "png" || looped.kind !== "png") return;
    assert.deepEqual([...first.png.subarray(0, 8)], PNG_SIGNATURE);
    assert.deepEqual([...second.png.subarray(0, 8)], PNG_SIGNATURE);
    assert.notEqual(Buffer.compare(first.png, second.png), 0);
    assert.equal(Buffer.compare(first.png, looped.png), 0);

    const held = await adapter.renderFrame(
      { ...surface, data: { sourceId: "spinner", fit: "stretch", loop: false } },
      frameContext(3)
    );
    assert.equal(held.kind, "png");
    if (held.kind === "png") assert.equal(Buffer.compare(second.png, held.png), 0);

    await assert.rejects(
      async () => await adapter.renderFrame!({ ...surface, data: { sourceId: "missing" } }, frameContext(0)),
      (error: unknown) =>
        error instanceof VexaGifAdapterError && error.code === "GIF_SOURCE_UNAVAILABLE"
    );
    await assert.rejects(
      async () => await adapter.renderFrame!({ ...surface, data: { sourceId: "corrupt" } }, frameContext(0)),
      (error: unknown) =>
        error instanceof VexaGifAdapterError && error.code === "GIF_SOURCE_UNAVAILABLE"
    );
    await assert.rejects(
      async () => await adapter.renderFrame!({ ...surface, data: { sourceId: "still" } }, frameContext(0)),
      (error: unknown) =>
        error instanceof VexaGifAdapterError && error.code === "GIF_SOURCE_UNSUPPORTED"
    );
    await assert.rejects(
      async () => await adapter.renderFrame!({ ...surface, data: { sourceId: "spinner", fit: "tile" } }, frameContext(0)),
      (error: unknown) =>
        error instanceof VexaGifAdapterError && error.code === "INVALID_GIF_SURFACE_DATA"
    );

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      async () => await adapter.renderFrame!(surface, { ...frameContext(0), signal: controller.signal }),
      (error: unknown) => error instanceof ProcessAbortedError
    );

    assert.deepEqual(await readdir(workspaceRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GIF integration remains outside core and normal SDK dependencies", async () => {
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
    assert.equal(dependencies["@vexa-video/gif"], undefined);
  }
});

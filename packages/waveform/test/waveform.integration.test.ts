import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ProcessAbortedError } from "@vexa-video/core";
import { resolveMediaBinaries, runProcess } from "@vexa-video/ffmpeg";
import {
  VEXA_WAVEFORM_SURFACE_RENDERER_ID,
  VexaWaveformAdapterError,
  createWaveformSurfaceAdapter
} from "../src/index.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

async function createToneFixture(path: string): Promise<void> {
  const binaries = await resolveMediaBinaries();
  await runProcess(binaries.ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=48000:duration=0.5",
    "-c:a", "pcm_s16le",
    path
  ]);
}

async function writePpm(path: string): Promise<void> {
  const header = Buffer.from("P6\n2 2\n255\n", "ascii");
  const pixels = Buffer.from([
    255, 0, 0, 0, 255, 0,
    0, 0, 255, 255, 255, 255
  ]);
  await writeFile(path, Buffer.concat([header, pixels]));
}

function surfaceContext() {
  return {
    compositionId: "waveform-showcase",
    nodeId: "waveform-card",
    width: 320,
    height: 80,
    fps: 30,
    absoluteStartFrame: 0,
    durationInFrames: 30
  } as const;
}

test("waveform surface adapter renders deterministic PNG intent and cleans private workspaces", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "vexa-waveform-test-"));
  const tonePath = join(tempRoot, "tone.wav");
  const corruptPath = join(tempRoot, "corrupt.wav");
  const noAudioPath = join(tempRoot, "still.ppm");
  const workspaceRoot = join(tempRoot, "adapter-workspaces");
  try {
    await createToneFixture(tonePath);
    await writeFile(corruptPath, "not-audio");
    await writePpm(noAudioPath);

    assert.throws(
      () => createWaveformSurfaceAdapter({ sources: {} }),
      (error: unknown) =>
        error instanceof VexaWaveformAdapterError && error.code === "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );
    assert.throws(
      () => createWaveformSurfaceAdapter({
        sources: { tone: tonePath },
        color: "url(unsafe)"
      }),
      (error: unknown) =>
        error instanceof VexaWaveformAdapterError && error.code === "INVALID_WAVEFORM_ADAPTER_OPTIONS"
    );

    const adapter = createWaveformSurfaceAdapter({
      sources: {
        tone: "tone.wav",
        corrupt: "corrupt.wav",
        still: "still.ppm"
      },
      baseDirectory: tempRoot,
      workspaceRoot,
      color: "#38bdf8",
      background: "black@0"
    });
    assert.equal(adapter.rendererId, VEXA_WAVEFORM_SURFACE_RENDERER_ID);
    assert.equal(adapter.renderFrame, undefined);
    assert.equal(typeof adapter.renderSurface, "function");
    if (!adapter.renderSurface) throw new Error("expected waveform static renderer");

    const surface = {
      kind: "waveform" as const,
      rendererId: VEXA_WAVEFORM_SURFACE_RENDERER_ID,
      data: { sourceId: "tone" }
    };
    const first = await adapter.renderSurface(surface, surfaceContext());
    const repeated = await adapter.renderSurface(surface, surfaceContext());
    assert.equal(first.kind, "png");
    assert.equal(repeated.kind, "png");
    if (first.kind !== "png" || repeated.kind !== "png") return;
    assert.deepEqual([...first.png.subarray(0, 8)], PNG_SIGNATURE);
    assert.equal(Buffer.compare(first.png, repeated.png), 0);

    const overridden = await adapter.renderSurface(
      {
        ...surface,
        data: {
          sourceId: "tone",
          color: "#f97316",
          background: "#0b1220"
        }
      },
      surfaceContext()
    );
    assert.equal(overridden.kind, "png");
    if (overridden.kind === "png") {
      assert.notEqual(Buffer.compare(first.png, overridden.png), 0);
    }

    await assert.rejects(
      async () => await adapter.renderSurface!({ ...surface, data: { sourceId: "missing" } }, surfaceContext()),
      (error: unknown) =>
        error instanceof VexaWaveformAdapterError && error.code === "WAVEFORM_SOURCE_UNAVAILABLE"
    );
    await assert.rejects(
      async () => await adapter.renderSurface!({ ...surface, data: { sourceId: "corrupt" } }, surfaceContext()),
      (error: unknown) =>
        error instanceof VexaWaveformAdapterError && error.code === "WAVEFORM_SOURCE_UNAVAILABLE"
    );
    await assert.rejects(
      async () => await adapter.renderSurface!({ ...surface, data: { sourceId: "still" } }, surfaceContext()),
      (error: unknown) =>
        error instanceof VexaWaveformAdapterError && error.code === "WAVEFORM_SOURCE_UNSUPPORTED"
    );
    await assert.rejects(
      async () => await adapter.renderSurface!(
        { ...surface, data: { sourceId: "tone", color: "url(unsafe)" } },
        surfaceContext()
      ),
      (error: unknown) =>
        error instanceof VexaWaveformAdapterError && error.code === "INVALID_WAVEFORM_SURFACE_DATA"
    );

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      async () => await adapter.renderSurface!(surface, { ...surfaceContext(), signal: controller.signal }),
      (error: unknown) => error instanceof ProcessAbortedError
    );

    assert.deepEqual(await readdir(workspaceRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("waveform integration remains outside core and normal SDK dependencies", async () => {
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
    assert.equal(dependencies["@vexa-video/waveform"], undefined);
  }
});

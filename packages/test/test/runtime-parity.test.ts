import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createVexaPlayerController } from "@vexa-video/player";
import { createVexaStudioSession } from "@vexa-video/studio";
import {
  encodeWebVideoFrames,
  type VexaWebVideoEncodingRuntime,
  type VexaWebVideoFrameContext
} from "@vexa-video/web-renderer";
import {
  VexaRuntimeParityError,
  assertRuntimeCheckpointParity,
  createRuntimeCheckpointExpectations,
  type VexaRuntimeCheckpointObservation,
  type VexaRuntimeParityContract
} from "../src/index.js";

interface BaselineManifest extends VexaRuntimeParityContract {
  readonly schemaVersion: 1;
  readonly compositionId: string;
  readonly tolerance: {
    readonly channelTolerance: number;
    readonly maxDifferentPixelRatio: number;
  };
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const baselineDirectory = join(testDirectory, "baselines", "wipe-transition");

async function readBaselineManifest(): Promise<BaselineManifest> {
  return JSON.parse(
    await readFile(join(baselineDirectory, "manifest.json"), "utf8")
  ) as BaselineManifest;
}

function durationUs(fps: number): number {
  return Math.max(1, Math.round(1_000_000 / fps));
}

function playerObservations(manifest: BaselineManifest): readonly VexaRuntimeCheckpointObservation[] {
  const player = createVexaPlayerController({
    width: manifest.width,
    height: manifest.height,
    fps: manifest.fps,
    durationInFrames: manifest.durationInFrames,
    controls: "none"
  });
  try {
    return Object.freeze(manifest.checkpoints.map((checkpoint) => {
      player.seekToFrame(checkpoint.frame);
      const snapshot = player.getSnapshot();
      return Object.freeze({
        runtime: "player",
        name: checkpoint.name,
        frame: snapshot.presentedFrame,
        width: player.config.width,
        height: player.config.height,
        fps: player.config.fps,
        durationInFrames: player.config.durationInFrames,
        timestampUs: Math.round(snapshot.seconds * 1_000_000),
        durationUs: durationUs(player.config.fps)
      });
    }));
  } finally {
    player.dispose();
  }
}

function studioObservations(manifest: BaselineManifest): readonly VexaRuntimeCheckpointObservation[] {
  const session = createVexaStudioSession({
    compositions: [{
      schemaVersion: 1,
      kind: "video",
      id: manifest.compositionId,
      width: manifest.width,
      height: manifest.height,
      fps: manifest.fps,
      durationInFrames: manifest.durationInFrames,
      defaultProps: {}
    }]
  });
  try {
    return Object.freeze(manifest.checkpoints.map((checkpoint) => {
      const snapshot = session.seekFrame(checkpoint.frame);
      assert.equal(snapshot.resolvedMetadata.kind, "video");
      assert.ok(snapshot.player);
      if (snapshot.resolvedMetadata.kind !== "video" || snapshot.player === null) {
        throw new Error("Studio parity fixture requires video metadata and a Player snapshot.");
      }
      return Object.freeze({
        runtime: "studio",
        name: checkpoint.name,
        frame: snapshot.frame,
        width: snapshot.resolvedMetadata.width,
        height: snapshot.resolvedMetadata.height,
        fps: snapshot.resolvedMetadata.fps,
        durationInFrames: snapshot.resolvedMetadata.durationInFrames,
        timestampUs: Math.round(snapshot.player.seconds * 1_000_000),
        durationUs: durationUs(snapshot.resolvedMetadata.fps)
      });
    }));
  } finally {
    session.dispose();
  }
}

function fakeWebEncodingRuntime(): VexaWebVideoEncodingRuntime {
  return {
    createVideoFrame() {
      return { close() {} };
    },
    createVideoEncoder() {
      return {
        encodeQueueSize: 0,
        configure() {},
        encode() {},
        async flush() {},
        reset() {},
        close() {}
      };
    }
  };
}

async function browserRendererObservations(
  manifest: BaselineManifest
): Promise<readonly VexaRuntimeCheckpointObservation[]> {
  const checkpointsByFrame = new Map(manifest.checkpoints.map((checkpoint) => [checkpoint.frame, checkpoint] as const));
  const observations: VexaRuntimeCheckpointObservation[] = [];

  await encodeWebVideoFrames({
    plan: { kind: "browser", container: "mp4", videoCodec: "h264" },
    width: manifest.width,
    height: manifest.height,
    fps: manifest.fps,
    frameCount: manifest.durationInFrames,
    runtime: fakeWebEncodingRuntime(),
    renderFrame(context: VexaWebVideoFrameContext) {
      const checkpoint = checkpointsByFrame.get(context.frame);
      if (checkpoint !== undefined) {
        observations.push(Object.freeze({
          runtime: "browser-renderer",
          name: checkpoint.name,
          frame: context.frame,
          width: context.width,
          height: context.height,
          fps: context.fps,
          durationInFrames: context.frameCount,
          timestampUs: context.timestampUs,
          durationUs: context.durationUs
        }));
      }
      return {};
    }
  });

  return Object.freeze(observations);
}

test("runtime parity contract derives canonical frame timestamps and typed mismatches", () => {
  const contract: VexaRuntimeParityContract = {
    width: 64,
    height: 36,
    fps: 12,
    durationInFrames: 12,
    checkpoints: [
      { name: "start", frame: 0 },
      { name: "transition-midpoint", frame: 4 }
    ]
  };
  assert.deepEqual(createRuntimeCheckpointExpectations(contract), [
    {
      name: "start",
      frame: 0,
      width: 64,
      height: 36,
      fps: 12,
      durationInFrames: 12,
      timestampUs: 0,
      durationUs: 83_333
    },
    {
      name: "transition-midpoint",
      frame: 4,
      width: 64,
      height: 36,
      fps: 12,
      durationInFrames: 12,
      timestampUs: 333_333,
      durationUs: 83_333
    }
  ]);

  const observations: VexaRuntimeCheckpointObservation[] = [
    {
      runtime: "player",
      name: "start",
      frame: 0,
      width: 64,
      height: 36,
      fps: 12,
      durationInFrames: 12,
      timestampUs: 0,
      durationUs: 83_333
    },
    {
      runtime: "player",
      name: "transition-midpoint",
      frame: 4,
      width: 64,
      height: 36,
      fps: 12,
      durationInFrames: 12,
      timestampUs: 333_334,
      durationUs: 83_333
    }
  ];

  assert.throws(
    () => assertRuntimeCheckpointParity(contract, observations, { requiredRuntimes: ["player"] }),
    (error: unknown) =>
      error instanceof VexaRuntimeParityError &&
      error.code === "RUNTIME_PARITY_MISMATCH" &&
      error.comparison?.mismatches[0]?.runtime === "player" &&
      error.comparison.mismatches[0]?.name === "transition-midpoint" &&
      error.comparison.mismatches[0]?.field === "timestampUs"
  );

  assert.throws(
    () => assertRuntimeCheckpointParity(contract, observations.slice(0, 1), { requiredRuntimes: ["player"] }),
    (error: unknown) =>
      error instanceof VexaRuntimeParityError &&
      error.code === "RUNTIME_PARITY_MISMATCH" &&
      error.comparison?.mismatches[0]?.name === "transition-midpoint" &&
      error.comparison.mismatches[0]?.field === "observation"
  );
});

test("Player, Studio, and browser renderer share the reviewed wipe checkpoint timing contract", async () => {
  const manifest = await readBaselineManifest();
  const observations = [
    ...playerObservations(manifest),
    ...studioObservations(manifest),
    ...await browserRendererObservations(manifest)
  ];
  const comparison = assertRuntimeCheckpointParity(manifest, observations, {
    requiredRuntimes: ["player", "studio", "browser-renderer"]
  });

  assert.equal(comparison.matches, true);
  assert.equal(comparison.expectations.length, 5);
  assert.equal(comparison.observations.length, 15);
  assert.equal(comparison.mismatches.length, 0);
});

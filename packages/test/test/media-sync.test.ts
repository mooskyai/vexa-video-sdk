import assert from "node:assert/strict";
import test from "node:test";
import {
  VexaMediaSyncError,
  assertMediaDurationSync,
  compareMediaDurationSync
} from "../src/media-sync.js";

test("media duration sync derives the frame timeline and accepts bounded drift", () => {
  const comparison = compareMediaDurationSync(
    { fps: 10, durationInFrames: 12 },
    [
      { kind: "video", durationSeconds: 1.2 },
      { kind: "audio", durationSeconds: 1.21 }
    ],
    { durationToleranceSeconds: 0.02, audioVideoSkewToleranceSeconds: 0.02 }
  );

  assert.equal(comparison.expectedDurationSeconds, 1.2);
  assert.ok(Math.abs(comparison.maximumExpectedDurationDeltaSeconds - 0.01) < 1e-12);
  assert.ok(Math.abs((comparison.audioVideoSkewSeconds ?? 0) - 0.01) < 1e-12);
  assert.equal(comparison.durationMatches, true);
  assert.equal(comparison.syncMatches, true);
  assert.equal(comparison.matches, true);
  assert.deepEqual(comparison.observations.map((observation) => observation.kind), ["video", "audio"]);
});

test("media duration sync rejects invalid contracts and duplicate stream observations", () => {
  assert.throws(
    () => compareMediaDurationSync(
      { fps: 0, durationInFrames: 12 },
      [{ kind: "video", durationSeconds: 1.2 }]
    ),
    (error: unknown) =>
      error instanceof VexaMediaSyncError && error.code === "INVALID_MEDIA_SYNC_OPTIONS"
  );
  assert.throws(
    () => compareMediaDurationSync(
      { fps: 10, durationInFrames: 12 },
      [
        { kind: "audio", durationSeconds: 1.2 },
        { kind: "audio", durationSeconds: 1.2 }
      ]
    ),
    /duplicated/u
  );
  assert.throws(
    () => compareMediaDurationSync(
      { fps: 10, durationInFrames: 12 },
      [{ kind: "video", durationSeconds: 1.2 }],
      { durationToleranceSeconds: -0.01 }
    ),
    /durationToleranceSeconds/u
  );
});

test("media duration sync assertions distinguish duration drift from A/V skew", () => {
  assert.throws(
    () => assertMediaDurationSync(
      { fps: 10, durationInFrames: 12 },
      [
        { kind: "video", durationSeconds: 1.3 },
        { kind: "audio", durationSeconds: 1.3 }
      ],
      { durationToleranceSeconds: 0.02, audioVideoSkewToleranceSeconds: 0.02 }
    ),
    (error: unknown) =>
      error instanceof VexaMediaSyncError &&
      error.code === "MEDIA_DURATION_MISMATCH" &&
      error.comparison?.durationMatches === false
  );

  assert.throws(
    () => assertMediaDurationSync(
      { fps: 10, durationInFrames: 12 },
      [
        { kind: "video", durationSeconds: 1.16 },
        { kind: "audio", durationSeconds: 1.24 }
      ],
      { durationToleranceSeconds: 0.05, audioVideoSkewToleranceSeconds: 0.02 }
    ),
    (error: unknown) =>
      error instanceof VexaMediaSyncError &&
      error.code === "MEDIA_SYNC_MISMATCH" &&
      error.comparison?.durationMatches === true &&
      error.comparison.syncMatches === false
  );
});

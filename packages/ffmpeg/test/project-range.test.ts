import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProjectAst } from "@vexa-video/core";
import { createProjectRangeExecutionPlan } from "../src/index.js";

function project(withAudio = false): VideoProjectAst {
  return {
    schemaVersion: 1,
    id: "range-project",
    canvas: {
      width: 320,
      height: 180,
      fps: 30,
      duration: 2,
      background: "#112233"
    },
    tracks: withAudio
      ? [{
          id: "audio",
          type: "audio",
          clips: [{
            id: "audio-clip",
            kind: "audio",
            source: "audio.wav",
            start: 0,
            duration: 2
          }]
        }]
      : []
  };
}

test("project range plan preserves exclusive frame bounds in the final video graph", () => {
  const plan = createProjectRangeExecutionPlan(
    project(),
    "out/range.mp4",
    15,
    45,
    { hardwareAcceleration: "cpu" }
  );

  assert.equal(plan.startFrame, 15);
  assert.equal(plan.endFrameExclusive, 45);
  assert.equal(plan.frameCount, 30);
  assert.equal(plan.durationSeconds, 1);
  assert.equal(plan.videoMap, "vexa_range_v");
  assert.match(plan.filterComplex, /trim=start_frame=15:end_frame=45/u);
  assert.ok(plan.optimizations.includes("FRAME_RANGE_TRIM"));
  assert.equal(plan.args.at(-1), "out/range.mp4");
  const durationIndex = plan.args.lastIndexOf("-t");
  assert.equal(plan.args[durationIndex + 1], "1");
});

test("project range plan trims audio to the equivalent frame-derived time range", () => {
  const plan = createProjectRangeExecutionPlan(
    project(true),
    "out/range.mp4",
    15,
    45,
    { hardwareAcceleration: "cpu" }
  );

  assert.equal(plan.audioMap, "vexa_range_a");
  assert.match(plan.filterComplex, /atrim=start=0\.5:end=1\.5/u);
  assert.ok(plan.args.includes("[vexa_range_v]"));
  assert.ok(plan.args.includes("[vexa_range_a]"));
});

test("project range plan rejects empty and out-of-bounds ranges", () => {
  assert.throws(
    () => createProjectRangeExecutionPlan(project(), "out/range.mp4", 20, 20),
    /must stay inside project/u
  );
  assert.throws(
    () => createProjectRangeExecutionPlan(project(), "out/range.mp4", 0, 61),
    /must stay inside project/u
  );
});

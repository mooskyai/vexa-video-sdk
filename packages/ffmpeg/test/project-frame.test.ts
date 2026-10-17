import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProjectAst } from "@vexa-video/core";
import { createProjectFrameExecutionPlan } from "../src/index.js";

function project(): VideoProjectAst {
  return {
    schemaVersion: 1,
    id: "frame-project",
    canvas: {
      width: 320,
      height: 180,
      fps: 30,
      duration: 2,
      background: "#112233"
    },
    tracks: []
  };
}

test("project frame plan renders one deterministic PNG frame", () => {
  const plan = createProjectFrameExecutionPlan(project(), "out/frame.png", 12);
  assert.equal(plan.task, "project-frame-render");
  assert.equal(plan.format, "png");
  assert.equal(plan.frame, 12);
  assert.equal(plan.videoMap, "frameout");
  assert.match(plan.filterComplex, /trim=start_frame=12:end_frame=13/u);
  assert.ok(plan.args.includes("-frames:v"));
  assert.ok(plan.args.includes("png"));
  assert.equal(plan.args.at(-1), "out/frame.png");
});

test("project frame plan supports JPEG and WebP output", () => {
  const jpeg = createProjectFrameExecutionPlan(project(), "out/frame.jpeg", 0);
  assert.equal(jpeg.format, "jpeg");
  assert.ok(jpeg.args.includes("mjpeg"));

  const webp = createProjectFrameExecutionPlan(project(), "out/frame.webp", 59);
  assert.equal(webp.format, "webp");
  assert.ok(webp.args.includes("libwebp"));
});

test("project frame plan validates frame bounds and image extensions", () => {
  assert.throws(() => createProjectFrameExecutionPlan(project(), "out/frame.png", 60), /outside project/);
  assert.throws(() => createProjectFrameExecutionPlan(project(), "out/frame.mp4", 0), /png, jpeg, or webp/);
});

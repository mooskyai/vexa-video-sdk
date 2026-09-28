import assert from "node:assert/strict";
import test from "node:test";
import { InvalidOperationError } from "@moosky-video/core";
import { Video } from "../src/video.js";

test("Video editing methods build an immutable operation pipeline", () => {
  const source = Video.load("input.mp4");
  const edited = source
    .trim({ start: 5, duration: 10 })
    .resize({ width: 1280, height: 720, fit: "cover" })
    .crop({ width: 720, height: 720 })
    .rotate({ degrees: 90 });

  assert.equal(source.operations.length, 0);
  assert.equal(edited.operations.length, 4);
  assert.deepEqual(edited.operations.map((operation) => operation.type), [
    "trim",
    "resize",
    "crop",
    "rotate"
  ]);
});

test("Video validates editing operations before running ffmpeg", () => {
  const video = Video.load("input.mp4");

  assert.throws(() => video.trim({ start: -1 }), InvalidOperationError);
  assert.throws(() => video.resize({ width: 0, height: 720 }), InvalidOperationError);
  assert.throws(() => video.crop({ width: 100, height: -1 }), InvalidOperationError);
  assert.throws(() => video.rotate({ degrees: Number.NaN }), InvalidOperationError);
});

test("Video currently rejects multiple trim operations to keep timeline semantics explicit", () => {
  const video = Video.load("input.mp4").trim({ start: 1, duration: 10 });
  assert.throws(() => video.trim({ start: 1 }), InvalidOperationError);
});

test("Video exposes a serializable normalized pipeline and can restore it", () => {
  const video = Video.load("input.mp4")
    .resize({ width: 1920, height: 1080 })
    .rotate({ degrees: -90 });

  const pipeline = video.pipeline;
  assert.deepEqual(pipeline, {
    schemaVersion: 1,
    source: "input.mp4",
    operations: [
      { type: "resize", options: { width: 1920, height: 1080, fit: "contain" } },
      { type: "rotate", options: { degrees: 270 } }
    ]
  });

  const restored = Video.fromPipeline(pipeline);
  assert.deepEqual(restored.pipeline, pipeline);
});

test("Video removes no-op operations from the normalized pipeline", () => {
  const video = Video.load("input.mp4")
    .trim({ start: 0 })
    .rotate({ degrees: 360 });

  assert.equal(video.operations.length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { VideoProject } from "../src/project.js";

test("VideoProject builds tracks and clips immutably", () => {
  const empty = VideoProject.create({ id: "demo", width: 1280, height: 720, fps: 30 });
  const withTrack = empty.addTrack({ id: "v1", type: "video", name: "Video 1" });
  const withClip = withTrack.addClip("v1", {
    id: "clip-1",
    kind: "video",
    source: "input.mp4",
    start: 0,
    duration: 5
  });

  assert.equal(empty.ast.tracks.length, 0);
  assert.equal(withTrack.ast.tracks[0]?.clips.length, 0);
  assert.equal(withClip.ast.tracks[0]?.clips.length, 1);
  assert.equal(withClip.durationSeconds, 5);
});

test("VideoProject serializes and restores the project AST", () => {
  const project = VideoProject.create({ id: "demo", width: 640, height: 360, duration: 4 })
    .addTrack({ id: "t1", type: "text" })
    .addClip("t1", {
      id: "title",
      kind: "text",
      text: "Hello",
      start: 1,
      duration: 2,
      style: { fontSize: 48 }
    });

  const restored = VideoProject.fromAst(project.ast);
  assert.deepEqual(restored.ast, project.ast);
});


test("VideoProject supports track state and z-order controls", () => {
  const project = VideoProject.create({ id: "tracks", width: 640, height: 360 })
    .addTrack({ id: "v1", type: "video", name: "Base" })
    .addTrack({ id: "v2", type: "video", name: "Overlay" })
    .updateTrack("v2", { hidden: true, locked: true })
    .moveTrack("v2", 0);

  assert.equal(project.ast.tracks[0]?.id, "v2");
  assert.equal(project.ast.tracks[0]?.hidden, true);
  assert.equal(project.ast.tracks[0]?.locked, true);
  assert.throws(
    () => project.addClip("v2", {
      id: "locked-clip",
      kind: "video",
      source: "input.mp4",
      start: 0,
      duration: 1
    }),
    /locked/
  );
});

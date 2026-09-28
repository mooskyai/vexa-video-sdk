import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProjectError,
  normalizeVideoProject,
  numericPropertyValueAt,
  projectDurationSeconds,
  type VideoProjectAst
} from "../src/index.js";

const project: VideoProjectAst = {
  schemaVersion: 1,
  id: "demo",
  name: "Demo",
  canvas: { width: 1280, height: 720, fps: 30, background: "black" },
  tracks: [
    {
      id: "v1",
      type: "video",
      clips: [
        {
          id: "clip-1",
          kind: "video",
          source: "one.mp4",
          start: 0,
          duration: 4,
          transform: { fit: "cover" }
        },
        {
          id: "clip-2",
          kind: "video",
          source: "two.mp4",
          start: 4,
          duration: 3
        }
      ]
    }
  ]
};

test("normalizeVideoProject produces deterministic defaults and duration", () => {
  const normalized = normalizeVideoProject(project);
  assert.equal(normalized.canvas.background, "black");
  assert.equal(normalized.tracks[0]?.muted, false);
  assert.equal(normalized.tracks[0]?.hidden, false);
  assert.equal(normalized.tracks[0]?.clips[0]?.enabled, true);
  assert.equal(normalized.tracks[0]?.clips[0]?.opacity, 1);
  assert.equal(projectDurationSeconds(normalized), 7);
});

test("normalizeVideoProject rejects track/clip kind mismatches", () => {
  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "a1",
        type: "audio",
        clips: [{ id: "bad", kind: "video", source: "one.mp4", start: 0, duration: 1 }]
      }]
    }),
    InvalidProjectError
  );
});

test("project schema normalizes animated keyframes and evaluates easing", () => {
  const normalized = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "v1",
      type: "video",
      clips: [{
        id: "animated",
        kind: "video",
        source: "one.mp4",
        start: 0,
        duration: 2,
        transform: {
          x: {
            value: 0,
            keyframes: [
              { time: 2, value: 200, easing: "linear" },
              { time: 1, value: 100, easing: "ease-in" }
            ]
          }
        }
      }]
    }]
  });

  const clip = normalized.tracks[0]?.clips[0];
  assert.equal(clip?.kind, "video");
  if (!clip || clip.kind !== "video") return;
  assert.deepEqual(
    typeof clip.transform?.x === "object"
      ? clip.transform.x.keyframes?.map((keyframe) => keyframe.time)
      : [],
    [1, 2]
  );
  assert.equal(
    numericPropertyValueAt(clip.transform?.x, 0.5, 0),
    25
  );
  assert.equal(
    numericPropertyValueAt(clip.transform?.x, 1.5, 0),
    150
  );
});

test("project rejects keyframes outside the clip duration", () => {
  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "v1",
        type: "video",
        clips: [{
          id: "bad-animation",
          kind: "video",
          source: "one.mp4",
          start: 0,
          duration: 1,
          transform: {
            x: { value: 0, keyframes: [{ time: 2, value: 100 }] }
          }
        }]
      }]
    }),
    /exceeds the clip duration/
  );
});

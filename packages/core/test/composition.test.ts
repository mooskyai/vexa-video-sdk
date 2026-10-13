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

test("project schema preserves programmable fade transitions and validates frame duration", () => {
  const normalized = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "v1",
      type: "video",
      clips: [{
        id: "programmable-fade",
        kind: "video",
        source: "one.mp4",
        start: 0,
        duration: 1,
        transitions: {
          in: { kind: "fade", durationInFrames: 15, easing: "ease-in" },
          out: { kind: "fade", durationInFrames: 10, easing: "ease-out" }
        }
      }]
    }]
  });

  assert.deepEqual(normalized.tracks[0]?.clips[0]?.transitions, {
    in: { kind: "fade", durationInFrames: 15, easing: "ease-in" },
    out: { kind: "fade", durationInFrames: 10, easing: "ease-out" }
  });

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "v1",
        type: "video",
        clips: [{
          id: "too-long",
          kind: "video",
          source: "one.mp4",
          start: 0,
          duration: 0.25,
          transitions: { in: { kind: "fade", durationInFrames: 10 } }
        }]
      }]
    }),
    /durationInFrames cannot exceed the clip duration/
  );

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "a1",
        type: "audio",
        clips: [{
          id: "audio-transition",
          kind: "audio",
          source: "audio.m4a",
          start: 0,
          duration: 1,
          transitions: { in: { kind: "fade", durationInFrames: 5 } }
        }]
      }]
    }),
    /cannot use programmable visual transitions on an audio track/
  );
});


test("project text typography normalizes deterministic styling and rejects invalid values", () => {
  const normalized = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa\nTypography",
        start: 0,
        duration: 2,
        style: {
          fontSize: 40,
          color: "white",
          fontFile: "fonts/Inter.ttf",
          textAlign: "right",
          lineSpacing: 6,
          stroke: { color: "black", width: 2 },
          shadow: { color: "#000000@0.5", offsetX: -3, offsetY: 4 },
          boxColor: "#111111@0.6",
          boxPadding: 10
        }
      }]
    }]
  });
  const clip = normalized.tracks[0]?.clips[0];
  assert.equal(clip?.kind, "text");
  assert.deepEqual(clip?.kind === "text" ? clip.style : undefined, {
    fontSize: 40,
    color: "white",
    fontFile: "fonts/Inter.ttf",
    textAlign: "right",
    lineSpacing: 6,
    stroke: { color: "black", width: 2 },
    shadow: { color: "#000000@0.5", offsetX: -3, offsetY: 4 },
    boxColor: "#111111@0.6",
    boxPadding: 10
  });

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "titles",
        type: "text",
        clips: [{
          id: "bad-align",
          kind: "text",
          text: "Vexa",
          start: 0,
          duration: 1,
          style: { textAlign: "justify" as never }
        }]
      }]
    }),
    /style.textAlign is not supported/
  );

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "titles",
        type: "text",
        clips: [{
          id: "bad-spacing",
          kind: "text",
          text: "Vexa",
          start: 0,
          duration: 1,
          style: { lineSpacing: 1.5 }
        }]
      }]
    }),
    /style.lineSpacing must be an integer/
  );

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "titles",
        type: "text",
        clips: [{
          id: "bad-shadow",
          kind: "text",
          text: "Vexa",
          start: 0,
          duration: 1,
          style: { shadow: { color: "black", offsetX: 0.5, offsetY: 1 } }
        }]
      }]
    }),
    /style.shadow offsets must be integers/
  );
});


test("project remote font references normalize deterministically and conflict with local font files", () => {
  const normalized = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "remote-title",
        kind: "text",
        text: "Remote",
        start: 0,
        duration: 1,
        style: {
          remoteFont: {
            provider: " fixture ",
            family: " Fixture Sans ",
            weight: 700,
            style: "italic"
          }
        }
      }]
    }]
  });
  const clip = normalized.tracks[0]?.clips[0];
  assert.equal(clip?.kind, "text");
  assert.deepEqual(clip?.kind === "text" ? clip.style?.remoteFont : undefined, {
    provider: "fixture",
    family: "Fixture Sans",
    weight: 700,
    style: "italic"
  });

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "titles",
        type: "text",
        clips: [{
          id: "font-conflict",
          kind: "text",
          text: "Conflict",
          start: 0,
          duration: 1,
          style: {
            fontFile: "local.ttf",
            remoteFont: { provider: "fixture", family: "Fixture Sans" }
          }
        }]
      }]
    }),
    /cannot combine fontFile with remoteFont/
  );

  assert.throws(
    () => normalizeVideoProject({
      ...project,
      tracks: [{
        id: "titles",
        type: "text",
        clips: [{
          id: "bad-remote-weight",
          kind: "text",
          text: "Remote",
          start: 0,
          duration: 1,
          style: { remoteFont: { provider: "fixture", family: "Fixture Sans", weight: 1001 } }
        }]
      }]
    }),
    /remoteFont.weight must be an integer between 1 and 1000/
  );
});

test("project captions normalize deterministically and contribute to inferred duration", () => {
  const normalized = normalizeVideoProject({
    schemaVersion: 1,
    id: "caption-project",
    canvas: { width: 320, height: 180, fps: 30 },
    captions: {
      schemaVersion: 1,
      format: "vtt",
      language: "en",
      cues: [
        {
          id: "second",
          start: 1,
          end: 2,
          text: "Second cue",
          words: [{ text: "Second", start: 1, end: 1.5 }, { text: "cue", start: 1.5, end: 2 }]
        },
        { id: "first", start: 0, end: 1, text: "First cue" }
      ]
    },
    tracks: []
  });

  assert.deepEqual(normalized.captions?.cues.map((cue) => cue.id), ["first", "second"]);
  assert.equal(normalized.captions?.cues[1]?.words?.length, 2);
  assert.equal(projectDurationSeconds(normalized), 2);

  assert.throws(
    () => normalizeVideoProject({
      ...normalized,
      canvas: { ...normalized.canvas, duration: 1.5 }
    }),
    /Caption cue "second" ends after the explicit project duration/
  );
});

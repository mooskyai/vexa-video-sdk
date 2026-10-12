import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVideoProject, type VideoProjectAst } from "../src/composition.js";
import { InvalidProjectError } from "../src/errors.js";

test("project image, video, and text clips normalize programmable effect chains", () => {
  const project = normalizeVideoProject({
    schemaVersion: 1,
    id: "effects",
    canvas: { width: 320, height: 180, fps: 30, duration: 1 },
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [{
          id: "video",
          kind: "video",
          source: "video.mp4",
          start: 0,
          duration: 1,
          effects: [
            { kind: "hue", degrees: -30 },
            { kind: "noise", amount: 0.2 }
          ]
        }]
      },
      {
        id: "image",
        type: "image",
        clips: [{
          id: "image",
          kind: "image",
          source: "image.png",
          start: 0,
          duration: 1,
          effects: [{ kind: "vignette", amount: 0.4 }]
        }]
      },
      {
        id: "text",
        type: "text",
        clips: [{
          id: "title",
          kind: "text",
          text: "Vexa",
          start: 0,
          duration: 1,
          effects: [{ kind: "shadow", offsetX: 2, offsetY: 3, blur: 4, color: "black" }]
        }]
      }
    ]
  });

  const video = project.tracks[0]?.clips[0];
  const image = project.tracks[1]?.clips[0];
  const text = project.tracks[2]?.clips[0];
  assert.equal(video?.kind, "video");
  assert.equal(image?.kind, "image");
  assert.equal(text?.kind, "text");
  assert.deepEqual(video?.kind === "video" ? video.effects : undefined, [
    { kind: "hue", degrees: 330 },
    { kind: "noise", amount: 0.2, seed: 0, monochrome: false }
  ]);
  assert.deepEqual(image?.kind === "image" ? image.effects : undefined, [
    { kind: "vignette", amount: 0.4, softness: 0.5 }
  ]);
  assert.deepEqual(text?.kind === "text" ? text.effects : undefined, [
    { kind: "shadow", offsetX: 2, offsetY: 3, blur: 4, color: "black", opacity: 1 }
  ]);
  assert.equal(Object.isFrozen(video?.kind === "video" ? video.effects : undefined), true);
  assert.equal(Object.isFrozen(image?.kind === "image" ? image.effects?.[0] : undefined), true);
  assert.equal(Object.isFrozen(text?.kind === "text" ? text.effects?.[0] : undefined), true);
});

test("project effect normalization rejects invalid and non-visual effect intent", () => {
  const invalid: VideoProjectAst = {
    schemaVersion: 1,
    id: "invalid-effect",
    canvas: { width: 100, height: 100, fps: 30, duration: 1 },
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "image",
        kind: "image",
        source: "image.png",
        start: 0,
        duration: 1,
        effects: [{ kind: "grayscale", amount: 2 }]
      }]
    }]
  };
  assert.throws(
    () => normalizeVideoProject(invalid),
    (error: unknown) => error instanceof InvalidProjectError && /effects is invalid/u.test(error.message)
  );

  const nonVisual = {
    schemaVersion: 1,
    id: "audio-effect",
    canvas: { width: 100, height: 100, fps: 30, duration: 1 },
    tracks: [{
      id: "audio",
      type: "audio",
      clips: [{
        id: "voice",
        kind: "audio",
        source: "voice.wav",
        start: 0,
        duration: 1,
        effects: [{ kind: "blur", radius: 2 }]
      }]
    }]
  } as unknown as VideoProjectAst;
  assert.throws(
    () => normalizeVideoProject(nonVisual),
    (error: unknown) => error instanceof InvalidProjectError && /does not support programmable effects/u.test(error.message)
  );
});

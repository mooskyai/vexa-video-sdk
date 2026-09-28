import assert from "node:assert/strict";
import test from "node:test";
import { Audio } from "../src/audio.js";

test("Audio processing methods build an immutable pipeline", () => {
  const source = Audio.load("input.wav");
  const processed = source
    .trim({ start: 1, duration: 5 })
    .normalize()
    .fadeIn(0.25)
    .fadeOut(0.5)
    .channels("mono")
    .duckUnder({ sidechain: "voice.wav" });

  assert.equal(source.operations.length, 0);
  assert.deepEqual(processed.operations.map((operation) => operation.type), [
    "trim",
    "normalize",
    "fade-in",
    "fade-out",
    "channels",
    "duck-under"
  ]);
});

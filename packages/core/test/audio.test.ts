import assert from "node:assert/strict";
import test from "node:test";
import { InvalidOperationError } from "../src/errors.js";
import { normalizeAudioOperations, type AudioOperation } from "../src/audio.js";

test("normalizeAudioOperations applies deterministic audio defaults", () => {
  const operations: AudioOperation[] = [
    { type: "normalize", options: { targetLufs: -16, truePeakDb: -1.5, loudnessRange: 11 } },
    { type: "channels", options: { layout: "stereo" } },
    {
      type: "duck-under",
      options: {
        sidechain: "voice.wav",
        threshold: 0.1,
        ratio: 8,
        attackMs: 20,
        releaseMs: 250,
        sidechainGain: 1,
        mixSidechain: true
      }
    }
  ];

  assert.deepEqual(normalizeAudioOperations(operations), operations);
});

test("normalizeAudioOperations rejects duplicate singleton operations", () => {
  assert.throws(
    () => normalizeAudioOperations([
      { type: "normalize", options: { targetLufs: -16, truePeakDb: -1.5, loudnessRange: 11 } },
      { type: "normalize", options: { targetLufs: -14, truePeakDb: -1.5, loudnessRange: 11 } }
    ]),
    InvalidOperationError
  );

  assert.throws(
    () => normalizeAudioOperations([
      { type: "trim", options: { start: 0, duration: 1 } },
      { type: "trim", options: { start: 1, duration: 1 } }
    ]),
    InvalidOperationError
  );
});

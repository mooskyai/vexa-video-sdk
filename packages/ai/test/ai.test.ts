import assert from "node:assert/strict";
import test from "node:test";
import type { HighlightExtractionAdapter, SubjectTrackingAdapter, TranscriptionAdapter } from "../src/contracts.js";
import { VexaAI } from "../src/index.js";
import { createSilenceRemovalPlanFromRanges } from "../src/silence.js";

const transcriber: TranscriptionAdapter = {
  id: "test.transcriber",
  async transcribe() {
    return {
      text: "Hello world",
      language: "en",
      durationSeconds: 2,
      segments: [{
        id: "s1",
        start: 0.25,
        end: 1.75,
        text: "Hello world",
        words: [
          { text: "Hello", start: 0.25, end: 0.8, confidence: 0.99 },
          { text: "world", start: 0.85, end: 1.75, confidence: 0.98 }
        ]
      }]
    };
  }
};

test("transcription adapters generate normalized styled captions", async () => {
  const ai = new VexaAI({ transcription: transcriber });
  const result = await ai.captions("input.mp4", {
    template: "headline",
    style: { color: "yellow" }
  });
  assert.equal(result.transcription.language, "en");
  assert.equal(result.captions.cues.length, 1);
  assert.equal(result.captions.cues[0]?.text, "Hello world");
  assert.equal(result.captions.cues[0]?.words?.length, 2);
  assert.equal(result.captions.cues[0]?.style?.position, "center");
  assert.equal(result.captions.cues[0]?.style?.color, "yellow");
});

test("transcription validation rejects word timings outside their segment", async () => {
  const ai = new VexaAI({
    transcription: {
      id: "invalid",
      async transcribe() {
        return {
          text: "bad",
          segments: [{ start: 1, end: 2, text: "bad", words: [{ text: "bad", start: 0, end: 2 }] }]
        };
      }
    }
  });
  await assert.rejects(ai.transcribe("input.mp4"), /inside its transcript segment/u);
});

test("silence-removal planning compacts retained ranges into one project", () => {
  const plan = createSilenceRemovalPlanFromRanges(
    "input.mp4",
    10,
    1920,
    1080,
    30,
    [
      { start: 2, end: 4, duration: 2 },
      { start: 6, end: 7, duration: 1 }
    ],
    { paddingSeconds: 0, minimumKeepDuration: 0 }
  );
  assert.equal(plan.outputDurationSeconds, 7);
  assert.deepEqual(plan.kept.map((item) => [item.start, item.end]), [[0, 2], [4, 6], [7, 10]]);
  const clips = plan.project.tracks[0]?.clips ?? [];
  assert.deepEqual(clips.map((clip) => [clip.start, clip.duration, clip.kind === "video" ? clip.sourceStart : null]), [
    [0, 2, 0],
    [2, 2, 4],
    [4, 3, 7]
  ]);
});

const tracking: SubjectTrackingAdapter = {
  id: "test.tracker",
  async trackSubject(request) {
    return {
      source: request.source,
      durationSeconds: 4,
      adapterId: "test.tracker",
      regions: [
        { time: 0, x: 0.05, y: 0.2, width: 0.2, height: 0.5, confidence: 0.9 },
        { time: 2, x: 0.7, y: 0.2, width: 0.2, height: 0.5, confidence: 0.95 }
      ]
    };
  }
};

test("subject tracking results normalize and preserve adapter identity", async () => {
  const ai = new VexaAI({ tracking });
  const result = await ai.trackSubject("input.mp4");
  assert.equal(result.adapterId, "test.tracker");
  assert.equal(result.regions.length, 2);
  assert.equal(result.regions[1]?.confidence, 0.95);
});

const highlights: HighlightExtractionAdapter = {
  id: "test.highlights",
  async extractHighlights(request) {
    return {
      source: request.source,
      durationSeconds: 12,
      adapterId: "test.highlights",
      highlights: [
        { id: "low", start: 1, end: 3, score: 0.5 },
        { id: "high", start: 7, end: 10, score: 0.95, reason: "goal" }
      ]
    };
  }
};

test("highlight adapter output is normalized by descending score", async () => {
  const ai = new VexaAI({ highlights });
  const result = await ai.extractHighlights("input.mp4");
  assert.deepEqual(result.highlights.map((item) => item.id), ["high", "low"]);
});

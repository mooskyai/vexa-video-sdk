import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSegmentDuration,
  normalizeStreamingRenditions,
  resolveStreamingRenditions,
  streamingPreset
} from "../src/streaming.js";

test("streaming presets return deterministic adaptive ladders", () => {
  assert.deepEqual(streamingPreset("mobile").map((item) => item.id), ["240p", "360p"]);
  assert.deepEqual(resolveStreamingRenditions({ preset: "balanced" }).map((item) => item.id), ["240p", "360p", "720p"]);
  assert.deepEqual(streamingPreset("hd").map((item) => item.id), ["360p", "720p", "1080p"]);
});

test("custom streaming renditions are validated", () => {
  const result = normalizeStreamingRenditions([
    { id: "360p", width: 640, height: 360, videoBitrate: "800k" }
  ]);
  assert.equal(result[0]?.videoBitrate, "800k");
  assert.throws(() => normalizeStreamingRenditions([
    { id: "bad id", width: 641, height: 360, videoBitrate: "oops" }
  ]));
  assert.throws(() => normalizeStreamingRenditions([
    { id: "same", width: 640, height: 360, videoBitrate: "800k" },
    { id: "same", width: 1280, height: 720, videoBitrate: "2800k" }
  ]));
});

test("segment duration is bounded for predictable packaging", () => {
  assert.equal(normalizeSegmentDuration(undefined), 4);
  assert.equal(normalizeSegmentDuration(6), 6);
  assert.throws(() => normalizeSegmentDuration(0.5));
  assert.throws(() => normalizeSegmentDuration(31));
});

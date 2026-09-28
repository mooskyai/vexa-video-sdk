import assert from "node:assert/strict";
import test from "node:test";
import { Streaming } from "../src/streaming.js";

test("Streaming validates source and output directory eagerly", async () => {
  assert.throws(() => Streaming.load(""));
  const streaming = Streaming.load("input.mp4", { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" });
  await assert.rejects(() => streaming.planPackage("", { protocol: "hls" }));
});

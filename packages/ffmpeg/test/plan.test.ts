import assert from "node:assert/strict";
import test from "node:test";
import type { ProbeResult } from "@vexa-video/core";
import { IncompatibleOutputError, InvalidOperationError } from "@vexa-video/core";
import { createExportExecutionPlan } from "../src/plan.js";

const h264AacProbe: ProbeResult = {
  source: "input.mp4",
  format: "mov,mp4,m4a,3gp,3g2,mj2",
  durationSeconds: 12,
  sizeBytes: 1_000_000,
  bitRate: 700_000,
  video: {
    index: 0,
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: "yuv420p",
    bitRate: 550_000,
    rotation: 0
  },
  audio: {
    index: 1,
    codec: "aac",
    sampleRate: 48_000,
    channels: 2,
    channelLayout: "stereo",
    bitRate: 128_000
  },
  videoStreams: [],
  audioStreams: []
};

test("export plan automatically stream-copies compatible untouched media", () => {
  const plan = createExportExecutionPlan(
    "input.mp4",
    [],
    "output.mp4",
    {},
    h264AacProbe
  );

  assert.equal(plan.video?.mode, "copy");
  assert.equal(plan.audio?.mode, "copy");
  assert.deepEqual(plan.optimizations, ["VIDEO_STREAM_COPY", "AUDIO_STREAM_COPY"]);
  assert.deepEqual(plan.args, [
    "-y", "-i", "input.mp4", "-c:v", "copy", "-c:a", "copy", "output.mp4"
  ]);
});

test("export plan selects WebM-compatible codecs when transcoding is required", () => {
  const plan = createExportExecutionPlan(
    "input.mp4",
    [{ type: "resize", options: { width: 1280, height: 720 } }],
    "output.webm",
    {},
    h264AacProbe
  );

  assert.equal(plan.video?.selected, "vp9");
  assert.equal(plan.audio?.selected, "opus");
  assert.equal(plan.video?.mode, "encode");
  assert.deepEqual(plan.filters, [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black"
  ]);
  assert.ok(plan.optimizations.includes("SINGLE_PASS_FILTER_GRAPH"));
});

test("export plan rejects codec/container combinations outside the compatibility matrix", () => {
  assert.throws(
    () => createExportExecutionPlan(
      "input.mp4",
      [],
      "output.webm",
      { videoCodec: "h264" },
      h264AacProbe
    ),
    IncompatibleOutputError
  );
});

test("export plan rejects encoding options with stream copy", () => {
  assert.throws(
    () => createExportExecutionPlan(
      "input.mp4",
      [],
      "output.mp4",
      { videoCodec: "copy", pixelFormat: "yuv420p" },
      h264AacProbe
    ),
    InvalidOperationError
  );
});

test("execution plan JSON is deterministic for identical inputs", () => {
  const first = createExportExecutionPlan(
    "input.mp4",
    [{ type: "rotate", options: { degrees: -90 } }],
    "output.mp4",
    { crf: 20 },
    h264AacProbe
  );
  const second = createExportExecutionPlan(
    "input.mp4",
    [{ type: "rotate", options: { degrees: 270 } }],
    "output.mp4",
    { crf: 20 },
    h264AacProbe
  );

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("export plan uses NVENC when NVIDIA is explicitly available", () => {
  const capabilities = {
    schemaVersion: 1 as const,
    backend: "ffmpeg" as const,
    platform: "win32" as const,
    hwaccels: ["cuda"],
    encoders: ["h264_nvenc"],
    providers: [
      { provider: "nvidia" as const, available: true, runtimeAvailable: true, encoders: [{ provider: "nvidia" as const, codec: "h264" as const, encoder: "h264_nvenc", runtimeAvailable: true }] },
      { provider: "intel" as const, available: false, runtimeAvailable: false, encoders: [] },
      { provider: "amd" as const, available: false, runtimeAvailable: false, encoders: [] },
      { provider: "apple" as const, available: false, runtimeAvailable: false, encoders: [] }
    ]
  };
  const plan = createExportExecutionPlan(
    "input.mp4",
    [{ type: "resize", options: { width: 640, height: 360 } }],
    "output.mp4",
    { hardwareAcceleration: "nvidia", crf: 21, preset: "fast" },
    h264AacProbe,
    capabilities
  );
  assert.equal(plan.hardware?.selected, "nvidia");
  assert.match(plan.args.join(" "), /-c:v h264_nvenc/);
  assert.match(plan.args.join(" "), /-cq 21/);
  assert.ok(plan.optimizations.includes("NVIDIA_VIDEO_ENCODE"));
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ProbeResult } from "@vexa-video/core";
import { createPreviewSpritePlan, createStreamingExecutionPlan, normalizeHlsPlaylistText, previewSpriteVtt, streamingExecutionCwd } from "../src/streaming.js";

const probe: ProbeResult = {
  source: "input.mp4",
  format: "mov,mp4",
  durationSeconds: 12,
  sizeBytes: 1000,
  bitRate: 900000,
  video: { index: 0, codec: "h264", width: 1280, height: 720, fps: 30, pixelFormat: "yuv420p", bitRate: 800000, rotation: 0 },
  audio: { index: 1, codec: "aac", sampleRate: 48000, channels: 2, channelLayout: "stereo", bitRate: 128000 },
  videoStreams: [],
  audioStreams: []
};

test("HLS streaming plan builds a master adaptive ladder", () => {
  const plan = createStreamingExecutionPlan("input.mp4", "/tmp/hls", { protocol: "hls", preset: "mobile", segmentDuration: 4 }, probe);
  const joined = plan.args.join(" ");
  assert.equal(plan.manifestPath.endsWith("master.m3u8"), true);
  assert.equal(plan.renditions.length, 2);
  assert.match(joined, /-f hls/);
  assert.match(joined, /-var_stream_map/);
  assert.match(joined, /v:0,a:0/);
  assert.match(joined, /v:1,a:1/);
  assert.ok(plan.optimizations.includes("HLS_MASTER_PLAYLIST"));
});

test("DASH streaming plan builds video and audio adaptation sets", () => {
  const plan = createStreamingExecutionPlan("input.mp4", "/tmp/dash", { protocol: "dash", preset: "balanced", segmentDuration: 6 }, probe);
  const joined = plan.args.join(" ");
  assert.equal(plan.manifestPath.endsWith("manifest.mpd"), true);
  assert.equal(plan.renditions.length, 3);
  assert.match(joined, /-f dash/);
  assert.match(joined, /id=0,streams=v id=1,streams=a/);
  assert.match(joined, /-seg_duration 6/);
  assert.ok(plan.optimizations.includes("DASH_ADAPTATION_SETS"));
});

test("preview sprite plan emits a tiled image and WebVTT xywh cues", () => {
  const plan = createPreviewSpritePlan("input.mp4", "/tmp/sprite", { intervalSeconds: 5, tileWidth: 160, columns: 2 }, probe);
  assert.equal(plan.cues.length, 3);
  assert.equal(plan.rows, 2);
  assert.equal(plan.tileHeight, 90);
  assert.match(plan.args.join(" "), /tile=2x2/);
  const vtt = previewSpriteVtt(plan);
  assert.match(vtt, /WEBVTT/);
  assert.match(vtt, /sprite\.jpg#xywh=160,0,160,90/);
});


test("HLS playlist URI normalization converts Windows separators to portable slashes", () => {
  const playlist = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
    "v0\\index.m3u8",
    "#EXTINF:2.0,",
    "v0\\segment_00000.ts",
    ""
  ].join("\n");

  const normalized = normalizeHlsPlaylistText(playlist);
  assert.match(normalized, /v0\/index\.m3u8/u);
  assert.match(normalized, /v0\/segment_00000\.ts/u);
  assert.doesNotMatch(normalized, /\\/u);
});


test("DASH execution keeps relative segment templates inside the package directory", () => {
  const dash = createStreamingExecutionPlan("input.mp4", "C:/tmp/vexa-dash", { protocol: "dash", preset: "mobile" }, probe);
  const joined = dash.args.join(" ");
  assert.match(joined, /-init_seg_name init-\$RepresentationID\$\.m4s/u);
  assert.match(joined, /-media_seg_name chunk-\$RepresentationID\$-\$Number%05d\$\.m4s/u);
  assert.equal(streamingExecutionCwd(dash), "C:/tmp/vexa-dash");

  const hls = createStreamingExecutionPlan("input.mp4", "C:/tmp/vexa-hls", { protocol: "hls", preset: "mobile" }, probe);
  assert.equal(streamingExecutionCwd(hls), undefined);
});

test("adaptive streaming can select NVENC for all renditions", () => {
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
  const plan = createStreamingExecutionPlan(
    "input.mp4",
    "/tmp/hls-gpu",
    { protocol: "hls", preset: "mobile", hardwareAcceleration: "nvidia", hardwareFallback: false },
    probe,
    capabilities
  );
  assert.equal(plan.hardware?.selected, "nvidia");
  assert.match(plan.args.join(" "), /-c:v:0 h264_nvenc/);
  assert.match(plan.args.join(" "), /-c:v:1 h264_nvenc/);
  assert.ok(plan.optimizations.includes("NVIDIA_VIDEO_ENCODE"));
});

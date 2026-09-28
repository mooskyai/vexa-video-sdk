import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@vexa-video/ffmpeg";
import { FfmpegSceneDetector, parseFfmpegSceneMetadata } from "../src/scene.js";

const sample = `
[Parsed_metadata_1 @ 000] frame:0 pts:10240 pts_time:1
[Parsed_metadata_1 @ 000] lavfi.scene_score=0.400000
[Parsed_metadata_1 @ 000] frame:1 pts:20480 pts_time:2.5
[Parsed_metadata_1 @ 000] lavfi.scene_score=0.750000
`;

test("FFmpeg scene metadata parser returns timestamped scores", () => {
  assert.deepEqual(parseFfmpegSceneMetadata(sample), [
    { time: 1, score: 0.4 },
    { time: 2.5, score: 0.75 }
  ]);
});

test("built-in FFmpeg scene detector finds hard cuts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-ai-scenes-"));
  const input = join(workspace, "cuts.mp4");
  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=1",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=1",
      "-f", "lavfi", "-i", "color=c=green:s=160x90:r=10:d=1",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", input
    ]);
    const result = await new FfmpegSceneDetector().detectScenes({ source: input, threshold: 0.3 });
    assert.equal(result.adapterId, "ffmpeg.scene-detection");
    assert.ok(result.boundaries.length >= 2);
    assert.ok(Math.abs((result.boundaries[0]?.time ?? 0) - 1) < 0.15);
    assert.ok(Math.abs((result.boundaries[1]?.time ?? 0) - 2) < 0.15);
    assert.equal(result.scenes.length, result.boundaries.length + 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@moosky-video/ffmpeg";
import { Streaming } from "../src/streaming.js";

test("Streaming packages adaptive HLS/DASH and generates preview sprites", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-streaming-"));
  const input = join(workspace, "input.mp4");
  const hls = join(workspace, "hls");
  const dash = join(workspace, "dash");
  const sprite = join(workspace, "sprite");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input
    ]);

    const streaming = Streaming.load(input);
    const progress: number[] = [];
    const hlsResult = await streaming.package(hls, {
      protocol: "hls",
      preset: "mobile",
      segmentDuration: 2,
      onProgress(update) {
        if (update.percent !== null) progress.push(update.percent);
      }
    });
    const master = await readFile(hlsResult.manifestPath, "utf8");
    assert.match(master, /#EXTM3U/u);
    assert.match(master, /v0\/index\.m3u8/u);
    assert.match(master, /v1\/index\.m3u8/u);
    assert.ok(hlsResult.files.some((file) => /segment_\d+\.ts$/u.test(file)));
    assert.equal(progress.at(-1), 100);

    const dashResult = await streaming.package(dash, {
      protocol: "dash",
      segmentDuration: 2,
      renditions: [
        { id: "180p", width: 320, height: 180, videoBitrate: "300k", audioBitrate: "64k" },
        { id: "360p", width: 640, height: 360, videoBitrate: "700k", audioBitrate: "96k" }
      ]
    });
    const mpd = await readFile(dashResult.manifestPath, "utf8");
    assert.match(mpd, /<MPD/u);
    assert.match(mpd, /AdaptationSet/u);
    assert.ok(dashResult.files.some((file) => file.endsWith(".m4s")));

    const spriteResult = await streaming.previewSprite(sprite, {
      intervalSeconds: 1,
      tileWidth: 160,
      columns: 2
    });
    assert.ok((await stat(spriteResult.imagePath)).size > 0);
    const vtt = await readFile(spriteResult.vttPath, "utf8");
    assert.match(vtt, /WEBVTT/u);
    assert.match(vtt, /#xywh=/u);
    assert.equal(spriteResult.cues.length, 4);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

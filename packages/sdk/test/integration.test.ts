import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@vexa-video/ffmpeg";
import { Video } from "../src/video.js";

test("Video renders a chained edit pipeline and terminal outputs", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-video-sdk-"));
  const input = join(workspace, "input.mp4");
  const output = join(workspace, "output.mp4");
  const thumbnail = join(workspace, "thumbnail.jpg");
  const audio = join(workspace, "audio.m4a");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:sample_rate=48000",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      input
    ]);

    const progress = [] as number[];
    const edited = Video.load(input)
      .trim({ start: 0.5, duration: 1.5 })
      .resize({ width: 320, height: 180, fit: "cover" })
      .crop({ width: 160, height: 160 })
      .rotate({ degrees: 90 });

    await edited.export(output, {
      crf: 28,
      onProgress: (update) => {
        if (update.percent !== null) progress.push(update.percent);
      }
    });
    await edited.thumbnail(thumbnail, { at: 0.5, quality: 3 });
    await edited.extractAudio(audio, { bitrate: "96k" });

    const info = await Video.load(output).probe();
    assert.equal(info.video?.width, 160);
    assert.equal(info.video?.height, 160);
    assert.equal(Number(info.durationSeconds?.toFixed(1)), 1.5);
    assert.equal(progress.at(-1), 100);

    const thumbnailInfo = await Video.load(thumbnail).probe();
    assert.equal(thumbnailInfo.video?.width, 160);
    assert.equal(thumbnailInfo.video?.height, 160);

    const audioInfo = await Video.load(audio).probe();
    assert.equal(audioInfo.video, null);
    assert.equal(audioInfo.audio?.codec, "aac");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Video planner stream-copies untouched compatible MP4 media", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-video-sdk-plan-"));
  const input = join(workspace, "input.mp4");
  const output = join(workspace, "copy.mp4");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      input
    ]);

    const video = Video.load(input);
    const plan = await video.planExport(output);
    assert.equal(plan.video?.mode, "copy");
    assert.equal(plan.audio?.mode, "copy");
    assert.ok(plan.optimizations.includes("VIDEO_STREAM_COPY"));
    assert.ok(plan.optimizations.includes("AUDIO_STREAM_COPY"));

    await video.export(output);
    const info = await Video.load(output).probe();
    assert.equal(info.video?.codec, "h264");
    assert.equal(info.audio?.codec, "aac");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

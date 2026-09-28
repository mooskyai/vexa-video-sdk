import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@moosky-video/ffmpeg";
import { InvalidProjectError } from "@moosky-video/core";
import { VideoProject } from "../src/project.js";
import { Video } from "../src/video.js";

test("VideoProject renders sequential clips, mixed audio and text in one composition", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-project-"));
  const first = join(workspace, "first.mp4");
  const second = join(workspace, "second.mp4");
  const output = join(workspace, "project.mp4");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", first
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", second
    ]);

    const progress: number[] = [];
    const project = VideoProject.create({ id: "integration", width: 320, height: 180, fps: 30 })
      .addTrack({ id: "v1", type: "video" })
      .addTrack({ id: "t1", type: "text" })
      .addClip("v1", {
        id: "first",
        kind: "video",
        source: first,
        start: 0,
        duration: 2,
        transitions: { out: { type: "fade", duration: 0.2 } }
      })
      .addClip("v1", {
        id: "second",
        kind: "video",
        source: second,
        start: 2,
        duration: 2,
        transitions: { in: { type: "fade", duration: 0.2 } }
      })
      .addClip("t1", {
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0.5,
        duration: 1,
        transform: { x: 20, y: 20 },
        style: { fontSize: 28, color: "white" }
      });

    await project.render(output, {
      crf: 30,
      preset: "veryfast",
      onProgress(update) {
        if (update.percent !== null) progress.push(update.percent);
      }
    });

    const info = await Video.load(output).probe();
    assert.equal(info.video?.width, 320);
    assert.equal(info.video?.height, 180);
    assert.equal(info.video?.codec, "h264");
    assert.equal(info.audio?.codec, "aac");
    assert.equal(Number(info.durationSeconds?.toFixed(1)), 4);
    assert.equal(progress.at(-1), 100);

    const invalid = VideoProject.create({ id: "invalid-source-range", width: 320, height: 180 })
      .addTrack({ id: "v1", type: "video" })
      .addClip("v1", {
        id: "too-long",
        kind: "video",
        source: first,
        start: 0,
        sourceStart: 1,
        duration: 2
      });
    await assert.rejects(() => invalid.planRender(join(workspace, "invalid.mp4")), InvalidProjectError);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});


test("VideoProject renders image and standalone audio tracks", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-project-assets-"));
  const image = join(workspace, "card.png");
  const audio = join(workspace, "tone.m4a");
  const output = join(workspace, "assets.mp4");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=yellow:s=80x80",
      "-frames:v", "1", image
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
      "-t", "2", "-c:a", "aac", audio
    ]);

    const project = VideoProject.create({
      id: "assets",
      width: 320,
      height: 180,
      fps: 30,
      duration: 2,
      background: "black"
    })
      .addTrack({ id: "i1", type: "image" })
      .addTrack({ id: "a1", type: "audio" })
      .addClip("i1", {
        id: "image",
        kind: "image",
        source: image,
        start: 0.25,
        duration: 1.5,
        opacity: 0.7,
        transform: { x: 20, y: 40, width: 80, height: 80 },
        transitions: {
          in: { type: "fade", duration: 0.2 },
          out: { type: "fade", duration: 0.2 }
        }
      })
      .addClip("a1", {
        id: "audio",
        kind: "audio",
        source: audio,
        start: 0,
        duration: 2,
        volume: 0.5
      });

    await project.render(output, { crf: 30, preset: "veryfast" });
    const info = await Video.load(output).probe();
    assert.equal(info.video?.width, 320);
    assert.equal(info.video?.height, 180);
    assert.equal(info.audio?.codec, "aac");
    assert.equal(Number(info.durationSeconds?.toFixed(1)), 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

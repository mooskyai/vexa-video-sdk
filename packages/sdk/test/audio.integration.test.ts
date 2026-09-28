import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@vexa-video/ffmpeg";
import { Audio } from "../src/audio.js";
import { Video } from "../src/video.js";

test("Audio engine normalizes, maps channels, detects silence and generates waveform", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-audio-"));
  const input = join(workspace, "input.wav");
  const voice = join(workspace, "voice.wav");
  const processed = join(workspace, "processed.m4a");
  const ducked = join(workspace, "ducked.m4a");
  const waveform = join(workspace, "waveform.png");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
      "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
      "-map", "[a]", input
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=3",
      voice
    ]);

    const audio = Audio.load(input);
    const progress: number[] = [];
    await audio
      .normalize()
      .fadeIn(0.1)
      .fadeOut(0.1)
      .channels("mono")
      .export(processed, {
        bitrate: "128k",
        onProgress(update) {
          if (update.percent !== null) progress.push(update.percent);
        }
      });

    const processedInfo = await Video.load(processed).probe();
    assert.equal(processedInfo.video, null);
    assert.equal(processedInfo.audio?.codec, "aac");
    assert.equal(processedInfo.audio?.channels, 1);
    assert.equal(progress.at(-1), 100);

    const silence = await audio.detectSilence({ noiseDb: -35, minDuration: 0.4 });
    assert.ok(silence.ranges.some((range) => range.start < 1.2 && range.end > 1.8));

    await audio.waveform(waveform, { width: 600, height: 120 });
    const waveformInfo = await Video.load(waveform).probe();
    assert.equal(waveformInfo.video?.width, 600);
    assert.equal(waveformInfo.video?.height, 120);

    await audio.duckUnder({ sidechain: voice, threshold: 0.08, ratio: 8 }).export(ducked);
    const duckedInfo = await Video.load(ducked).probe();
    assert.equal(duckedInfo.audio?.codec, "aac");
    assert.equal(Number(duckedInfo.durationSeconds?.toFixed(1)), 3);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

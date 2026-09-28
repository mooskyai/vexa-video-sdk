import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@vexa-video/ffmpeg";
import { Captions, Video } from "../src/index.js";

test("Video burns parsed captions with styling and progress", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-captions-"));
  const input = join(workspace, "input.mp4");
  const output = join(workspace, "captioned.mp4");
  try {
    await runProcess("ffmpeg", ["-hide_banner","-loglevel","error","-y","-f","lavfi","-i","testsrc=size=320x180:rate=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","3","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest",input]);
    const parsed = Captions.parse("1\n00:00:00,500 --> 00:00:02,500\nVexa captions\n", "srt");
    const styled = Captions.applyTemplate(parsed,"subtitle",{ fontSize: 28, animation:"fade" });
    const progress:number[] = [];
    await Video.load(input).burnCaptions(styled,output,{ crf:28, onProgress(update){ if (update.percent != null) progress.push(update.percent); } });
    const info = await Video.load(output).probe();
    assert.equal(info.video?.width,320);
    assert.equal(info.video?.height,180);
    assert.equal(Number(info.durationSeconds?.toFixed(1)),3);
    assert.equal(progress.at(-1),100);
  } finally {
    await rm(workspace,{recursive:true,force:true});
  }
});

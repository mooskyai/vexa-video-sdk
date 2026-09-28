import assert from "node:assert/strict";
import test from "node:test";
import type { AudioOperation, ProbeResult } from "@vexa-video/core";
import {
  compileWaveformArgs,
  createAudioExecutionPlan,
  parseSilenceDetectOutput
} from "../src/audio.js";

const probe: ProbeResult = {
  source: "input.wav",
  format: "wav",
  durationSeconds: 10,
  sizeBytes: 1000,
  bitRate: 768000,
  video: null,
  audio: {
    index: 0,
    codec: "pcm_s16le",
    sampleRate: 48000,
    channels: 2,
    channelLayout: "stereo",
    bitRate: 768000
  },
  videoStreams: [],
  audioStreams: []
};

test("audio execution plan compiles normalization fades and channel mapping", () => {
  const operations: AudioOperation[] = [
    { type: "normalize", options: { targetLufs: -16, truePeakDb: -1.5, loudnessRange: 11 } },
    { type: "fade-in", options: { duration: 0.5 } },
    { type: "fade-out", options: { duration: 1 } },
    { type: "channels", options: { layout: "mono" } }
  ];
  const plan = createAudioExecutionPlan("input.wav", operations, "output.m4a", { bitrate: "160k" }, probe);
  assert.match(plan.filterComplex ?? "", /loudnorm=I=-16:TP=-1.5:LRA=11/);
  assert.match(plan.filterComplex ?? "", /afade=t=in:st=0:d=0.5/);
  assert.match(plan.filterComplex ?? "", /afade=t=out:st=9:d=1/);
  assert.deepEqual(plan.args.slice(-7), ["-c:a", "aac", "-b:a", "160k", "-ac", "1", "-t", "10", "output.m4a"].slice(-7));
  assert.ok(plan.optimizations.includes("LOUDNESS_NORMALIZATION"));
  assert.ok(plan.optimizations.includes("CHANNEL_MAPPING"));
});

test("audio execution plan compiles sidechain ducking and voice mix", () => {
  const operations: AudioOperation[] = [{
    type: "duck-under",
    options: {
      sidechain: "voice.wav",
      threshold: 0.08,
      ratio: 10,
      attackMs: 15,
      releaseMs: 300,
      sidechainGain: 1,
      mixSidechain: true
    }
  }];
  const plan = createAudioExecutionPlan("music.wav", operations, "mix.m4a", {}, probe);
  assert.deepEqual(plan.inputs, ["music.wav", "voice.wav"]);
  assert.match(plan.filterComplex ?? "", /sidechaincompress=/);
  assert.match(plan.filterComplex ?? "", /amix=inputs=2/);
  assert.ok(plan.optimizations.includes("SIDECHAIN_DUCKING"));
});

test("parseSilenceDetectOutput returns normalized silence ranges", () => {
  const stderr = [
    "[silencedetect] silence_start: 1.002",
    "[silencedetect] silence_end: 2.004 | silence_duration: 1.002"
  ].join("\n");
  assert.deepEqual(parseSilenceDetectOutput("input.wav", stderr, { noiseDb: -40, minDuration: 0.5 }, 3).ranges, [
    { start: 1.002, end: 2.004, duration: 1.002 }
  ]);
});

test("compileWaveformArgs creates a single-frame waveform image", () => {
  const args = compileWaveformArgs("input.wav", "waveform.png", { width: 600, height: 120 });
  assert.ok(args.some((arg) => arg.includes("showwavespic=s=600x120:colors=white")));
  assert.deepEqual(args.slice(-3), ["-frames:v", "1", "waveform.png"]);
});

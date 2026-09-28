import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "@vexa-video/ffmpeg";
import { Video } from "@vexa-video/sdk";
import type { HighlightExtractionAdapter, SubjectTrackingAdapter } from "../src/contracts.js";
import { createHighlightProject } from "../src/highlights.js";
import { createSmartReframePlan } from "../src/reframe.js";
import { planSilenceRemoval, removeSilence } from "../src/silence.js";

async function fixture(path: string): Promise<void> {
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path
  ]);
}

test("smart-reframe tracking hook produces animated project keyframes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-ai-reframe-"));
  const input = join(workspace, "input.mp4");
  try {
    await fixture(input);
    const tracker: SubjectTrackingAdapter = {
      id: "fake.tracker",
      async trackSubject(request) {
        return {
          source: request.source,
          durationSeconds: 4,
          adapterId: "fake.tracker",
          regions: [
            { time: 0, x: 0.05, y: 0.2, width: 0.25, height: 0.55 },
            { time: 2, x: 0.65, y: 0.2, width: 0.25, height: 0.55 },
            { time: 4, x: 0.4, y: 0.2, width: 0.25, height: 0.55 }
          ]
        };
      }
    };
    const plan = await createSmartReframePlan(input, tracker, { width: 360, height: 640 });
    assert.equal(plan.targetWidth, 360);
    assert.equal(plan.targetHeight, 640);
    assert.equal(plan.keyframes.length, 3);
    const clip = plan.project.tracks[0]?.clips[0];
    assert.equal(clip?.kind, "video");
    if (clip?.kind === "video") {
      assert.equal(typeof clip.transform?.x, "object");
      assert.equal(typeof clip.transform?.width, "object");
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("highlight hook creates a compact serializable project", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-ai-highlights-"));
  const input = join(workspace, "input.mp4");
  try {
    await fixture(input);
    const adapter: HighlightExtractionAdapter = {
      id: "fake.highlights",
      async extractHighlights(request) {
        return {
          source: request.source,
          durationSeconds: 4,
          adapterId: "fake.highlights",
          highlights: [
            { id: "a", start: 0.5, end: 1.5, score: 0.8 },
            { id: "b", start: 2, end: 3.5, score: 0.95 }
          ]
        };
      }
    };
    const result = await createHighlightProject(input, adapter, { gapSeconds: 0.25 });
    const clips = result.project.tracks[0]?.clips ?? [];
    assert.equal(clips.length, 2);
    assert.equal(clips[0]?.start, 0);
    assert.equal(clips[1]?.start, 1.25);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});


test("silence-removal helper detects a silent middle section and builds a shorter project", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-ai-silence-"));
  const input = join(workspace, "input.mp4");
  const output = join(workspace, "output.mp4");
  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:d=4",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=1",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:d=2",
      "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]",
      "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input
    ]);
    const plan = await planSilenceRemoval(input, {
      noiseDb: -45,
      minSilenceDuration: 0.5,
      paddingSeconds: 0.05,
      minimumKeepDuration: 0.1
    });
    assert.ok(plan.removed.length >= 1);
    assert.ok(plan.outputDurationSeconds < plan.originalDurationSeconds - 0.5);
    assert.ok((plan.project.tracks[0]?.clips.length ?? 0) >= 2);

    const renderedPlan = await removeSilence(input, output, {
      noiseDb: -45,
      minSilenceDuration: 0.5,
      paddingSeconds: 0.05,
      minimumKeepDuration: 0.1,
      render: { videoCodec: "h264", audioCodec: "aac", crf: 30 }
    });
    const metadata = await Video.load(output).probe();
    assert.ok((metadata.durationSeconds ?? 99) < 3.6);
    assert.ok(Math.abs((metadata.durationSeconds ?? 0) - renderedPlan.outputDurationSeconds) < 0.25);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

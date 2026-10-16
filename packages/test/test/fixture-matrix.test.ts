import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bundleCompositions } from "@vexa-video/bundler";
import { resolveMediaBinaries, runProcess } from "@vexa-video/ffmpeg";
import { VexaCompositionRenderer } from "@vexa-video/renderer";
import {
  assertMediaDurationSync,
  comparePngSnapshotFiles,
  renderVisualCheckpoints,
  type VexaMediaDurationObservation
} from "../src/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = join(testDirectory, "fixtures", "fixture-matrix");

async function runTool(command: string, args: readonly string[]): Promise<string> {
  const result = await runProcess(command, [...args], { timeoutMs: 30_000 });
  return result.stdout;
}

async function ffprobeStreams(
  ffprobePath: string,
  path: string
): Promise<readonly VexaMediaDurationObservation[]> {
  const output = await runTool(ffprobePath, [
    "-v", "error",
    "-show_entries", "stream=codec_type,duration",
    "-of", "json",
    path
  ]);
  const parsed = JSON.parse(output) as {
    readonly streams?: readonly { readonly codec_type?: string; readonly duration?: string }[];
  };
  const observations: VexaMediaDurationObservation[] = [];
  for (const stream of parsed.streams ?? []) {
    if (stream.codec_type !== "video" && stream.codec_type !== "audio") continue;
    const durationSeconds = Number(stream.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;
    observations.push({ kind: stream.codec_type, durationSeconds });
  }
  observations.sort((left, right) =>
    left.kind === right.kind ? 0 : left.kind === "video" ? -1 : 1
  );
  return observations;
}

async function generateAssets(
  ffmpegPath: string,
  root: string
): Promise<{
  readonly image: string;
  readonly video: string;
  readonly audio: string;
}> {
  const image = join(root, "fixture-image.png");
  const video = join(root, "fixture-video.mp4");
  const audio = join(root, "fixture-audio.wav");

  await runTool(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi",
    "-i", "color=c=0x22c55e:s=64x36:r=10:d=0.1",
    "-frames:v", "1",
    image
  ]);
  await runTool(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi",
    "-i", "testsrc2=size=64x36:rate=10:duration=1.2",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-g", "10",
    "-bf", "0",
    video
  ]);
  await runTool(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=48000:duration=1.2",
    "-c:a", "pcm_s16le",
    audio
  ]);
  return { image, video, audio };
}

test("deterministic fixture matrix covers shape/text, image, video, audio, captions, and props", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-v215-fixture-matrix-"));
  try {
    const binaries = await resolveMediaBinaries();
    const assets = await generateAssets(binaries.ffmpeg, root);
    const bundle = await bundleCompositions({
      entry: join(fixtureDirectory, "entry.ts"),
      rootDir: process.cwd(),
      outDir: join(root, "bundle"),
      mode: "development",
      sourceMap: "none"
    });
    const renderer = await VexaCompositionRenderer.fromManifest(bundle.manifestPath, {
      timeoutMs: 30_000
    });

    const shapeText = await renderVisualCheckpoints(renderer, {
      compositionId: "fixture-shape-text",
      outputDirectory: join(root, "shape-text"),
      checkpoints: [
        { name: "start", frame: 0 },
        { name: "shape-visible", frame: 4 },
        { name: "text-visible", frame: 10 }
      ]
    });
    const shapeDifference = await comparePngSnapshotFiles(shapeText[0]!.output, shapeText[1]!.output);
    const textDifference = await comparePngSnapshotFiles(shapeText[0]!.output, shapeText[2]!.output);
    assert.equal(shapeDifference.matches, false);
    assert.ok(shapeDifference.differentPixels > 0);
    assert.equal(textDifference.matches, false);
    assert.ok(textDifference.differentPixels > 0);

    const imageOutput = join(root, "image-frame.png");
    await renderer.renderFrame({
      compositionId: "fixture-image",
      frame: 5,
      output: imageOutput,
      resolvedAssets: { "image-source": assets.image }
    });
    const imageComparison = await comparePngSnapshotFiles(imageOutput, assets.image, {
      channelTolerance: 6,
      maxDifferentPixelRatio: 0.02
    });
    assert.equal(imageComparison.matches, true);

    const videoStart = join(root, "video-start.png");
    const videoStartRepeat = join(root, "video-start-repeat.png");
    const videoLate = join(root, "video-late.png");
    await renderer.renderFrame({
      compositionId: "fixture-video",
      frame: 0,
      output: videoStart,
      resolvedAssets: { "video-source": assets.video }
    });
    await renderer.renderFrame({
      compositionId: "fixture-video",
      frame: 0,
      output: videoStartRepeat,
      resolvedAssets: { "video-source": assets.video }
    });
    await renderer.renderFrame({
      compositionId: "fixture-video",
      frame: 8,
      output: videoLate,
      resolvedAssets: { "video-source": assets.video }
    });
    const videoRepeatComparison = await comparePngSnapshotFiles(videoStart, videoStartRepeat);
    assert.equal(videoRepeatComparison.matches, true);
    const videoTimingDifference = await comparePngSnapshotFiles(videoStart, videoLate, {
      channelTolerance: 6,
      maxDifferentPixelRatio: 0.02
    });
    assert.equal(videoTimingDifference.matches, false);

    const captionBefore = join(root, "caption-before.png");
    const captionDuring = join(root, "caption-during.png");
    await renderer.renderFrame({
      compositionId: "fixture-captions",
      frame: 1,
      output: captionBefore
    });
    await renderer.renderFrame({
      compositionId: "fixture-captions",
      frame: 5,
      output: captionDuring
    });
    const captionDifference = await comparePngSnapshotFiles(captionBefore, captionDuring);
    assert.equal(captionDifference.matches, false);
    assert.ok(captionDifference.differentPixels > 0);

    const defaultPropsOutput = join(root, "props-default.png");
    const overridePropsOutput = join(root, "props-override.png");
    await renderer.renderFrame({
      compositionId: "fixture-template-props",
      frame: 0,
      output: defaultPropsOutput
    });
    await renderer.renderFrame({
      compositionId: "fixture-template-props",
      frame: 0,
      output: overridePropsOutput,
      inputProps: { background: "#1e293b", accent: "#facc15" }
    });
    const propsDifference = await comparePngSnapshotFiles(defaultPropsOutput, overridePropsOutput);
    assert.equal(propsDifference.matches, false);
    assert.ok(propsDifference.differentPixelRatio > 0.25);

    const audioVideoOutput = join(root, "audio-fixture.mp4");
    const audioRender = await renderer.renderVideo({
      compositionId: "fixture-audio",
      output: audioVideoOutput,
      hardwareAcceleration: "cpu",
      resolvedAssets: { "audio-source": assets.audio }
    });
    assert.equal(audioRender.executionPlan.durationSeconds, 1.2);
    const observations = await ffprobeStreams(binaries.ffprobe, audioVideoOutput);
    assert.deepEqual(observations.map((observation) => observation.kind), ["video", "audio"]);
    const sync = assertMediaDurationSync(
      { fps: 10, durationInFrames: 12 },
      observations,
      { durationToleranceSeconds: 0.05, audioVideoSkewToleranceSeconds: 0.05 }
    );
    assert.equal(sync.matches, true);

    const mp4 = await readFile(audioVideoOutput);
    assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

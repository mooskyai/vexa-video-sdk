import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleCompositions } from "@vexa-video/bundler";
import { resolveMediaBinaries, runProcess } from "@vexa-video/ffmpeg";
import { VexaCompositionRenderer } from "@vexa-video/renderer";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceRoot = join(repoRoot, ".tmp", "v2-renderer-acceptance");
const bundleDir = join(acceptanceRoot, "bundle");
const output = join(acceptanceRoot, "product-demo-0-60.mp4");

await rm(acceptanceRoot, { recursive: true, force: true });
await mkdir(acceptanceRoot, { recursive: true });

const bundle = await bundleCompositions({
  rootDir: repoRoot,
  entry: "examples/visual-playground/compositions/entry.tsx",
  publicDir: "examples/visual-playground/compositions/public",
  outDir: bundleDir,
  mode: "development",
  sourceMap: "none"
});

const renderer = await VexaCompositionRenderer.fromManifest(bundle.manifestPath, {
  timeoutMs: 120_000
});
const result = await renderer.renderVideo({
  compositionId: "product-demo",
  startFrame: 0,
  endFrameExclusive: 60,
  output,
  overwrite: true,
  hardwareAcceleration: "cpu"
});

assert.equal(result.plan.frames.frameCount, 60);
assert.equal(result.executionPlan.startFrame, 0);
assert.equal(result.executionPlan.endFrameExclusive, 60);
assert.equal(result.executionPlan.hardware?.selected, "cpu");

const binaries = await resolveMediaBinaries();
const probe = await runProcess(binaries.ffprobe, [
  "-v", "error",
  "-count_frames",
  "-select_streams", "v:0",
  "-show_entries", "stream=codec_name,width,height,avg_frame_rate,nb_read_frames,duration",
  "-of", "json",
  output
], { timeoutMs: 30_000 });

const parsed = JSON.parse(probe.stdout);
const stream = parsed.streams?.[0];
assert.ok(stream, "ffprobe must report a video stream");
assert.equal(stream.codec_name, "h264");
assert.equal(stream.width, 1920);
assert.equal(stream.height, 1080);
assert.equal(stream.avg_frame_rate, "30/1");
assert.equal(Number(stream.nb_read_frames), 60);
const durationSeconds = Number(stream.duration);
assert.ok(
  Number.isFinite(durationSeconds) && Math.abs(durationSeconds - 2) <= 0.05,
  `expected a ~2s stream duration, received ${String(stream.duration)}`
);

console.log(JSON.stringify({
  acceptance: "v2-renderer",
  output,
  codec: stream.codec_name,
  width: stream.width,
  height: stream.height,
  fps: stream.avg_frame_rate,
  frames: Number(stream.nb_read_frames),
  durationSeconds
}, null, 2));

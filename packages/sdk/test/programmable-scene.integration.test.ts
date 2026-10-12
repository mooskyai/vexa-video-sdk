import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defineProgrammableScene,
  lowerProgrammableSceneToVideoProject
} from "@vexa-video/core";
import { runProcess } from "@vexa-video/ffmpeg";
import { VideoProject } from "../src/project.js";
import { Video } from "../src/video.js";

async function sampleYAverage(
  source: string,
  atSeconds: number,
  crop: { x: number; y: number; width: number; height: number }
): Promise<number> {
  const result = await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(atSeconds),
    "-i", source,
    "-vf", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-frames:v", "1",
    "-f", "null", "-"
  ]);
  const match = `${result.stdout}\n${result.stderr}`.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
  assert.ok(match, "expected FFmpeg signalstats YAVG metadata");
  return Number(match[1]!);
}

test("programmable scene lowers through VideoProject and renders background, image, video, text, and audio", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-programmable-scene-"));
  const video = join(workspace, "video.mp4");
  const image = join(workspace, "image.png");
  const audio = join(workspace, "audio.m4a");
  const output = join(workspace, "scene.mp4");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=120x100:r=30",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", video
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=yellow:s=60x60",
      "-frames:v", "1", image
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
      "-t", "2", "-c:a", "aac", audio
    ]);

    const scene = defineProgrammableScene({
      id: "integration-scene",
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 60,
      background: "black",
      assets: [
        { id: "video", kind: "video", source: { kind: "storage", source: { kind: "local", path: video } } },
        { id: "image", kind: "image", source: { kind: "storage", source: { kind: "local", path: image } } },
        { id: "audio", kind: "audio", source: { kind: "storage", source: { kind: "local", path: audio } } }
      ],
      children: [
        {
          id: "video-layer",
          kind: "video",
          assetId: "video",
          durationInFrames: 60,
          muted: true,
          fit: "fill",
          transform: { x: 0, y: 0, width: 120, height: 100 },
          effects: [
            { kind: "brightness", amount: 0.25 },
            { kind: "grayscale", amount: 1 }
          ]
        },
        {
          id: "image-layer",
          kind: "image",
          assetId: "image",
          durationInFrames: 60,
          zIndex: 2,
          fit: "fill",
          transform: { x: 200, y: 100, width: 60, height: 60 },
          effects: [
            { kind: "blur", radius: 1 },
            { kind: "brightness", amount: 0.35 },
            { kind: "contrast", amount: 1.1 },
            { kind: "saturation", amount: 0.8 },
            { kind: "hue", degrees: 15 },
            { kind: "grayscale", amount: 0.2 },
            { kind: "sepia", amount: 0.2 },
            { kind: "noise", amount: 0.05, seed: 42, monochrome: true },
            { kind: "vignette", amount: 0.2, softness: 0.5 }
          ]
        },
        {
          id: "title-layer",
          kind: "text",
          text: "Vexa",
          startFrame: 5,
          durationInFrames: 45,
          zIndex: 3,
          transform: { x: 140, y: 20 },
          style: { fontSize: 28, color: "white" }
        },
        {
          id: "audio-layer",
          kind: "audio",
          assetId: "audio",
          durationInFrames: 60,
          volume: 0.25
        }
      ]
    });

    const project = VideoProject.fromAst(lowerProgrammableSceneToVideoProject(scene));
    await project.render(output, { crf: 30, preset: "veryfast" });

    const info = await Video.load(output).probe();
    assert.equal(info.video?.width, 320);
    assert.equal(info.video?.height, 180);
    assert.equal(info.video?.codec, "h264");
    assert.equal(info.audio?.codec, "aac");
    assert.equal(Number(info.durationSeconds?.toFixed(1)), 2);

    const redRegion = await sampleYAverage(output, 0.5, { x: 10, y: 10, width: 20, height: 20 });
    const yellowRegion = await sampleYAverage(output, 0.5, { x: 210, y: 110, width: 20, height: 20 });
    const backgroundRegion = await sampleYAverage(output, 0.5, { x: 290, y: 160, width: 20, height: 15 });

    assert.ok(redRegion > 10 && redRegion < 50, `expected darkened grayscale video luminance, got ${redRegion}`);
    assert.ok(yellowRegion > 20 && yellowRegion < 140, `expected effected image luminance, got ${yellowRegion}`);
    assert.ok(backgroundRegion < 45, `expected dark background luminance, got ${backgroundRegion}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

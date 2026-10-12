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

test("programmable shadow and glow execute through the FFmpeg compositor graph", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-programmable-compositor-effects-"));
  const image = join(workspace, "card.png");
  const output = join(workspace, "effects.mp4");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=yellow:s=40x40",
      "-frames:v", "1", image
    ]);

    const scene = defineProgrammableScene({
      id: "compositor-effects",
      width: 160,
      height: 80,
      fps: 30,
      durationInFrames: 30,
      background: "white",
      assets: [{
        id: "card",
        kind: "image",
        source: { kind: "storage", source: { kind: "local", path: image } }
      }],
      children: [
        {
          id: "shadow-card",
          kind: "image",
          assetId: "card",
          durationInFrames: 30,
          fit: "fill",
          transform: { x: 20, y: 20, width: 40, height: 40 },
          effects: [{
            kind: "shadow",
            offsetX: 12,
            offsetY: 0,
            blur: 0,
            color: "black",
            opacity: 1
          }]
        },
        {
          id: "glow-card",
          kind: "image",
          assetId: "card",
          durationInFrames: 30,
          zIndex: 1,
          fit: "fill",
          transform: { x: 100, y: 20, width: 40, height: 40 },
          effects: [{
            kind: "glow",
            radius: 4,
            color: "cyan",
            opacity: 1
          }]
        }
      ]
    });

    const project = VideoProject.fromAst(lowerProgrammableSceneToVideoProject(scene));
    const plan = await project.planRender(output, { crf: 18, preset: "veryfast" });
    assert.ok(plan.optimizations.includes("PROGRAMMABLE_EFFECT_COMPOSITOR_GRAPH"));
    assert.match(plan.filterComplex, /split=4\[vexa_fx_shadow_card_0_orig\]/u);
    assert.match(plan.filterComplex, /split=3\[vexa_fx_glow_card_0_orig\]/u);
    await project.render(output, { crf: 18, preset: "veryfast" });

    const shadowRegion = await sampleYAverage(output, 0.5, { x: 63, y: 28, width: 6, height: 20 });
    const glowRegion = await sampleYAverage(output, 0.5, { x: 96, y: 28, width: 3, height: 20 });
    const backgroundRegion = await sampleYAverage(output, 0.5, { x: 145, y: 5, width: 10, height: 10 });

    assert.ok(shadowRegion < 80, `expected visible dark shadow outside the source image, got ${shadowRegion}`);
    assert.ok(glowRegion < backgroundRegion - 3, `expected cyan glow to differ from white background (${glowRegion} vs ${backgroundRegion})`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

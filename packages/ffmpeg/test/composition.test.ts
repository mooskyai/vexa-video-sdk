import assert from "node:assert/strict";
import test from "node:test";
import { createVideoProjectAst, normalizeVideoProject, type ProbeResult, type VideoProjectAst } from "@moosky-video/core";
import { createProjectExecutionPlan } from "../src/composition.js";

const probe = (source: string): ProbeResult => ({
  source,
  format: "mov,mp4,m4a,3gp,3g2,mj2",
  durationSeconds: 10,
  sizeBytes: 1000,
  bitRate: 1000000,
  video: {
    index: 0,
    codec: "h264",
    width: 640,
    height: 360,
    fps: 30,
    pixelFormat: "yuv420p",
    bitRate: 800000,
    rotation: 0
  },
  audio: {
    index: 1,
    codec: "aac",
    sampleRate: 48000,
    channels: 2,
    channelLayout: "stereo",
    bitRate: 128000
  },
  videoStreams: [],
  audioStreams: []
});

const project: VideoProjectAst = {
  schemaVersion: 1,
  id: "timeline-demo",
  canvas: { width: 640, height: 360, fps: 30, background: "black" },
  tracks: [
    {
      id: "video-main",
      type: "video",
      clips: [
        { id: "a", kind: "video", source: "a.mp4", start: 0, duration: 2 },
        { id: "b", kind: "video", source: "b.mp4", start: 2, duration: 2, transitions: { in: { type: "fade", duration: 0.25 } } }
      ]
    },
    {
      id: "titles",
      type: "text",
      clips: [
        { id: "title", kind: "text", text: "Vexa", start: 0.5, duration: 1, transform: { x: 20, y: 20 }, style: { fontSize: 36, color: "white" } }
      ]
    }
  ]
};

test("createProjectExecutionPlan builds one filter_complex for timeline composition", () => {
  const plan = createProjectExecutionPlan(project, "output.mp4", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });

  assert.equal(plan.task, "project-render");
  assert.equal(plan.durationSeconds, 4);
  assert.equal(plan.inputs.length, 2);
  assert.match(plan.filterComplex, /overlay=/);
  assert.match(plan.filterComplex, /drawtext=/);
  assert.match(plan.filterComplex, /amix=inputs=2/);
  assert.ok(plan.optimizations.includes("TIMELINE_SINGLE_PASS_COMPOSITION"));
  assert.ok(plan.optimizations.includes("AUDIO_MIX_GRAPH"));
  assert.ok(plan.optimizations.includes("TEXT_IN_FILTER_GRAPH"));
  assert.deepEqual(plan.args.slice(-3), ["-t", "4", "output.mp4"]);
});

test("project WebM output selects VP9 and Opus", () => {
  const plan = createProjectExecutionPlan(project, "output.webm", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });
  const joined = plan.args.join(" ");
  assert.match(joined, /-c:v libvpx-vp9/);
  assert.match(joined, /-c:a libopus/);
});


test("project compiler normalizes Windows font paths for drawtext", () => {
  const project = createVideoProjectAst({ id: "font-path", width: 320, height: 180, duration: 1 });
  const withText = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "t1",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0,
        duration: 1,
        style: { fontFile: "C:\\Windows\\Fonts\\segoeui.ttf" }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(withText, "output.mp4");
  assert.match(plan.filterComplex, /fontfile='C\\:\/Windows\/Fonts\/segoeui\.ttf'/u);
});


test("project compiler emits keyframe expressions for animated transforms and volume", () => {
  const animated = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "v1",
      type: "video",
      clips: [{
        id: "animated",
        kind: "video",
        source: "a.mp4",
        start: 0,
        duration: 4,
        transform: {
          x: { value: 0, keyframes: [{ time: 4, value: 120, easing: "linear" }] },
          rotation: { value: 0, keyframes: [{ time: 4, value: 45, easing: "ease-in-out" }] }
        },
        volume: { value: 0.25, keyframes: [{ time: 4, value: 1, easing: "linear" }] }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(animated, "output.mp4", {}, {
    "a.mp4": probe("a.mp4")
  });

  assert.match(plan.filterComplex, /overlay=x='if\(lt\(\(t-0\),4\)/u);
  assert.match(plan.filterComplex, /rotate='\(/u);
  assert.match(plan.filterComplex, /volume='if\(lt\(t,4\)/u);
  assert.ok(plan.optimizations.includes("KEYFRAME_EXPRESSION_GRAPH"));
  assert.ok(plan.optimizations.includes("AUDIO_KEYFRAME_EXPRESSION_GRAPH"));
});

test("project compiler builds an xfade graph for overlapping full-canvas clips", () => {
  const transitioned = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "v1",
      type: "video",
      clips: [
        {
          id: "first",
          kind: "video",
          source: "a.mp4",
          start: 0,
          duration: 3,
          transform: { width: 640, height: 360, fit: "cover" }
        },
        {
          id: "second",
          kind: "video",
          source: "b.mp4",
          start: 2.5,
          duration: 3,
          transform: { width: 640, height: 360, fit: "cover" },
          transitions: { in: { type: "wipe-left", duration: 0.5 } }
        }
      ]
    }]
  });

  const plan = createProjectExecutionPlan(transitioned, "output.mp4", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });

  assert.match(plan.filterComplex, /xfade=transition=wipeleft:duration=0\.5:offset=2\.5/u);
  assert.ok(plan.optimizations.includes("VIDEO_XFADE_GRAPH"));
});

test("project compiler supports full-canvas blend modes", () => {
  const blended = normalizeVideoProject({
    ...project,
    tracks: [
      {
        id: "base",
        type: "video",
        clips: [{
          id: "base-clip",
          kind: "video",
          source: "a.mp4",
          start: 0,
          duration: 4,
          transform: { width: 640, height: 360, fit: "fill" }
        }]
      },
      {
        id: "overlay",
        type: "video",
        clips: [{
          id: "blend-clip",
          kind: "video",
          source: "b.mp4",
          start: 0,
          duration: 4,
          blendMode: "screen",
          transform: { width: 640, height: 360, fit: "fill" }
        }]
      }
    ]
  });

  const plan = createProjectExecutionPlan(blended, "output.mp4", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });

  assert.match(plan.filterComplex, /blend=all_mode=screen/u);
  assert.ok(plan.optimizations.includes("BLEND_MODE_GRAPH"));
});

test("project rendering can select NVENC for composed output", () => {
  const capabilities = {
    schemaVersion: 1 as const,
    backend: "ffmpeg" as const,
    platform: "win32" as const,
    hwaccels: ["cuda"],
    encoders: ["h264_nvenc"],
    providers: [
      { provider: "nvidia" as const, available: true, runtimeAvailable: true, encoders: [{ provider: "nvidia" as const, codec: "h264" as const, encoder: "h264_nvenc", runtimeAvailable: true }] },
      { provider: "intel" as const, available: false, runtimeAvailable: false, encoders: [] },
      { provider: "amd" as const, available: false, runtimeAvailable: false, encoders: [] },
      { provider: "apple" as const, available: false, runtimeAvailable: false, encoders: [] }
    ]
  };
  const plan = createProjectExecutionPlan(project, "output.mp4", {
    hardwareAcceleration: "nvidia",
    hardwareFallback: false
  }, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  }, capabilities);
  assert.equal(plan.hardware?.selected, "nvidia");
  assert.match(plan.args.join(" "), /-c:v h264_nvenc/);
  assert.ok(plan.optimizations.includes("NVIDIA_VIDEO_ENCODE"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { InvalidProjectError, createVideoProjectAst, normalizeVideoProject, type ProbeResult, type VideoProjectAst } from "@vexa-video/core";
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

test("project compiler appends composition captions after the composed visual graph", () => {
  const withCaptions = normalizeVideoProject({
    ...project,
    captions: {
      schemaVersion: 1,
      format: "vtt",
      cues: [{
        id: "caption-1",
        start: 0.5,
        end: 2,
        text: "Composition caption",
        words: [
          { text: "Composition", start: 0.5, end: 1.25 },
          { text: "caption", start: 1.25, end: 2 }
        ],
        style: {
          fontFile: "C:\\Windows\\Fonts\\segoeui.ttf",
          fontSize: 32,
          animation: "fade",
          wordMode: "active-word",
          activeWordColor: "#facc15"
        }
      }]
    }
  });

  const plan = createProjectExecutionPlan(withCaptions, "output.mp4", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });

  assert.equal(plan.videoMap, "captionout");
  assert.match(plan.filterComplex, /\[vout\]drawtext=/u);
  assert.match(plan.filterComplex, /drawtext=text='Composition'/u);
  assert.match(plan.filterComplex, /drawtext=text='caption'/u);
  assert.doesNotMatch(plan.filterComplex, /Composition caption/u);
  assert.ok(plan.optimizations.includes("CAPTION_DRAW_TEXT_GRAPH"));
  assert.ok(plan.optimizations.includes("WORD_LEVEL_TIMING_MODEL"));
  assert.ok(plan.optimizations.includes("ACTIVE_WORD_CAPTION_GRAPH"));
  assert.ok(plan.optimizations.includes("ANIMATED_CAPTION_PRIMITIVES"));
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

test("project compiler executes deterministic text stroke shadow alignment and line spacing", () => {
  const project = createVideoProjectAst({ id: "typography", width: 320, height: 180, duration: 1 });
  const withText = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "t1",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa\nTypography",
        start: 0,
        duration: 1,
        transform: { x: 160, y: 24 },
        style: {
          fontSize: 36,
          textAlign: "center",
          lineSpacing: 7,
          stroke: { color: "black", width: 2 },
          shadow: { color: "#000000@0.5", offsetX: -3, offsetY: 4 }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(withText, "output.mp4");
  assert.match(plan.filterComplex, /x='\(\(160\)-text_w\/2\)'/u);
  assert.match(plan.filterComplex, /line_spacing=7/u);
  assert.match(plan.filterComplex, /borderw=2:bordercolor=black/u);
  assert.match(plan.filterComplex, /shadowcolor=#000000@0\.5:shadowx=-3:shadowy=4/u);
});

test("isolated text typography keeps the same drawtext styling", () => {
  const project = createVideoProjectAst({ id: "isolated-typography", width: 320, height: 180, duration: 1 });
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
        effects: [{ kind: "blur", radius: 1 }],
        style: {
          textAlign: "right",
          lineSpacing: 4,
          stroke: { color: "#111111", width: 1 },
          shadow: { color: "#000000", offsetX: 2, offsetY: 3 }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(withText, "output.mp4");
  assert.match(plan.filterComplex, /color=c=black@0:s=320x180/u);
  assert.match(plan.filterComplex, /x='w-text_w'/u);
  assert.match(plan.filterComplex, /line_spacing=4/u);
  assert.match(plan.filterComplex, /borderw=1:bordercolor=#111111/u);
  assert.match(plan.filterComplex, /shadowcolor=#000000:shadowx=2:shadowy=3/u);
  assert.ok(plan.optimizations.includes("TEXT_ISOLATED_EFFECT_GRAPH"));
});

test("project compiler fails closed on unresolved remote font references", () => {
  const remote = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "t1",
      type: "text",
      clips: [{
        id: "remote-title",
        kind: "text",
        text: "Remote",
        start: 0,
        duration: 1,
        style: { remoteFont: { provider: "fixture", family: "Fixture Sans" } }
      }]
    }]
  });

  assert.throws(
    () => createProjectExecutionPlan(remote, "output.mp4"),
    /must be materialized to style.fontFile before FFmpeg planning/
  );
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

test("project compiler executes programmable fade easing after clip opacity", () => {
  const faded = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 2,
        opacity: 0.5,
        transitions: {
          in: { kind: "fade", durationInFrames: 15, easing: "ease-in" },
          out: { kind: "fade", durationInFrames: 15, easing: "ease-out" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(faded, "output.mp4");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.5");
  const transitionIndex = plan.filterComplex.indexOf("alpha(X,Y)*");
  assert.ok(opacityIndex >= 0 && transitionIndex > opacityIndex);
  assert.match(plan.filterComplex, /min\(1,max\(0,\(\(T\)\/0\.5\)\)\)/u);
  assert.match(plan.filterComplex, /1-\(1-\(min\(1,max\(0,/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
});

test("programmable text fade uses an isolated transparent layer", () => {
  const fadedText = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0.5,
        duration: 1,
        style: { fontSize: 36, color: "white" },
        transitions: {
          in: { kind: "fade", durationInFrames: 10, easing: "ease-in-out" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(fadedText, "output.mp4");
  assert.match(plan.filterComplex, /color=c=black@0:s=640x360:r=30:d=1,format=rgba,drawtext=/u);
  assert.match(plan.filterComplex, /\[base0\]\[tclip0\]overlay=x=0:y=0/u);
  assert.match(plan.filterComplex, /alpha\(X,Y\)\*/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("TEXT_ISOLATED_TRANSITION_GRAPH"));
});

test("project compiler executes programmable slide positioning with easing and direction", () => {
  const sliding = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0.5,
        duration: 2,
        transform: { x: 20, y: 10, width: 120, height: 80, fit: "fill" },
        transitions: {
          in: { kind: "slide", durationInFrames: 15, easing: "ease-in", direction: "right" },
          out: { kind: "slide", durationInFrames: 15, easing: "ease-out", direction: "up" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(sliding, "output.mp4");
  assert.match(plan.filterComplex, /overlay=x='[^']*640\*\(1-/u);
  assert.match(plan.filterComplex, /:y='[^']*-360\*\(1-/u);
  assert.match(plan.filterComplex, /min\(1,max\(0,/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_SLIDE_TRANSITION_GRAPH"));
});

test("project compiler executes programmable wipe masks after clip opacity", () => {
  const wiped = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 2,
        opacity: 0.75,
        transitions: {
          in: { kind: "wipe", durationInFrames: 10, easing: "ease-out", direction: "right" },
          out: { kind: "wipe", durationInFrames: 10, easing: "ease-in", direction: "down" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(wiped, "output.mp4");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.75");
  const wipeIndex = plan.filterComplex.indexOf("if(gte(X,W*(1-");
  assert.ok(opacityIndex >= 0 && wipeIndex > opacityIndex);
  assert.match(plan.filterComplex, /if\(gte\(X,W\*\(1-/u);
  assert.match(plan.filterComplex, /if\(gte\(Y,H\*\(1-/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_WIPE_TRANSITION_GRAPH"));
});

test("programmable text slide and wipe reuse the isolated transparent layer", () => {
  const transitionedText = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0.5,
        duration: 1,
        style: { fontSize: 36, color: "white" },
        transitions: {
          in: { kind: "slide", durationInFrames: 10, easing: "ease-out", direction: "left" },
          out: { kind: "wipe", durationInFrames: 10, easing: "ease-in", direction: "right" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(transitionedText, "output.mp4");
  assert.match(plan.filterComplex, /color=c=black@0:s=640x360:r=30:d=1,format=rgba,drawtext=/u);
  assert.match(plan.filterComplex, /\[base0\]\[tclip0\]overlay=x='[^']*-640\*\(1-/u);
  assert.match(plan.filterComplex, /if\(gte\(X,W\*\(1-/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_SLIDE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_WIPE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("TEXT_ISOLATED_TRANSITION_GRAPH"));
});

test("project compiler executes programmable zoom after effects and opacity around the authored center", () => {
  const zoomed = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0.5,
        duration: 2,
        opacity: 0.5,
        effects: [{ kind: "brightness", amount: 0.8 }],
        transform: { x: 20, y: 10, width: 120, height: 80, fit: "fill" },
        transitions: {
          in: { kind: "zoom", durationInFrames: 15, easing: "ease-in-out" },
          out: { kind: "zoom", durationInFrames: 15, easing: "ease-out" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(zoomed, "output.mp4");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.5");
  const zoomIndex = plan.filterComplex.indexOf("scale=w='max(1,iw*(");
  assert.ok(opacityIndex >= 0 && zoomIndex > opacityIndex);
  assert.match(plan.filterComplex, /max\(0\.001,\(.*\/0\.5/u);
  assert.match(plan.filterComplex, /overlay=x='[^']*w\/\(2\*\(/u);
  assert.match(plan.filterComplex, /:y='[^']*h\/\(2\*\(/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_ZOOM_TRANSITION_GRAPH"));
});

test("programmable text zoom scales the isolated layer around the canvas center", () => {
  const zoomedText = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0.5,
        duration: 1,
        style: { fontSize: 36, color: "white" },
        transitions: {
          in: { kind: "zoom", durationInFrames: 10, easing: "ease-in-out" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(zoomedText, "output.mp4");
  assert.match(plan.filterComplex, /color=c=black@0:s=640x360:r=30:d=1,format=rgba,drawtext=/u);
  assert.match(plan.filterComplex, /scale=w='max\(1,iw\*/u);
  assert.match(plan.filterComplex, /\[base0\]\[tclip0\]overlay=x='\(W-w\)\/2':y='\(H-h\)\/2'/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_ZOOM_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("TEXT_ISOLATED_TRANSITION_GRAPH"));
});

test("programmable zoom stays fail-closed for animated geometry and non-normal blend modes", () => {
  const animatedZoom = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 2,
        transform: {
          x: { value: 0, keyframes: [{ time: 2, value: 100, easing: "linear" }] }
        },
        transitions: { in: { kind: "zoom", durationInFrames: 10 } }
      }]
    }]
  });
  assert.throws(
    () => createProjectExecutionPlan(animatedZoom, "output.mp4"),
    (error: unknown) =>
      error instanceof InvalidProjectError && /zoom with animated transforms/u.test(error.message)
  );

  const blendedZoom = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 2,
        blendMode: "screen",
        transitions: { in: { kind: "zoom", durationInFrames: 10 } }
      }]
    }]
  });
  assert.throws(
    () => createProjectExecutionPlan(blendedZoom, "output.mp4"),
    (error: unknown) =>
      error instanceof InvalidProjectError && /programmable zoom.*blendMode/u.test(error.message)
  );
});

test("project compiler executes programmable iris after effects and opacity around the layer center", () => {
  const irised = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 2,
        opacity: 0.75,
        effects: [{ kind: "brightness", amount: 0.8 }],
        transform: { x: 20, y: 10, width: 120, height: 80, fit: "fill" },
        transitions: {
          in: { kind: "iris", durationInFrames: 15, easing: "ease-in-out" },
          out: { kind: "iris", durationInFrames: 15, easing: "ease-out" }
        }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(irised, "output.mp4");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.75");
  const irisIndex = plan.filterComplex.indexOf("(X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)");
  assert.ok(opacityIndex >= 0 && irisIndex > opacityIndex);
  assert.match(plan.filterComplex, /\(W\/2\)\*\(W\/2\)\+\(H\/2\)\*\(H\/2\)/u);
  assert.match(plan.filterComplex, /min\(1,max\(0,/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_IRIS_TRANSITION_GRAPH"));
});

test("programmable text iris masks the isolated transparent layer", () => {
  const irisedText = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0.5,
        duration: 1,
        style: { fontSize: 36, color: "white" },
        transitions: { in: { kind: "iris", durationInFrames: 10, easing: "ease-in-out" } }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(irisedText, "output.mp4");
  assert.match(plan.filterComplex, /color=c=black@0:s=640x360:r=30:d=1,format=rgba,drawtext=/u);
  assert.match(plan.filterComplex, /alpha\(X,Y\).*X-W\/2/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_IRIS_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("TEXT_ISOLATED_TRANSITION_GRAPH"));
});

test("programmable iris stays fail-closed for non-normal blend modes", () => {
  const blendedIris = normalizeVideoProject({
    ...project,
    tracks: [{ id: "images", type: "image", clips: [{
      id: "card", kind: "image", source: "card.png", start: 0, duration: 2,
      blendMode: "screen", transitions: { in: { kind: "iris", durationInFrames: 10 } }
    }] }]
  });

  assert.throws(
    () => createProjectExecutionPlan(blendedIris, "output.mp4"),
    (error: unknown) => error instanceof InvalidProjectError && /programmable iris.*blendMode/u.test(error.message)
  );
});

test("project compiler executes paired programmable push with easing and direction", () => {
  const pushed = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "push-track",
      type: "video",
      clips: [
        {
          id: "first",
          kind: "video",
          source: "a.mp4",
          start: 0,
          duration: 2,
          transform: { width: 640, height: 360, fit: "cover" }
        },
        {
          id: "second",
          kind: "video",
          source: "b.mp4",
          start: 1.5,
          duration: 2,
          transform: { width: 640, height: 360, fit: "cover" },
          transitions: {
            in: { kind: "push", durationInFrames: 15, easing: "ease-in-out", direction: "left" }
          }
        }
      ]
    }]
  });

  const plan = createProjectExecutionPlan(pushed, "output.mp4", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });

  assert.match(plan.filterComplex, /split=2\[push_push_track_pre_src\]\[push_push_track_old_src\]/u);
  assert.match(plan.filterComplex, /trim=start=1\.5:duration=0\.5/u);
  assert.match(plan.filterComplex, /overlay=x='640\*\(/u);
  assert.match(plan.filterComplex, /overlay=x='-640\*\(1-/u);
  assert.match(plan.filterComplex, /concat=n=3:v=1:a=0/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_PUSH_TRANSITION_GRAPH"));
  assert.equal(plan.optimizations.includes("VIDEO_XFADE_GRAPH"), false);
});

test("programmable push supports vertical paired motion", () => {
  const pushed = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "push-vertical",
      type: "video",
      clips: [
        {
          id: "first",
          kind: "video",
          source: "a.mp4",
          start: 0,
          duration: 2,
          transform: { width: 640, height: 360, fit: "fill" }
        },
        {
          id: "second",
          kind: "video",
          source: "b.mp4",
          start: 1.5,
          duration: 2,
          transform: { width: 640, height: 360, fit: "fill" },
          transitions: {
            in: { kind: "push", durationInFrames: 15, easing: "ease-out", direction: "down" }
          }
        }
      ]
    }]
  });

  const plan = createProjectExecutionPlan(pushed, "output.mp4", {}, {
    "a.mp4": probe("a.mp4"),
    "b.mp4": probe("b.mp4")
  });

  assert.match(plan.filterComplex, /overlay=x='0':y='-360\*\(/u);
  assert.match(plan.filterComplex, /overlay=x='0':y='360\*\(1-/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_PUSH_TRANSITION_GRAPH"));
});

test("programmable push stays fail-closed outside an eligible paired full-canvas video track", () => {
  const imagePush = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 2,
        transitions: {
          in: { kind: "push", durationInFrames: 10, direction: "left" }
        }
      }]
    }]
  });

  assert.throws(
    () => createProjectExecutionPlan(imagePush, "output.mp4"),
    (error: unknown) => error instanceof InvalidProjectError && /programmable push/u.test(error.message)
  );

  const badOverlap = normalizeVideoProject({
    ...project,
    tracks: [{
      id: "push-track",
      type: "video",
      clips: [
        {
          id: "first",
          kind: "video",
          source: "a.mp4",
          start: 0,
          duration: 2,
          transform: { width: 640, height: 360, fit: "cover" }
        },
        {
          id: "second",
          kind: "video",
          source: "b.mp4",
          start: 1.75,
          duration: 2,
          transform: { width: 640, height: 360, fit: "cover" },
          transitions: {
            in: { kind: "push", durationInFrames: 15, direction: "right" }
          }
        }
      ]
    }]
  });

  assert.throws(
    () => createProjectExecutionPlan(badOverlap, "output.mp4", {}, {
      "a.mp4": probe("a.mp4"),
      "b.mp4": probe("b.mp4")
    }),
    (error: unknown) =>
      error instanceof InvalidProjectError &&
      /overlap the previous clip by exactly the transition duration/u.test(error.message)
  );
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

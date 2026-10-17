import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProjectError,
  normalizeVideoProject,
  type ProgrammableEffect,
  type VideoProjectAst
} from "@vexa-video/core";
import { createProjectExecutionPlan } from "../src/composition.js";
import {
  compileProgrammableEffectFilters,
  programmableEffectPadding
} from "../src/programmable-effects.js";

const representativeEffects: readonly ProgrammableEffect[] = [
  { kind: "blur", radius: 1 },
  { kind: "brightness", amount: 0.35 },
  { kind: "contrast", amount: 1.1 },
  { kind: "saturation", amount: 0.8 },
  { kind: "hue", degrees: 15 },
  { kind: "grayscale", amount: 0.2 },
  { kind: "sepia", amount: 0.2 },
  { kind: "noise", amount: 0.05, seed: 42, monochrome: true },
  { kind: "vignette", amount: 0.2, softness: 0.5 }
];

test("programmable effect filters preserve declaration order across supported FFmpeg mappings", () => {
  const filters = compileProgrammableEffectFilters(representativeEffects, "image");
  assert.equal(filters.length, 11);
  assert.match(filters[0]!, /^gblur=sigma=1:steps=2$/u);
  assert.match(filters[1]!, /^lutrgb=.*val\*0\.35/u);
  assert.match(filters[2]!, /^lutrgb=.*maxval\/2.*1\.1/u);
  assert.match(filters[3]!, /^colorchannelmixer=/u);
  assert.equal(filters[4], "hue=h=15");
  assert.match(filters[5]!, /^colorchannelmixer=/u);
  assert.match(filters[6]!, /^colorchannelmixer=/u);
  assert.equal(filters[7], "format=gbrap");
  assert.match(filters[8]!, /^noise=.*c0_seed=42:c1_seed=42:c2_seed=42/u);
  assert.equal(filters[9], "format=rgba");
  assert.match(filters[10]!, /^geq=r=/u);
});

test("project plans compile effects before opacity and expose an optimization marker", () => {
  const project: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "effect-plan",
    canvas: { width: 100, height: 100, fps: 30, duration: 1, background: "black" },
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "image",
        kind: "image",
        source: "image.png",
        start: 0,
        duration: 1,
        opacity: 0.5,
        effects: [{ kind: "brightness", amount: 0.5 }]
      }]
    }]
  });

  const plan = createProjectExecutionPlan(project, "output.mp4");
  const effectIndex = plan.filterComplex.indexOf("lutrgb=");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.5");
  assert.ok(effectIndex >= 0, "expected a programmable effect filter");
  assert.ok(opacityIndex > effectIndex, "opacity must be applied after programmable effects");
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_EFFECT_GRAPH"));
});

test("programmable fade executes after effects and opacity", () => {
  const project: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "effect-fade-plan",
    canvas: { width: 100, height: 100, fps: 30, duration: 1, background: "black" },
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "image",
        kind: "image",
        source: "image.png",
        start: 0,
        duration: 1,
        opacity: 0.5,
        effects: [{ kind: "brightness", amount: 0.5 }],
        transitions: { in: { kind: "fade", durationInFrames: 15, easing: "ease-in" } }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(project, "output.mp4");
  const effectIndex = plan.filterComplex.indexOf("lutrgb=");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.5");
  const transitionIndex = plan.filterComplex.indexOf("alpha(X,Y)*");
  assert.ok(effectIndex >= 0 && opacityIndex > effectIndex);
  assert.ok(transitionIndex > opacityIndex);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_TRANSITION_GRAPH"));
});

test("text effects compile on an isolated transparent layer before opacity and fades", () => {
  const project: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "text-effect-plan",
    canvas: { width: 320, height: 180, fps: 30, duration: 1, background: "black" },
    tracks: [{
      id: "text",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0,
        duration: 1,
        opacity: 0.5,
        transform: { x: 40, y: 20 },
        style: { fontSize: 32, color: "white" },
        effects: [
          { kind: "brightness", amount: 0.8 },
          { kind: "shadow", offsetX: 4, offsetY: 3, blur: 2, color: "black", opacity: 0.7 }
        ],
        transitions: { in: { type: "fade", duration: 0.2 } }
      }]
    }]
  });

  const plan = createProjectExecutionPlan(project, "output.mp4");
  const drawtextIndex = plan.filterComplex.indexOf("drawtext=");
  const effectIndex = plan.filterComplex.indexOf("lutrgb=");
  const opacityIndex = plan.filterComplex.indexOf("colorchannelmixer=aa=0.5");
  const fadeIndex = plan.filterComplex.indexOf("fade=t=in:st=0:d=0.2:alpha=1");
  assert.match(plan.filterComplex, /color=c=black@0:s=320x180:r=30:d=1,format=rgba,drawtext=/u);
  assert.ok(drawtextIndex >= 0 && effectIndex > drawtextIndex);
  assert.ok(opacityIndex > effectIndex && fadeIndex > opacityIndex);
  assert.match(plan.filterComplex, /split=4\[vexa_fx_title_1_orig\]/u);
  assert.match(plan.filterComplex, /\[base0\]\[tclip0\]overlay=x=0:y=0/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_EFFECT_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_EFFECT_COMPOSITOR_GRAPH"));
  assert.ok(plan.optimizations.includes("TEXT_ISOLATED_EFFECT_GRAPH"));
});

test("shadow and glow preserve effect order through compositor branches with deterministic padding", () => {
  const effects: readonly ProgrammableEffect[] = [
    { kind: "brightness", amount: 0.8 },
    { kind: "shadow", offsetX: 6, offsetY: -4, blur: 3, color: "#111827", opacity: 0.6 },
    { kind: "hue", degrees: 30 },
    { kind: "glow", radius: 2, color: "cyan", opacity: 0.5 },
    { kind: "contrast", amount: 1.1 }
  ];
  const filters = compileProgrammableEffectFilters(effects, "card");
  const graph = filters.join(",");
  const brightnessIndex = graph.indexOf("lutrgb=");
  const shadowIndex = graph.indexOf("split=4[vexa_fx_card_1_orig]");
  const hueIndex = graph.indexOf("hue=h=30");
  const glowIndex = graph.indexOf("split=3[vexa_fx_card_3_orig]");
  const contrastIndex = graph.lastIndexOf("lutrgb=");
  assert.ok(brightnessIndex >= 0 && shadowIndex > brightnessIndex);
  assert.ok(hueIndex > shadowIndex && glowIndex > hueIndex && contrastIndex > glowIndex);
  assert.match(graph, /alphamerge\[vexa_fx_card_1_shadow\]/u);
  assert.match(graph, /overlay=x=6:y=-4/u);
  assert.match(graph, /alphamerge\[vexa_fx_card_3_glow\]/u);
  assert.deepEqual(programmableEffectPadding(effects, "card"), {
    left: 15,
    right: 21,
    top: 19,
    bottom: 15
  });

  const project: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "compositor-plan",
    canvas: { width: 160, height: 90, fps: 30, duration: 1, background: "white" },
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "card",
        kind: "image",
        source: "card.png",
        start: 0,
        duration: 1,
        transform: { x: 20, y: 10, width: 40, height: 30, fit: "fill" },
        effects
      }]
    }]
  });
  const plan = createProjectExecutionPlan(project, "output.mp4");
  assert.match(plan.filterComplex, /pad=iw\+36:ih\+34:15:19:color=black@0/u);
  assert.match(plan.filterComplex, /overlay=x='\(\(20\)-15\)':y='\(\(10\)-19\)'/u);
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_EFFECT_GRAPH"));
  assert.ok(plan.optimizations.includes("PROGRAMMABLE_EFFECT_COMPOSITOR_GRAPH"));
});

test("FFmpeg effect execution fails closed for backend limits and unsafe compositor colors", () => {
  assert.throws(
    () => compileProgrammableEffectFilters([{ kind: "saturation", amount: 2.1 }], "saturation"),
    InvalidProjectError
  );
  assert.throws(
    () => compileProgrammableEffectFilters([{ kind: "blur", radius: 1025 }], "blur"),
    InvalidProjectError
  );
  assert.throws(
    () => compileProgrammableEffectFilters([
      { kind: "noise", amount: 0.5, seed: 2_147_483_646 }
    ], "noise"),
    InvalidProjectError
  );
  assert.throws(
    () => compileProgrammableEffectFilters([
      { kind: "shadow", offsetX: 2, offsetY: 2, blur: 4, color: "red:enable=1", opacity: 0.5 }
    ], "shadow"),
    (error: unknown) => error instanceof InvalidProjectError && /color is not supported/u.test(error.message)
  );
  assert.throws(
    () => programmableEffectPadding([
      { kind: "shadow", offsetX: 5000, offsetY: 0, blur: 0, color: "black", opacity: 1 }
    ], "shadow"),
    (error: unknown) => error instanceof InvalidProjectError && /compositor padding/u.test(error.message)
  );

  const advancedTransition: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "effect-transition",
    canvas: { width: 100, height: 100, fps: 30, duration: 2, background: "black" },
    tracks: [{
      id: "video",
      type: "video",
      clips: [
        { id: "first", kind: "video", source: "a.mp4", start: 0, duration: 1.5 },
        {
          id: "second", kind: "video", source: "b.mp4", start: 1, duration: 1,
          effects: [{ kind: "glow", radius: 2, color: "white", opacity: 1 }],
          transitions: { in: { type: "wipe-left", duration: 0.5 } }
        }
      ]
    }]
  });
  assert.throws(
    () => createProjectExecutionPlan(advancedTransition, "output.mp4"),
    (error: unknown) => error instanceof InvalidProjectError && /cannot combine programmable effects with wipe-left/u.test(error.message)
  );

  const textTransition: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "text-effect-transition",
    canvas: { width: 100, height: 100, fps: 30, duration: 1, background: "black" },
    tracks: [{
      id: "text",
      type: "text",
      clips: [{
        id: "title", kind: "text", text: "Vexa", start: 0, duration: 1,
        effects: [{ kind: "blur", radius: 2 }],
        transitions: { in: { type: "wipe-left", duration: 0.2 } }
      }]
    }]
  });
  assert.throws(
    () => createProjectExecutionPlan(textTransition, "output.mp4"),
    (error: unknown) => error instanceof InvalidProjectError && /Text clip .* cannot execute wipe-left on an isolated text layer yet/u.test(error.message)
  );

  const spatialBlend: VideoProjectAst = normalizeVideoProject({
    schemaVersion: 1,
    id: "effect-blend",
    canvas: { width: 100, height: 100, fps: 30, duration: 1, background: "black" },
    tracks: [{
      id: "images",
      type: "image",
      clips: [{
        id: "blend", kind: "image", source: "card.png", start: 0, duration: 1,
        blendMode: "screen",
        effects: [{ kind: "shadow", offsetX: 3, offsetY: 3, blur: 2, color: "black", opacity: 1 }]
      }]
    }]
  });
  assert.throws(
    () => createProjectExecutionPlan(spatialBlend, "output.mp4"),
    (error: unknown) => error instanceof InvalidProjectError && /spatial programmable effects/u.test(error.message)
  );
});

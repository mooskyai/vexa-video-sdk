import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProjectError,
  normalizeVideoProject,
  type ProgrammableEffect,
  type VideoProjectAst
} from "@vexa-video/core";
import { createProjectExecutionPlan } from "../src/composition.js";
import { compileProgrammableEffectFilters } from "../src/programmable-effects.js";

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

test("FFmpeg effect execution fails closed for compositor-only effects and backend limits", () => {
  assert.throws(
    () => compileProgrammableEffectFilters([
      { kind: "shadow", offsetX: 2, offsetY: 2, blur: 4, color: "black", opacity: 0.5 }
    ], "shadow"),
    (error: unknown) => error instanceof InvalidProjectError && /compositor branch execution/u.test(error.message)
  );
  assert.throws(
    () => compileProgrammableEffectFilters([
      { kind: "glow", radius: 4, color: "white", opacity: 0.5 }
    ], "glow"),
    (error: unknown) => error instanceof InvalidProjectError && /compositor branch execution/u.test(error.message)
  );
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
});

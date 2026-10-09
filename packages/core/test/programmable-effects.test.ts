import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProgrammableEffectError,
  normalizeProgrammableEffect,
  normalizeProgrammableEffects,
  serializeProgrammableEffect,
  serializeProgrammableEffects
} from "../src/programmable-effects.js";

test("effect normalization applies deterministic defaults and canonical values", () => {
  assert.deepEqual(
    normalizeProgrammableEffects([
      { kind: "blur", radius: 4 },
      { kind: "brightness", amount: 1.25 },
      { kind: "contrast", amount: 0.9 },
      { kind: "saturation", amount: 1.4 },
      { kind: "hue", degrees: -90 },
      { kind: "grayscale", amount: 0.5 },
      { kind: "sepia", amount: 0.25 },
      { kind: "shadow", offsetX: 8, offsetY: 12, blur: 16, color: " #000000 ", opacity: 0.6 },
      { kind: "glow", radius: 10, color: "#22d3ee" },
      { kind: "noise", amount: 0.1 },
      { kind: "vignette", amount: 0.75 }
    ]),
    [
      { kind: "blur", radius: 4 },
      { kind: "brightness", amount: 1.25 },
      { kind: "contrast", amount: 0.9 },
      { kind: "saturation", amount: 1.4 },
      { kind: "hue", degrees: 270 },
      { kind: "grayscale", amount: 0.5 },
      { kind: "sepia", amount: 0.25 },
      { kind: "shadow", offsetX: 8, offsetY: 12, blur: 16, color: "#000000", opacity: 0.6 },
      { kind: "glow", radius: 10, color: "#22d3ee", opacity: 1 },
      { kind: "noise", amount: 0.1, seed: 0, monochrome: false },
      { kind: "vignette", amount: 0.75, softness: 0.5 }
    ]
  );
});

test("effect lists preserve declaration order and freeze normalized values", () => {
  const effects = normalizeProgrammableEffects([
    { kind: "contrast", amount: 1.2 },
    { kind: "blur", radius: 3 },
    { kind: "contrast", amount: 0.8 }
  ]);

  assert.deepEqual(effects.map((effect) => effect.kind), ["contrast", "blur", "contrast"]);
  assert.equal(Object.isFrozen(effects), true);
  assert.equal(effects.every((effect) => Object.isFrozen(effect)), true);
});

test("effect serialization is stable after normalization", () => {
  assert.equal(
    serializeProgrammableEffect({ kind: "hue", degrees: 450 }),
    '{"kind":"hue","degrees":90}'
  );
  assert.equal(
    serializeProgrammableEffects([
      { kind: "noise", amount: 0.2, seed: 7, monochrome: true },
      { kind: "vignette", amount: 0.4, softness: 0.8 }
    ]),
    '[{"kind":"noise","amount":0.2,"seed":7,"monochrome":true},{"kind":"vignette","amount":0.4,"softness":0.8}]'
  );
});

test("invalid effect values fail with typed validation errors", () => {
  assert.throws(
    () => normalizeProgrammableEffect({ kind: "blur", radius: -0.1 }),
    InvalidProgrammableEffectError
  );
  assert.throws(
    () => normalizeProgrammableEffect({ kind: "grayscale", amount: 1.1 }),
    /between 0 and 1/
  );
  assert.throws(
    () => normalizeProgrammableEffect({
      kind: "shadow",
      offsetX: 1,
      offsetY: 1,
      blur: -1,
      color: "black"
    }),
    /greater than or equal to 0/
  );
  assert.throws(
    () => normalizeProgrammableEffect({ kind: "noise", amount: 0.2, seed: -1 }),
    /non-negative safe integer/
  );
  assert.throws(
    () => normalizeProgrammableEffect({ kind: "glow", radius: 2, color: "   " }),
    /cannot be empty/
  );
});


test("browser entry exposes the same effect normalization contract", async () => {
  const browser = await import("../src/browser.js");
  assert.deepEqual(
    browser.normalizeProgrammableEffects([
      { kind: "hue", degrees: 810 },
      { kind: "noise", amount: 0.15 }
    ]),
    [
      { kind: "hue", degrees: 90 },
      { kind: "noise", amount: 0.15, seed: 0, monochrome: false }
    ]
  );
});

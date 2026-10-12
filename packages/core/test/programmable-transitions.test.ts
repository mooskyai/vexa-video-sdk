import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProgrammableTransitionError,
  normalizeProgrammableTransition,
  normalizeProgrammableTransitions,
  serializeProgrammableTransition,
  serializeProgrammableTransitions
} from "../src/programmable-transitions.js";

test("transition normalization applies deterministic easing and direction defaults", () => {
  assert.deepEqual(
    [
      normalizeProgrammableTransition({ kind: "fade", durationInFrames: 10 }),
      normalizeProgrammableTransition({ kind: "slide", durationInFrames: 12 }),
      normalizeProgrammableTransition({ kind: "wipe", durationInFrames: 8, direction: "right" }),
      normalizeProgrammableTransition({ kind: "push", durationInFrames: 6, direction: "up" }),
      normalizeProgrammableTransition({ kind: "zoom", durationInFrames: 14, easing: "ease-out" }),
      normalizeProgrammableTransition({ kind: "iris", durationInFrames: 16, easing: "ease-in-out" })
    ],
    [
      { kind: "fade", durationInFrames: 10, easing: "linear" },
      { kind: "slide", durationInFrames: 12, easing: "linear", direction: "left" },
      { kind: "wipe", durationInFrames: 8, easing: "linear", direction: "right" },
      { kind: "push", durationInFrames: 6, easing: "linear", direction: "up" },
      { kind: "zoom", durationInFrames: 14, easing: "ease-out" },
      { kind: "iris", durationInFrames: 16, easing: "ease-in-out" }
    ]
  );
});

test("transition pairs freeze normalized values and serialize deterministically", () => {
  const transitions = normalizeProgrammableTransitions({
    in: { kind: "slide", durationInFrames: 9, direction: "down" },
    out: { kind: "iris", durationInFrames: 7 }
  });

  assert.equal(Object.isFrozen(transitions), true);
  assert.equal(Object.isFrozen(transitions.in), true);
  assert.equal(Object.isFrozen(transitions.out), true);
  assert.equal(
    serializeProgrammableTransition({ kind: "wipe", durationInFrames: 5 }),
    '{"kind":"wipe","durationInFrames":5,"easing":"linear","direction":"left"}'
  );
  assert.equal(
    serializeProgrammableTransitions({
      in: { kind: "zoom", durationInFrames: 4, easing: "ease-in" },
      out: { kind: "fade", durationInFrames: 3 }
    }),
    '{"in":{"kind":"zoom","durationInFrames":4,"easing":"ease-in"},"out":{"kind":"fade","durationInFrames":3,"easing":"linear"}}'
  );
});

test("invalid transition values fail with typed validation errors", () => {
  assert.throws(
    () => normalizeProgrammableTransition({ kind: "fade", durationInFrames: 0 }),
    InvalidProgrammableTransitionError
  );
  assert.throws(
    () => normalizeProgrammableTransition({
      kind: "slide",
      durationInFrames: 5,
      direction: "diagonal" as never
    }),
    /direction is not supported/
  );
  assert.throws(
    () => normalizeProgrammableTransition({
      kind: "zoom",
      durationInFrames: 5,
      easing: "spring" as never
    }),
    /easing is not supported/
  );
  assert.throws(
    () => normalizeProgrammableTransitions({}),
    /must define an in or out transition/
  );
});

test("browser entry exposes the same transition normalization contract", async () => {
  const browser = await import("../src/browser.js");
  assert.deepEqual(
    browser.normalizeProgrammableTransitions({
      in: { kind: "push", durationInFrames: 11, direction: "right" },
      out: { kind: "iris", durationInFrames: 6, easing: "ease-out" }
    }),
    {
      in: { kind: "push", durationInFrames: 11, easing: "linear", direction: "right" },
      out: { kind: "iris", durationInFrames: 6, easing: "ease-out" }
    }
  );
});

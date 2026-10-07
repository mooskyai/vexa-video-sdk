import assert from "node:assert/strict";
import test from "node:test";
import {
  clampFrameToRange,
  createFrameContext,
  createFrameRange,
  easeInOutQuad,
  easeInQuad,
  easeOutQuad,
  frameRangeContains,
  frameRangeLocalFrame,
  frameToSeconds,
  freezeFrameContext,
  interpolate,
  interpolateColor,
  InvalidProgrammableTimingError,
  linearEasing,
  loopFrame,
  loopFrameContext,
  offsetFrameContext,
  resolveSeries,
  secondsToFrame,
  seededRandom,
  seriesSectionAtFrame,
  spring
} from "../src/index.js";

import {
  createFrameContext as createBrowserFrameContext,
  interpolate as browserInterpolate,
  interpolateColor as browserInterpolateColor,
  loopFrameContext as browserLoopFrameContext,
  resolveSeries as browserResolveSeries,
  seededRandom as browserSeededRandom,
  spring as browserSpring
} from "../src/browser.js";

test("frame context preserves root frame across nested local offsets", () => {
  const root = createFrameContext(100, 30);
  const sequence = offsetFrameContext(root, 40);
  const nested = offsetFrameContext(sequence, 10);
  assert.deepEqual(root, { frame: 100, absoluteFrame: 100, fps: 30 });
  assert.deepEqual(sequence, { frame: 60, absoluteFrame: 100, fps: 30 });
  assert.deepEqual(nested, { frame: 50, absoluteFrame: 100, fps: 30 });
  assert.deepEqual(offsetFrameContext(createFrameContext(5, 30), 10), {
    frame: -5,
    absoluteFrame: 5,
    fps: 30
  });
});

test("freeze context fixes local time without mutating absolute time", () => {
  const frozen = freezeFrameContext(offsetFrameContext(createFrameContext(75, 25), 20), 12);
  assert.deepEqual(frozen, { frame: 12, absoluteFrame: 75, fps: 25 });
});

test("frame and second conversion has explicit deterministic rounding", () => {
  assert.equal(frameToSeconds(15, 30), 0.5);
  assert.equal(secondsToFrame(0.51, 30, "none"), 15.3);
  assert.equal(secondsToFrame(0.51, 30), 15);
  assert.equal(secondsToFrame(0.51, 30, "floor"), 15);
  assert.equal(secondsToFrame(0.51, 30, "ceil"), 16);
  assert.equal(secondsToFrame(0.52, 30, "round"), 16);
});

test("frame ranges expose frame zero, final frame, local frame, and clamping", () => {
  const range = createFrameRange(10, 5);
  assert.deepEqual(range, { startFrame: 10, durationInFrames: 5, endFrameExclusive: 15, lastFrame: 14 });
  assert.equal(frameRangeContains(range, 10), true);
  assert.equal(frameRangeContains(range, 14), true);
  assert.equal(frameRangeContains(range, 15), false);
  assert.equal(frameRangeLocalFrame(range, 12), 2);
  assert.equal(clampFrameToRange(range, 3), 10);
  assert.equal(clampFrameToRange(range, 99), 14);
});

test("interpolation is piecewise and supports extend, clamp, and identity extrapolation", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(interpolate(15, [0, 10, 20], [0, 100, 0]), 50);
  assert.equal(interpolate(-5, [0, 10], [0, 100]), -50);
  assert.equal(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "clamp" }), 0);
  assert.equal(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "identity" }), -5);
  assert.equal(interpolate(15, [0, 10], [0, 100], { extrapolateRight: "clamp" }), 100);
  assert.equal(interpolate(15, [0, 10], [0, 100], { extrapolateRight: "identity" }), 15);
});

test("interpolation applies easing per segment and preserves easing endpoints", () => {
  assert.equal(linearEasing(0), 0);
  assert.equal(linearEasing(1), 1);
  assert.equal(easeInQuad(0), 0);
  assert.equal(easeInQuad(1), 1);
  assert.equal(easeOutQuad(0), 0);
  assert.equal(easeOutQuad(1), 1);
  assert.equal(easeInOutQuad(0), 0);
  assert.equal(easeInOutQuad(1), 1);
  assert.equal(interpolate(5, [0, 10], [0, 100], { easing: easeInQuad }), 25);
});

test("color interpolation accepts hex and rgba input and emits canonical rgba", () => {
  assert.equal(interpolateColor(0, [0, 10], ["#000", "#fff"]), "rgba(0, 0, 0, 1)");
  assert.equal(interpolateColor(5, [0, 10], ["#000", "#fff"]), "rgba(128, 128, 128, 1)");
  assert.equal(
    interpolateColor(5, [0, 10], ["rgba(255, 0, 0, 0)", "#0000ffff"]),
    "rgba(128, 0, 128, 0.5)"
  );
  assert.equal(
    interpolateColor(-1, [0, 10], ["#112233", "#ffffff"], { extrapolateLeft: "clamp" }),
    "rgba(17, 34, 51, 1)"
  );
});

test("spring starts exactly at from and converges deterministically", () => {
  assert.equal(spring({ frame: 0, fps: 30, from: 4, to: 10 }), 4);
  const late = spring({ frame: 300, fps: 30, from: 0, to: 1 });
  assert.ok(Math.abs(late - 1) < 1e-9);
  assert.equal(
    spring({ frame: 11, fps: 30, from: 0, to: 1, damping: 1, overshootClamping: true }) <= 1,
    true
  );
});

test("seeded random is stable, index-addressable, and bounded", () => {
  const first = seededRandom("vexa", 0);
  assert.equal(first, seededRandom("vexa", 0));
  assert.notEqual(first, seededRandom("vexa", 1));
  assert.notEqual(first, seededRandom("other", 0));
  assert.ok(first >= 0 && first < 1);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => seededRandom(42, index)),
    Array.from({ length: 5 }, (_, index) => seededRandom(42, index))
  );
});

test("loop behavior is stable at positive and negative boundaries", () => {
  assert.equal(loopFrame(0, 10), 0);
  assert.equal(loopFrame(9, 10), 9);
  assert.equal(loopFrame(10, 10), 0);
  assert.equal(loopFrame(21, 10), 1);
  assert.equal(loopFrame(-1, 10), 9);
  assert.deepEqual(loopFrameContext(createFrameContext(21, 30), 10), {
    frame: 1,
    absoluteFrame: 21,
    fps: 30
  });
});

test("series sections resolve deterministic offsets, gaps, and overlaps", () => {
  const sections = resolveSeries([
    { id: "intro", durationInFrames: 30 },
    { id: "body", durationInFrames: 60, offsetFrames: 5 },
    { id: "outro", durationInFrames: 20, offsetFrames: -10 }
  ]);
  assert.deepEqual(sections, [
    { index: 0, id: "intro", offsetFrames: 0, startFrame: 0, durationInFrames: 30, endFrameExclusive: 30, lastFrame: 29 },
    { index: 1, id: "body", offsetFrames: 5, startFrame: 35, durationInFrames: 60, endFrameExclusive: 95, lastFrame: 94 },
    { index: 2, id: "outro", offsetFrames: -10, startFrame: 85, durationInFrames: 20, endFrameExclusive: 105, lastFrame: 104 }
  ]);
  assert.deepEqual(seriesSectionAtFrame(sections, 90).map((section) => section.id), ["body", "outro"]);
});

test("invalid timing input fails before evaluation", () => {
  assert.throws(() => createFrameContext(-1, 30), InvalidProgrammableTimingError);
  assert.throws(() => createFrameContext(0, 0), InvalidProgrammableTimingError);
  assert.throws(() => createFrameRange(0, 0), InvalidProgrammableTimingError);
  assert.throws(() => interpolate(1, [0, 0], [0, 1]), InvalidProgrammableTimingError);
  assert.throws(() => interpolateColor(1, [0, 1], ["red", "blue"]), InvalidProgrammableTimingError);
  assert.throws(() => spring({ frame: 1, fps: 30, mass: 0 }), InvalidProgrammableTimingError);
  assert.throws(() => resolveSeries([{ id: "x", durationInFrames: 1 }, { id: "x", durationInFrames: 1 }]), InvalidProgrammableTimingError);
});

test("browser entry exposes the same deterministic timing vector as the core entry", () => {
  const root = createFrameContext(61, 30);
  const browserRoot = createBrowserFrameContext(61, 30);
  assert.deepEqual(browserRoot, root);
  assert.equal(browserInterpolate(7, [0, 10], [10, 20], { extrapolateLeft: "clamp" }), interpolate(7, [0, 10], [10, 20], { extrapolateLeft: "clamp" }));
  assert.equal(browserInterpolateColor(3, [0, 6], ["#123456", "#abcdef"]), interpolateColor(3, [0, 6], ["#123456", "#abcdef"]));
  assert.ok(Math.abs(browserSpring({ frame: 17, fps: 30, damping: 12 }) - spring({ frame: 17, fps: 30, damping: 12 })) <= 1e-12);
  assert.equal(browserSeededRandom("parity", 9), seededRandom("parity", 9));
  assert.deepEqual(browserLoopFrameContext(browserRoot, 24), loopFrameContext(root, 24));
  assert.deepEqual(
    browserResolveSeries([{ durationInFrames: 10 }, { durationInFrames: 5, offsetFrames: -2 }]),
    resolveSeries([{ durationInFrames: 10 }, { durationInFrames: 5, offsetFrames: -2 }])
  );
});

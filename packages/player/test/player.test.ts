import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  VexaPlayerError,
  VEXA_DEFAULT_PLAYER_CONTROLS,
  calculateVexaPlayerScale,
  createVexaPlayerController,
  exitVexaFullscreen,
  getVexaFullscreenCapability,
  normalizeVexaPlayerConfig,
  playerConfigFromCompositionMetadata,
  requestVexaFullscreen
} from "../src/index.js";

test("player config and initial snapshot are deterministic", () => {
  const controller = createVexaPlayerController({
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300,
    posterFrame: 15
  });
  const state = controller.getSnapshot();
  assert.equal(state.status, "idle");
  assert.equal(state.frame, 0);
  assert.equal(state.presentedFrame, 15);
  assert.equal(state.playing, false);
  assert.equal(state.viewport.scale, 1);
});

test("play pause and typed events use one framework-neutral controller", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 90 });
  const events: string[] = [];
  controller.subscribe((event) => events.push(event.type));
  controller.play();
  assert.equal(controller.getSnapshot().playing, true);
  controller.pause();
  assert.equal(controller.getSnapshot().status, "paused");
  assert.deepEqual(events, ["play", "statechange", "pause", "statechange"]);
});

test("seek by frame and seconds clamps to valid composition frames", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 25, durationInFrames: 100 });
  controller.seekToFrame(24.6);
  assert.equal(controller.getSnapshot().frame, 25);
  controller.seekToSeconds(2);
  assert.equal(controller.getSnapshot().frame, 50);
  controller.seekToFrame(999);
  assert.equal(controller.getSnapshot().frame, 99);
  controller.seekToFrame(-5);
  assert.equal(controller.getSnapshot().frame, 0);
});

test("frame stepping moves forward and backward without escaping the range", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 10 });
  controller.stepFrames(3);
  assert.equal(controller.getSnapshot().frame, 3);
  controller.stepFrames(-10);
  assert.equal(controller.getSnapshot().frame, 0);
  controller.stepFrames(50);
  assert.equal(controller.getSnapshot().frame, 9);
});

test("non-loop playback reaches the final frame and emits ended", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 10, durationInFrames: 5 });
  const events: string[] = [];
  controller.subscribe((event) => events.push(event.type));
  controller.play();
  controller.advanceByMilliseconds(1000);
  const state = controller.getSnapshot();
  assert.equal(state.frame, 4);
  assert.equal(state.playing, false);
  assert.equal(state.ended, true);
  assert.equal(state.status, "ended");
  assert.ok(events.includes("ended"));
});

test("loop playback wraps deterministically and reports wrap count", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 10, durationInFrames: 5, loop: true });
  let wraps = 0;
  controller.subscribe((event) => {
    if (event.type === "loop") wraps += event.wraps;
  });
  controller.play();
  controller.advanceByMilliseconds(1200);
  assert.equal(controller.getSnapshot().frame, 2);
  assert.equal(controller.getSnapshot().playing, true);
  assert.equal(wraps, 2);
});

test("playback rate and fractional frame carry stay deterministic", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 300 });
  controller.setPlaybackRate(0.5);
  controller.play();
  controller.advanceByMilliseconds(100);
  assert.equal(controller.getSnapshot().frame, 1);
  controller.advanceByMilliseconds(100);
  assert.equal(controller.getSnapshot().frame, 3);
});

test("volume and mute expose effective browser output volume", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 30 });
  controller.setVolume(0.25);
  assert.equal(controller.getSnapshot().effectiveVolume, 0.25);
  controller.setMuted(true);
  assert.equal(controller.getSnapshot().effectiveVolume, 0);
  controller.toggleMuted();
  assert.equal(controller.getSnapshot().effectiveVolume, 0.25);
});

test("buffering blocks advancement without changing play intent", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 60 });
  controller.play();
  controller.setBuffering(true);
  controller.advanceByMilliseconds(1000);
  assert.equal(controller.getSnapshot().frame, 0);
  assert.equal(controller.getSnapshot().playing, true);
  controller.setBuffering(false);
  controller.advanceByMilliseconds(100);
  assert.equal(controller.getSnapshot().frame, 3);
});

test("responsive scaling supports contain cover and actual modes", () => {
  assert.equal(calculateVexaPlayerScale(1920, 1080, 960, 800, "contain").scale, 0.5);
  assert.equal(calculateVexaPlayerScale(1920, 1080, 960, 800, "cover").scale, 800 / 1080);
  assert.equal(calculateVexaPlayerScale(1920, 1080, 960, 800, "actual").scale, 1);
});

test("poster frame is used only before playback or seeking starts", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 60, posterFrame: 20 });
  assert.equal(controller.getSnapshot().presentedFrame, 20);
  controller.seekToFrame(2);
  assert.equal(controller.getSnapshot().presentedFrame, 2);
});

test("fullscreen helpers expose capability and typed failure paths", async () => {
  let requested = false;
  let exited = false;
  const target = { requestFullscreen: async () => { requested = true; } };
  const documentLike = { fullscreenElement: null, exitFullscreen: async () => { exited = true; } };
  assert.deepEqual(getVexaFullscreenCapability(target, documentLike), { request: true, exit: true, active: false });
  await requestVexaFullscreen(target, documentLike);
  await exitVexaFullscreen(documentLike);
  assert.equal(requested, true);
  assert.equal(exited, true);
  await assert.rejects(
    () => requestVexaFullscreen({}, documentLike),
    (error: unknown) => error instanceof VexaPlayerError && error.code === "FULLSCREEN_UNAVAILABLE"
  );
});

test("error event pauses playback and clearError returns to paused state", () => {
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 60 });
  let message = "";
  controller.subscribe((event) => {
    if (event.type === "error") message = event.error;
  });
  controller.play();
  controller.setError("frame renderer failed");
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(controller.getSnapshot().playing, false);
  assert.equal(message, "frame renderer failed");
  controller.clearError();
  assert.equal(controller.getSnapshot().status, "paused");
});

test("default control descriptors are keyboard reachable and accessibly labelled", () => {
  assert.deepEqual(VEXA_DEFAULT_PLAYER_CONTROLS.map((control) => control.id), ["play", "seek", "mute", "fullscreen"]);
  for (const control of VEXA_DEFAULT_PLAYER_CONTROLS) {
    assert.equal(control.keyboardReachable, true);
    assert.ok(control.ariaLabel.length > 0);
  }
});

test("composition metadata converts into player config without redefining timing", () => {
  const config = playerConfigFromCompositionMetadata({
    schemaVersion: 1,
    kind: "video",
    id: "demo",
    width: 1280,
    height: 720,
    fps: 24,
    durationInFrames: 240,
    defaultProps: {}
  }, { loop: true });
  assert.deepEqual(config, {
    width: 1280,
    height: 720,
    fps: 24,
    durationInFrames: 240,
    loop: true
  });
});

test("invalid config and controller disposal fail eagerly", () => {
  assert.throws(
    () => normalizeVexaPlayerConfig({ width: 0, height: 180, fps: 30, durationInFrames: 30 }),
    VexaPlayerError
  );
  const controller = createVexaPlayerController({ width: 320, height: 180, fps: 30, durationInFrames: 30 });
  controller.dispose();
  assert.throws(() => controller.play(), (error: unknown) => error instanceof VexaPlayerError && error.code === "PLAYER_DISPOSED");
});

test("player package source has no Node SDK FFmpeg Redis or filesystem runtime imports", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:/u);
  assert.doesNotMatch(source, /child_process/u);
  assert.doesNotMatch(source, /@vexa-video\/sdk/u);
  assert.doesNotMatch(source, /@vexa-video\/ffmpeg/u);
  assert.doesNotMatch(source, /\bredis\b/iu);
  assert.doesNotMatch(source, /node:fs|filesystem-only/iu);
});

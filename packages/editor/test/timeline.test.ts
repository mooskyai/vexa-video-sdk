import assert from "node:assert/strict";
import test from "node:test";
import type { VideoProjectAst } from "@vexa-video/core/browser";
import {
  TimelineHistory,
  applyTimelineEditorCommand,
  createTimelineEditorState,
  snapTimelineTime
} from "../src/timeline.js";

const project: VideoProjectAst = {
  schemaVersion: 1,
  id: "editor-test",
  canvas: { width: 1280, height: 720, fps: 30 },
  tracks: [{
    id: "video",
    type: "video",
    clips: [{ id: "clip-1", kind: "video", source: "a.mp4", start: 0, duration: 5 }]
  }]
};

test("timeline editor snaps and moves clips immutably", () => {
  const state = createTimelineEditorState(project, { snapSeconds: 0.25 });
  const next = applyTimelineEditorCommand(state, {
    type: "move-clip",
    trackId: "video",
    clipId: "clip-1",
    start: 1.13
  });
  assert.equal(next.project.tracks[0]?.clips[0]?.start, 1.25);
  assert.equal(state.project.tracks[0]?.clips[0]?.start, 0);
  assert.equal(snapTimelineTime(1.12, 0.25), 1);
});

test("timeline history supports undo and redo", () => {
  const history = new TimelineHistory(createTimelineEditorState(project));
  history.dispatch({ type: "playhead", seconds: 4 });
  assert.equal(history.state.playheadSeconds, 4);
  history.undo();
  assert.equal(history.state.playheadSeconds, 0);
  history.redo();
  assert.equal(history.state.playheadSeconds, 4);
});

test("timeline history can synchronize transient state without changing undo history", () => {
  const history = new TimelineHistory(createTimelineEditorState(project));
  history.dispatch({ type: "playhead", seconds: 2 });
  history.sync({ type: "playhead", seconds: 3 });
  assert.equal(history.state.playheadSeconds, 3);
  history.undo();
  assert.equal(history.state.playheadSeconds, 0);
});

test("locked tracks reject editor mutations", () => {
  const locked: VideoProjectAst = {
    ...project,
    tracks: [{ ...project.tracks[0]!, locked: true }]
  };
  const state = createTimelineEditorState(locked);
  assert.throws(() => applyTimelineEditorCommand(state, {
    type: "move-clip",
    trackId: "video",
    clipId: "clip-1",
    start: 2
  }), /locked/u);
});

test("editor package source stays browser-safe", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const source = await readFile(resolve(process.cwd(), "packages/editor/src/timeline.ts"), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:/u);
  assert.doesNotMatch(source, /@vexa-video\/sdk/u);
  assert.doesNotMatch(source, /child_process/u);
});

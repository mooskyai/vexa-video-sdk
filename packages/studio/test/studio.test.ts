import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type {
  ProgrammableCompositionStaticMetadata,
  ResolvedProgrammableComposition
} from "@vexa-video/core/browser";
import {
  VexaStudioError,
  createVexaStudioSession,
  preserveVexaStudioFrame
} from "../src/index.ts";

const productDemo: ProgrammableCompositionStaticMetadata = {
  schemaVersion: 1,
  kind: "video",
  id: "product-demo",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 300,
  defaultProps: { title: "Vexa" }
};

const socialSquare: ProgrammableCompositionStaticMetadata = {
  schemaVersion: 1,
  kind: "still",
  id: "social-square",
  width: 1080,
  height: 1080,
  defaultProps: { title: "Square" }
};

const verticalStory: ProgrammableCompositionStaticMetadata = {
  schemaVersion: 1,
  kind: "video",
  id: "vertical-story",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 180,
  defaultProps: {}
};

test("Studio catalog ordering and initial selection are deterministic", () => {
  const studio = createVexaStudioSession({
    compositions: [verticalStory, productDemo, socialSquare]
  });
  const snapshot = studio.getSnapshot();
  assert.deepEqual(snapshot.compositions.map((composition) => composition.id), [
    "product-demo",
    "social-square",
    "vertical-story"
  ]);
  assert.equal(snapshot.selectedComposition.id, "product-demo");
  assert.equal(snapshot.frame, 0);
  assert.equal(snapshot.timeline.project.canvas.fps, 30);
  studio.dispose();
});

test("Studio keeps Player and editor playhead state synchronized", () => {
  const studio = createVexaStudioSession({ compositions: [productDemo] });
  studio.seekFrame(45);
  let snapshot = studio.getSnapshot();
  assert.equal(snapshot.frame, 45);
  assert.equal(snapshot.timeline.playheadSeconds, 1.5);

  studio.play();
  studio.advanceByMilliseconds(500);
  snapshot = studio.getSnapshot();
  assert.equal(snapshot.frame, 60);
  assert.equal(snapshot.timeline.playheadSeconds, 2);
  assert.equal(snapshot.playing, true);
  studio.pause();
  studio.dispose();
});

test("Studio draft props and resolved dynamic metadata remain separate", () => {
  const studio = createVexaStudioSession({ compositions: [productDemo] });
  studio.seekFrame(90);
  studio.setProps({ title: "Dynamic" });
  let snapshot = studio.getSnapshot();
  assert.equal(snapshot.propsDirty, true);
  assert.equal(snapshot.resolvedMetadata.kind, "video");
  if (snapshot.resolvedMetadata.kind !== "video") assert.fail("expected video metadata");
  assert.equal(snapshot.resolvedMetadata.fps, 30);

  const resolved: ResolvedProgrammableComposition = {
    metadata: {
      schemaVersion: 1,
      kind: "video",
      id: "product-demo",
      width: 1280,
      height: 720,
      fps: 24,
      durationInFrames: 120
    },
    props: { title: "Dynamic" }
  };
  studio.applyResolvedComposition(resolved);
  snapshot = studio.getSnapshot();
  assert.equal(snapshot.propsDirty, false);
  assert.equal(snapshot.frame, 90);
  assert.equal(snapshot.timeline.project.canvas.fps, 24);
  assert.equal(snapshot.timeline.playheadSeconds, 3.75);
  studio.dispose();
});

test("Studio clamps preserved frames when resolved duration becomes shorter", () => {
  const studio = createVexaStudioSession({ compositions: [productDemo] });
  studio.seekFrame(250);
  studio.applyResolvedComposition({
    metadata: {
      schemaVersion: 1,
      kind: "video",
      id: "product-demo",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 60
    },
    props: { title: "Vexa" }
  });
  assert.equal(studio.getSnapshot().frame, 59);
  studio.dispose();
});

test("Studio reload preserves selected frame and draft props for safe same-composition reloads", () => {
  const studio = createVexaStudioSession({ compositions: [productDemo, socialSquare] });
  studio.seekFrame(72);
  studio.setProps({ title: "Keep me" });
  studio.reloadCompositions([
    { ...productDemo, durationInFrames: 90, defaultProps: { title: "New default" } },
    socialSquare
  ]);
  const snapshot = studio.getSnapshot();
  assert.equal(snapshot.selectedComposition.id, "product-demo");
  assert.equal(snapshot.frame, 72);
  assert.deepEqual(snapshot.props, { title: "Keep me" });
  assert.equal(snapshot.propsDirty, true);
  studio.dispose();
});

test("Studio selection resets props and still compositions stay on frame zero", () => {
  const studio = createVexaStudioSession({ compositions: [productDemo, socialSquare] });
  studio.setProps({ title: "Draft" });
  studio.selectComposition("social-square");
  const snapshot = studio.getSnapshot();
  assert.equal(snapshot.frame, 0);
  assert.equal(snapshot.player, null);
  assert.equal(snapshot.propsDirty, false);
  assert.deepEqual(snapshot.props, { title: "Square" });
  assert.throws(
    () => studio.play(),
    (error: unknown) => error instanceof VexaStudioError && error.code === "PLAYBACK_UNAVAILABLE"
  );
  studio.dispose();
});

test("Studio rejects mismatched dynamic metadata and missing compositions", () => {
  const studio = createVexaStudioSession({ compositions: [productDemo] });
  assert.throws(
    () => studio.selectComposition("missing"),
    (error: unknown) => error instanceof VexaStudioError && error.code === "COMPOSITION_NOT_FOUND"
  );
  assert.throws(
    () => studio.applyResolvedComposition({
      metadata: {
        schemaVersion: 1,
        kind: "still",
        id: "other",
        width: 100,
        height: 100
      },
      props: {}
    }),
    (error: unknown) => error instanceof VexaStudioError && error.code === "COMPOSITION_MISMATCH"
  );
  studio.dispose();
});

test("Studio frame preservation helper follows resolved composition bounds", () => {
  assert.equal(preserveVexaStudioFrame(91.7, {
    schemaVersion: 1,
    kind: "video",
    id: "video",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 60
  }), 59);
  assert.equal(preserveVexaStudioFrame(25, {
    schemaVersion: 1,
    kind: "still",
    id: "still",
    width: 1080,
    height: 1080
  }), 0);
});

test("Studio browser runtime does not import Node execution packages", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "node:",
    "child_process",
    "@vexa-video/sdk",
    "@vexa-video/renderer",
    "@vexa-video/ffmpeg",
    "redis"
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected browser-boundary import: ${forbidden}`);
  }
});

test("Studio Playground client is syntactically valid and keeps Node work behind the development host", async () => {
  const { resolve } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const clientPath = resolve(process.cwd(), "examples/visual-playground/public/studio-workspace.js");
  const client = await readFile(clientPath, "utf8");

  assert.match(client, /createVexaStudioSession/u);
  assert.match(client, /evaluateExecutableComposition/u);
  assert.match(client, /\/api\/compositions\/build/u);
  assert.match(client, /\/api\/compositions\/render/u);
  assert.doesNotMatch(client, /from\s+["']node:/u);
  assert.doesNotMatch(client, /@vexa-video\/(?:sdk|renderer|ffmpeg)/u);

  const syntax = spawnSync(process.execPath, ["--check", clientPath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  const creativeUiPath = resolve(
    process.cwd(),
    "examples/visual-playground/public/vexa-next-ui.js"
  );
  const creativeUi = await readFile(creativeUiPath, "utf8");
  assert.match(creativeUi, /vexa-creative-ui/u);
  assert.match(creativeUi, /installStudioEnhancements/u);
  assert.doesNotMatch(creativeUi, /from\s+["']node:/u);
  assert.doesNotMatch(creativeUi, /@vexa-video\/(?:sdk|renderer|ffmpeg)/u);

  const creativeUiSyntax = spawnSync(process.execPath, ["--check", creativeUiPath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(creativeUiSyntax.status, 0, creativeUiSyntax.stderr || creativeUiSyntax.stdout);

  const server = await readFile(
    resolve(process.cwd(), "examples/visual-playground/server.mjs"),
    "utf8"
  );
  assert.match(server, /packages\/studio\/dist/u);
  assert.match(server, /packages\/editor\/dist/u);
  assert.match(server, /composition-bundle/u);
});

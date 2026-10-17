import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  VexaSoundEffectError,
  createSoundEffectLibrary
} from "../src/index.js";

test("creates deterministic reusable audio assets and nodes", () => {
  const sounds = createSoundEffectLibrary({
    effects: {
      success: { kind: "static", src: "/media/success.wav" },
      click: {
        source: { kind: "static", src: "/media/click.wav" },
        preload: "metadata",
        sourceStartSeconds: 0.1,
        playbackRate: 0.95,
        volume: 0.7,
        muted: false
      }
    }
  });

  assert.deepEqual(sounds.effectIds, ["click", "success"]);
  assert.deepEqual(sounds.assets.map((asset) => asset.id), ["sfx.click", "sfx.success"]);
  assert.deepEqual(sounds.getAsset(" click "), {
    id: "sfx.click",
    kind: "audio",
    source: { kind: "static", src: "/media/click.wav" },
    preload: "metadata"
  });
  assert.deepEqual(sounds.createNode("click", {
    id: "click-1",
    startFrame: 12,
    durationInFrames: 18
  }), {
    kind: "audio",
    id: "click-1",
    assetId: "sfx.click",
    startFrame: 12,
    durationInFrames: 18,
    sourceStartSeconds: 0.1,
    playbackRate: 0.95,
    volume: 0.7,
    muted: false
  });
  assert.deepEqual(sounds.createNode("click", {
    id: "click-2",
    startFrame: 60,
    durationInFrames: 20,
    sourceStartSeconds: 0.25,
    playbackRate: 1.2,
    volume: 0.4,
    muted: true
  }), {
    kind: "audio",
    id: "click-2",
    assetId: "sfx.click",
    startFrame: 60,
    durationInFrames: 20,
    sourceStartSeconds: 0.25,
    playbackRate: 1.2,
    volume: 0.4,
    muted: true
  });
  assert.equal(sounds.has("success"), true);
  assert.equal(sounds.has("missing"), false);
});

test("accepts storage-backed sources without introducing a Node execution dependency", () => {
  const source = {
    kind: "storage" as const,
    source: {
      kind: "local" as const,
      path: "assets/click.wav"
    }
  };
  const sounds = createSoundEffectLibrary({
    assetIdPrefix: "audio.effect.",
    effects: { click: source }
  });

  assert.deepEqual(sounds.assets, [{
    id: "audio.effect.click",
    kind: "audio",
    source
  }]);
});

test("rejects invalid catalogs, missing effects, and invalid instances", () => {
  assert.throws(
    () => createSoundEffectLibrary({ effects: {} }),
    (error: unknown) => error instanceof VexaSoundEffectError && error.code === "INVALID_SOUND_EFFECT_LIBRARY"
  );
  assert.throws(
    () => createSoundEffectLibrary({
      effects: {
        " click ": { kind: "static", src: "a.wav" },
        click: { kind: "static", src: "b.wav" }
      }
    }),
    (error: unknown) => error instanceof VexaSoundEffectError && error.code === "INVALID_SOUND_EFFECT_LIBRARY"
  );

  const sounds = createSoundEffectLibrary({
    effects: { click: { kind: "static", src: "click.wav" } }
  });
  assert.throws(
    () => sounds.getAsset("missing"),
    (error: unknown) => error instanceof VexaSoundEffectError && error.code === "SOUND_EFFECT_NOT_FOUND"
  );
  assert.throws(
    () => sounds.createNode("click", { id: "bad", durationInFrames: 0 }),
    (error: unknown) => error instanceof VexaSoundEffectError && error.code === "INVALID_SOUND_EFFECT_INSTANCE"
  );
  assert.throws(
    () => sounds.createNode("click", { id: "bad", playbackRate: 0 }),
    (error: unknown) => error instanceof VexaSoundEffectError && error.code === "INVALID_SOUND_EFFECT_INSTANCE"
  );
});

test("package dependency boundary stays browser-safe", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
    dependencies?: Record<string, string>;
  };
  assert.deepEqual(manifest.dependencies, { "@vexa-video/core": manifest.version });
});

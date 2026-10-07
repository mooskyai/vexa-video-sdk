import assert from "node:assert/strict";
import test from "node:test";
import {
  createProgrammableSceneRenderGraph as createBrowserProgrammableSceneRenderGraph,
  defineProgrammableScene as defineBrowserProgrammableScene,
  serializeProgrammableScene as serializeBrowserProgrammableScene
} from "../src/browser.js";
import {
  InvalidProgrammableSceneError,
  ProgrammableSceneAssetPolicyError,
  ProgrammableSceneAssetUnresolvedError,
  UnsupportedProgrammableSceneLoweringError,
  collectProgrammableSceneAssets,
  createProgrammableSceneAssetReadiness,
  createProgrammableSceneRenderGraph,
  defineProgrammableScene,
  lowerProgrammableSceneToVideoProject,
  programmableSceneAssetsReady,
  serializeProgrammableScene,
  updateProgrammableSceneAssetReadiness
} from "../src/programmable-scene.js";

function baseAssets() {
  return [
    { id: "video", kind: "video" as const, source: { kind: "storage" as const, source: { kind: "local" as const, path: "video.mp4" } } },
    { id: "image", kind: "image" as const, source: { kind: "static" as const, src: "assets/card.png" } },
    { id: "audio", kind: "audio" as const, source: { kind: "storage" as const, source: { kind: "local" as const, path: "music.m4a" } } }
  ];
}

test("scene definition sorts assets and serializes deterministically", () => {
  const scene = defineProgrammableScene({
    id: "demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
    assets: [baseAssets()[0]!, baseAssets()[2]!, baseAssets()[1]!],
    children: []
  });
  assert.deepEqual(scene.assets.map((asset) => asset.id), ["audio", "image", "video"]);
  assert.equal(serializeProgrammableScene(scene), serializeProgrammableScene(defineProgrammableScene({
    id: "demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
    assets: [baseAssets()[1]!, baseAssets()[0]!, baseAssets()[2]!],
    children: []
  })));
});

test("nested groups resolve timing, z-order, opacity, and transform chains", () => {
  const scene = defineProgrammableScene({
    id: "nested",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 120,
    children: [{
      id: "group",
      kind: "group",
      startFrame: 10,
      durationInFrames: 80,
      zIndex: 2,
      opacity: 0.5,
      transform: { x: 20, y: 10 },
      children: [{
        id: "layer",
        kind: "layer",
        startFrame: 5,
        durationInFrames: 60,
        zIndex: 3,
        opacity: 0.8,
        children: [{
          id: "title",
          kind: "text",
          startFrame: 2,
          durationInFrames: 30,
          zIndex: -1,
          opacity: 0.5,
          transform: { x: 4, rotation: 5 },
          text: "Vexa"
        }]
      }]
    }]
  });
  const [item] = createProgrammableSceneRenderGraph(scene).items;
  if (!item) throw new Error("expected one render item");
  assert.equal(item.absoluteStartFrame, 17);
  assert.equal(item.absoluteEndFrame, 47);
  assert.equal(item.zIndex, 4);
  assert.equal(item.opacity, 0.2);
  assert.deepEqual(item.path, ["group", "layer", "title"]);
  assert.deepEqual(item.transformChain, [{ x: 20, y: 10 }, { x: 4, rotation: 5 }]);
});

test("z-index ties preserve deterministic declaration order", () => {
  const scene = defineProgrammableScene({
    id: "z",
    width: 100,
    height: 100,
    fps: 30,
    durationInFrames: 30,
    children: [
      { id: "back", kind: "fill", color: "black", zIndex: 0 },
      { id: "front-a", kind: "text", text: "A", zIndex: 2 },
      { id: "front-b", kind: "text", text: "B", zIndex: 2 },
      { id: "middle", kind: "text", text: "M", zIndex: 1 }
    ]
  });
  assert.deepEqual(createProgrammableSceneRenderGraph(scene).items.map((item) => item.node.id), [
    "back", "middle", "front-a", "front-b"
  ]);
});

test("image/video crop and fit plus media trim/playback values normalize", () => {
  const scene = defineProgrammableScene({
    id: "media",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 60,
    assets: baseAssets(),
    children: [
      { id: "image", kind: "image", assetId: "image", fit: "contain", crop: { x: 1, y: 2, width: 10, height: 20 } },
      { id: "video", kind: "video", assetId: "video", fit: "cover", sourceStartSeconds: 1.25, playbackRate: 1.5, volume: 0.4, muted: true }
    ]
  });
  const [image, video] = scene.children;
  assert.equal(image?.kind, "image");
  assert.equal(image?.kind === "image" ? image.fit : undefined, "contain");
  assert.deepEqual(image?.kind === "image" ? image.crop : undefined, { x: 1, y: 2, width: 10, height: 20 });
  assert.equal(video?.kind === "video" ? video.sourceStartSeconds : undefined, 1.25);
  assert.equal(video?.kind === "video" ? video.playbackRate : undefined, 1.5);
  assert.equal(video?.kind === "video" ? video.volume : undefined, 0.4);
  assert.equal(video?.kind === "video" ? video.muted : undefined, true);
});

test("missing and kind-mismatched assets fail before evaluation", () => {
  assert.throws(() => defineProgrammableScene({
    id: "missing", width: 10, height: 10, fps: 30, durationInFrames: 10,
    children: [{ id: "image", kind: "image", assetId: "none" }]
  }), InvalidProgrammableSceneError);

  assert.throws(() => defineProgrammableScene({
    id: "wrong-kind", width: 10, height: 10, fps: 30, durationInFrames: 10,
    assets: [{ id: "sound", kind: "audio", source: { kind: "static", src: "sound.m4a" } }],
    children: [{ id: "image", kind: "image", assetId: "sound" }]
  }), InvalidProgrammableSceneError);
});

test("remote asset classes can be rejected by an explicit policy", () => {
  assert.throws(() => defineProgrammableScene({
    id: "remote", width: 10, height: 10, fps: 30, durationInFrames: 10,
    assetPolicy: { allowHttp: false },
    assets: [{
      id: "remote-image",
      kind: "image",
      source: { kind: "storage", source: { kind: "http", url: "https://example.com/image.png" } }
    }]
  }), ProgrammableSceneAssetPolicyError);
});

test("invalid timing, opacity, transforms, crop, playback, and volume reject eagerly", () => {
  const common = { id: "invalid", width: 100, height: 100, fps: 30, durationInFrames: 30 } as const;
  assert.throws(() => defineProgrammableScene({ ...common, children: [{ id: "bad", kind: "text", text: "x", startFrame: 30 }] }), InvalidProgrammableSceneError);
  assert.throws(() => defineProgrammableScene({ ...common, children: [{ id: "bad", kind: "text", text: "x", opacity: 2 }] }), InvalidProgrammableSceneError);
  assert.throws(() => defineProgrammableScene({ ...common, children: [{ id: "bad", kind: "solid", color: "red", width: 10, height: 10, transform: { scaleX: 0 } }] }), InvalidProgrammableSceneError);
  assert.throws(() => defineProgrammableScene({ ...common, assets: [baseAssets()[1]!], children: [{ id: "bad", kind: "image", assetId: "image", crop: { x: 0, y: 0, width: 0, height: 1 } }] }), InvalidProgrammableSceneError);
  assert.throws(() => defineProgrammableScene({ ...common, assets: [baseAssets()[0]!], children: [{ id: "bad", kind: "video", assetId: "video", playbackRate: 0 }] }), InvalidProgrammableSceneError);
  assert.throws(() => defineProgrammableScene({ ...common, assets: [baseAssets()[2]!], children: [{ id: "bad", kind: "audio", assetId: "audio", volume: -1 }] }), InvalidProgrammableSceneError);
});

test("duplicate asset and node ids are rejected", () => {
  assert.throws(() => defineProgrammableScene({
    id: "dupe-assets", width: 10, height: 10, fps: 30, durationInFrames: 10,
    assets: [baseAssets()[1]!, baseAssets()[1]!]
  }), InvalidProgrammableSceneError);
  assert.throws(() => defineProgrammableScene({
    id: "dupe-nodes", width: 10, height: 10, fps: 30, durationInFrames: 10,
    children: [
      { id: "same", kind: "text", text: "a" },
      { id: "same", kind: "text", text: "b" }
    ]
  }), InvalidProgrammableSceneError);
});

test("surface contracts stay serializable and renderer-id based", () => {
  const scene = defineProgrammableScene({
    id: "surface", width: 100, height: 100, fps: 30, durationInFrames: 30,
    children: [{ id: "chart", kind: "surface", surface: { kind: "canvas", rendererId: "chart.v1", data: { points: [1, 2, 3] } } }]
  });
  const node = scene.children[0];
  assert.equal(node?.kind, "surface");
  assert.equal(node?.kind === "surface" ? node.surface.rendererId : undefined, "chart.v1");
  assert.doesNotThrow(() => JSON.parse(serializeProgrammableScene(scene)));
});

test("asset readiness state updates immutably", () => {
  const scene = defineProgrammableScene({
    id: "readiness", width: 10, height: 10, fps: 30, durationInFrames: 10,
    assets: baseAssets()
  });
  const initial = createProgrammableSceneAssetReadiness(scene);
  assert.equal(programmableSceneAssetsReady(initial), false);
  let states = initial;
  for (const asset of collectProgrammableSceneAssets(scene)) {
    states = updateProgrammableSceneAssetReadiness(states, asset.id, "ready");
  }
  assert.equal(programmableSceneAssetsReady(states), true);
  assert.equal(initial.every((state) => state.status === "idle"), true);
  const failed = updateProgrammableSceneAssetReadiness(states, "image", "error", "decode failed");
  assert.equal(failed.find((state) => state.assetId === "image")?.error, "decode failed");
});

test("representable scene lowers deterministically into VideoProjectAst", () => {
  const scene = defineProgrammableScene({
    id: "lower",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 60,
    background: "black",
    assets: baseAssets(),
    children: [
      { id: "video", kind: "video", assetId: "video", durationInFrames: 60, muted: true, transform: { x: 10, y: 5, width: 120, height: 90 }, fit: "fill" },
      { id: "image", kind: "image", assetId: "image", startFrame: 15, durationInFrames: 30, zIndex: 2, transform: { x: 200, y: 100, width: 60, height: 60 }, fit: "contain" },
      { id: "title", kind: "text", text: "Vexa", startFrame: 5, durationInFrames: 40, zIndex: 3, transform: { x: 140, y: 20 }, style: { fontSize: 28, color: "white" } },
      { id: "audio", kind: "audio", assetId: "audio", durationInFrames: 60, volume: 0.25 }
    ]
  });
  const project = lowerProgrammableSceneToVideoProject(scene, { projectId: "project" });
  assert.equal(project.id, "project");
  assert.deepEqual(project.canvas, { width: 320, height: 180, fps: 30, duration: 2, background: "black" });
  assert.deepEqual(project.tracks.map((track) => [track.type, track.clips[0]?.id]), [
    ["video", "video"], ["audio", "audio"], ["image", "image"], ["text", "title"]
  ]);
  const image = project.tracks[2]?.clips[0];
  assert.equal(image?.start, 0.5);
  assert.equal(image?.duration, 1);
});


test("explicit zero x/y survive VideoProject lowering", () => {
  const scene = defineProgrammableScene({
    id: "zero-position",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 60,
    assets: [{
      id: "video",
      kind: "video",
      source: { kind: "storage", source: { kind: "local", path: "video.mp4" } }
    }],
    children: [{
      id: "video",
      kind: "video",
      assetId: "video",
      durationInFrames: 60,
      muted: true,
      fit: "fill",
      transform: { x: 0, y: 0, width: 120, height: 100 }
    }]
  });

  const project = lowerProgrammableSceneToVideoProject(scene);
  const clip = project.tracks[0]?.clips[0];
  assert.equal(clip?.kind, "video");
  assert.deepEqual(clip?.kind === "video" ? clip.transform : undefined, {
    x: 0,
    y: 0,
    width: 120,
    height: 100,
    fit: "fill"
  });
});

test("root full-duration fill lowers to the project background", () => {
  const scene = defineProgrammableScene({
    id: "fill", width: 100, height: 100, fps: 25, durationInFrames: 50,
    children: [{ id: "background", kind: "fill", color: "#112233" }]
  });
  const project = lowerProgrammableSceneToVideoProject(scene);
  assert.equal(project.canvas.background, "#112233");
  assert.equal(project.tracks.length, 0);
});

test("remote assets require explicit storage resolution before VideoProject lowering", () => {
  const scene = defineProgrammableScene({
    id: "remote", width: 10, height: 10, fps: 30, durationInFrames: 10,
    assets: [{ id: "image", kind: "image", source: { kind: "storage", source: { kind: "http", url: "https://example.com/image.png" } } }],
    children: [{ id: "image", kind: "image", assetId: "image" }]
  });
  assert.throws(() => lowerProgrammableSceneToVideoProject(scene), ProgrammableSceneAssetUnresolvedError);
  assert.equal(lowerProgrammableSceneToVideoProject(scene, { resolvedAssets: { image: "cache/image.png" } }).tracks[0]?.clips[0]?.kind, "image");
});

test("unsupported scene features fail with typed lowering errors instead of approximation", () => {
  const scene = defineProgrammableScene({
    id: "unsupported", width: 100, height: 100, fps: 30, durationInFrames: 30,
    assets: [baseAssets()[0]!],
    children: [{ id: "video", kind: "video", assetId: "video", playbackRate: 2 }]
  });
  assert.throws(() => lowerProgrammableSceneToVideoProject(scene), UnsupportedProgrammableSceneLoweringError);

  const surface = defineProgrammableScene({
    id: "surface", width: 100, height: 100, fps: 30, durationInFrames: 30,
    children: [{ id: "surface", kind: "surface", surface: { kind: "svg", rendererId: "logo" } }]
  });
  assert.throws(() => lowerProgrammableSceneToVideoProject(surface), UnsupportedProgrammableSceneLoweringError);
});

test("nested translation-only transforms can lower without losing offsets", () => {
  const scene = defineProgrammableScene({
    id: "nested-lower", width: 100, height: 100, fps: 30, durationInFrames: 30,
    children: [{ id: "group", kind: "group", transform: { x: 10, y: 20 }, children: [
      { id: "title", kind: "text", text: "x", transform: { x: 3, y: 4, rotation: 5 } }
    ] }]
  });
  const clip = lowerProgrammableSceneToVideoProject(scene).tracks[0]?.clips[0];
  assert.equal(clip?.kind, "text");
  assert.deepEqual(clip?.kind === "text" ? clip.transform : undefined, { x: 13, y: 24, rotation: 5 });
});


test("browser entry evaluates the same normalized scene graph as the core entry", () => {
  const options = {
    id: "browser-parity",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 60,
    assets: [{ id: "image", kind: "image" as const, source: { kind: "static" as const, src: "assets/image.png" } }],
    children: [{ id: "image", kind: "image" as const, assetId: "image", transform: { x: 10, y: 20, width: 100, height: 50 } }]
  };
  const coreScene = defineProgrammableScene(options);
  const browserScene = defineBrowserProgrammableScene(options);
  assert.equal(serializeProgrammableScene(coreScene), serializeBrowserProgrammableScene(browserScene));
  assert.deepEqual(
    createProgrammableSceneRenderGraph(coreScene).items.map((item) => [item.node.id, item.absoluteStartFrame, item.zIndex]),
    createBrowserProgrammableSceneRenderGraph(browserScene).items.map((item) => [item.node.id, item.absoluteStartFrame, item.zIndex])
  );
});

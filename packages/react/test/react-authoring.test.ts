import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  defineComposition,
  resolveProgrammableComposition,
  type JsonObject,
  type ProgrammableScene
} from "@vexa-video/core/browser";
import {
  InvalidVexaReactSeriesError,
  VexaArc,
  VexaAudio,
  VexaCircle,
  VexaCompositionRegistration,
  VexaCompositionRoot,
  VexaEllipse,
  VexaFill,
  VexaFreeze,
  VexaImage,
  VexaLayer,
  VexaLine,
  VexaLoop,
  VexaPath,
  VexaPolygon,
  VexaReactCompositionConflictError,
  VexaReactCompositionRegistry,
  VexaReactContextError,
  VexaReactRegistryProvider,
  VexaRectangle,
  VexaRenderReadyController,
  VexaSequence,
  VexaSeries,
  VexaSeriesItem,
  VexaShape,
  VexaStar,
  VexaText,
  VexaVideo,
  useVexaAbsoluteFrame,
  useVexaCompositionConfig,
  useVexaFrame,
  useVexaInputProps,
  useVexaRenderDelay,
  useVexaRenderReady,
  vexaStaticAsset,
  vexaStorageAsset
} from "../src/index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DemoProps extends JsonObject {
  readonly title: string;
}

const demoDefinition = defineComposition<DemoProps>({
  id: "react-demo",
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 120,
  defaultProps: { title: "Vexa" }
});

function DemoComponent(): null {
  return null;
}

async function resolveDemo(): Promise<Awaited<ReturnType<typeof resolveProgrammableComposition<DemoProps>>>> {
  return await resolveProgrammableComposition(demoDefinition);
}

async function renderAndCapture(
  frame: number,
  child: ReturnType<typeof createElement>,
  options: {
    readonly readinessController?: VexaRenderReadyController;
    readonly assets?: Parameters<typeof VexaCompositionRoot>[0]["assets"];
  } = {}
): Promise<{ renderer: ReactTestRenderer; scene: ProgrammableScene }> {
  const resolved = await resolveDemo();
  let scene: ProgrammableScene | undefined;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(
        VexaCompositionRoot,
        {
          resolved,
          frame,
          ...(options.readinessController
            ? { readinessController: options.readinessController }
            : {}),
          ...(options.assets ? { assets: options.assets } : {}),
          onScene(value: ProgrammableScene) {
            scene = value;
          }
        },
        child
      )
    );
  });
  assert.ok(scene, "expected VexaCompositionRoot to emit a scene");
  return { renderer, scene: scene! };
}

test("React composition registry is deterministic, rejects conflicts, and registration cleans up on unmount", async () => {
  const registry = new VexaReactCompositionRegistry();
  const second = defineComposition({
    id: "a-second",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30
  });
  registry.register({ definition: demoDefinition, component: DemoComponent });
  registry.register({ definition: second, component: DemoComponent });
  assert.deepEqual(registry.list().map((entry) => entry.definition.id), ["a-second", "react-demo"]);
  assert.throws(
    () => registry.register({ definition: demoDefinition, component: DemoComponent }),
    VexaReactCompositionConflictError
  );
  registry.clear();

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(
        VexaReactRegistryProvider,
        { registry },
        createElement(VexaCompositionRegistration, {
          definition: demoDefinition,
          component: DemoComponent
        })
      )
    );
  });
  assert.equal(registry.size, 1);
  assert.equal(registry.require("react-demo").component, DemoComponent);
  await act(async () => renderer.unmount());
  assert.equal(registry.size, 0);
});

test("registry resolves core default/input props without redefining composition semantics", async () => {
  const registry = new VexaReactCompositionRegistry();
  registry.register({ definition: demoDefinition, component: DemoComponent });
  const result = await registry.resolve<DemoProps>("react-demo", { title: "Input" });
  assert.equal(result.resolved.props.title, "Input");
  assert.equal(result.resolved.metadata.width, 320);
});

test("frame, absolute-frame, composition-config, and input-props hooks read the current runtime", async () => {
  let observed:
    | { frame: number; absolute: number; id: string; title: string }
    | undefined;

  function Probe(): null {
    const config = useVexaCompositionConfig();
    const props = useVexaInputProps<DemoProps>();
    observed = {
      frame: useVexaFrame(),
      absolute: useVexaAbsoluteFrame(),
      id: config.id,
      title: props.title
    };
    return null;
  }

  const { renderer } = await renderAndCapture(45, createElement(Probe));
  assert.deepEqual(observed, { frame: 45, absolute: 45, id: "react-demo", title: "Vexa" });
  await act(async () => renderer.unmount());
});

test("nested sequence offsets preserve root frame while changing local frame", async () => {
  let observed: readonly number[] | undefined;
  function Probe(): null {
    observed = [useVexaFrame(), useVexaAbsoluteFrame()];
    return null;
  }

  const child = createElement(
    VexaSequence,
    { id: "outer", from: 10, durationInFrames: 100 },
    createElement(
      VexaSequence,
      { id: "inner", from: 5, durationInFrames: 80 },
      createElement(Probe)
    )
  );
  const { renderer, scene } = await renderAndCapture(30, child);
  assert.deepEqual(observed, [15, 30]);
  const outer = scene.children[0];
  assert.equal(outer?.kind, "group");
  assert.equal(outer?.startFrame, 10);
  if (outer?.kind === "group") assert.equal(outer.children[0]?.startFrame, 5);
  await act(async () => renderer.unmount());
});

test("loop and freeze scopes use the shared deterministic frame semantics", async () => {
  const values: number[] = [];
  function Probe(): null {
    values.push(useVexaFrame());
    return null;
  }

  const child = createElement(
    VexaLoop,
    { durationInFrames: 12 },
    createElement(Probe),
    createElement(VexaFreeze, { frame: 3 }, createElement(Probe))
  );
  const { renderer } = await renderAndCapture(29, child);
  assert.deepEqual(values, [5, 3]);
  await act(async () => renderer.unmount());
});

test("series resolves offsets, overlaps, and local frames deterministically", async () => {
  const frames: number[] = [];
  function Probe(): null {
    frames.push(useVexaFrame());
    return null;
  }

  const child = createElement(
    VexaSeries,
    null,
    createElement(VexaSeriesItem, { id: "one", durationInFrames: 20 }, createElement(Probe)),
    createElement(
      VexaSeriesItem,
      { id: "two", durationInFrames: 20, offsetFrames: -5 },
      createElement(Probe)
    )
  );
  const { renderer, scene } = await renderAndCapture(18, child);
  assert.deepEqual(frames, [18, 3]);
  assert.equal(scene.children[0]?.startFrame, 0);
  assert.equal(scene.children[1]?.startFrame, 15);
  await act(async () => renderer.unmount());
});

test("series rejects children that are not VexaSeriesItem", async () => {
  const resolved = await resolveDemo();
  await assert.rejects(
    async () => {
      await act(async () => {
        create(
          createElement(
            VexaCompositionRoot,
            { resolved },
            createElement(VexaSeries, null, createElement("span"))
          )
        );
      });
    },
    InvalidVexaReactSeriesError
  );
});

test("media components map React props into the browser-safe programmable scene graph", async () => {
  const assets = [
    vexaStaticAsset("photo", "image", "/photo.png"),
    vexaStaticAsset("clip", "video", "/clip.mp4"),
    vexaStaticAsset("music", "audio", "/music.m4a")
  ] as const;
  const child = createElement(
    VexaLayer,
    { id: "layer", startFrame: 5, zIndex: 2, transform: { x: 10, y: 20 } },
    createElement(VexaFill, { id: "bg", color: "black" }),
    createElement(VexaText, {
      id: "title",
      text: "Vexa",
      style: { fontSize: 32, color: "white" }
    }),
    createElement(VexaImage, { id: "photo-node", assetId: "photo", fit: "contain" }),
    createElement(VexaVideo, {
      id: "video-node",
      assetId: "clip",
      fit: "cover",
      sourceStartSeconds: 1,
      playbackRate: 1,
      volume: 0.5
    }),
    createElement(VexaAudio, {
      id: "audio-node",
      assetId: "music",
      sourceStartSeconds: 0.25,
      volume: 0.4,
      muted: false
    })
  );
  const { renderer, scene } = await renderAndCapture(10, child, { assets });
  const layer = scene.children[0];
  assert.equal(layer?.kind, "layer");
  if (layer?.kind === "layer") {
    assert.deepEqual(layer.children.map((node) => node.kind), ["fill", "text", "image", "video", "audio"]);
    const video = layer.children.find((node) => node.kind === "video");
    assert.equal(video?.kind === "video" ? video.volume : undefined, 0.5);
  }
  await act(async () => renderer.unmount());
});

test("shape components map through the shared programmable shape contract", async () => {
  const child = createElement(
    VexaLayer,
    { id: "shapes" },
    createElement(VexaShape, {
      id: "generic",
      shape: { geometry: { kind: "ellipse", cx: 10, cy: 10, radiusX: 8, radiusY: 4 }, style: { fill: "white" } }
    }),
    createElement(VexaRectangle, {
      id: "rectangle", x: 5, y: 6, width: 40, height: 20, radiusX: 4, style: { fill: "#ff3366" }
    }),
    createElement(VexaEllipse, {
      id: "ellipse", cx: 60, cy: 30, radiusX: 12, radiusY: 8, style: { fill: "#3366ff" }
    }),
    createElement(VexaCircle, {
      id: "circle", cx: 90, cy: 30, radius: 10, style: { fill: "#33cc99" }
    }),
    createElement(VexaLine, {
      id: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, style: { stroke: { color: "white", width: 2 } }
    }),
    createElement(VexaPolygon, {
      id: "polygon", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], style: { fill: "yellow" }
    }),
    createElement(VexaStar, {
      id: "star", cx: 130, cy: 40, points: 5, innerRadius: 6, outerRadius: 14, style: { fill: "orange" }
    }),
    createElement(VexaPath, {
      id: "path", d: "M 0 0 L 20 0 L 10 20 Z", style: { fill: "purple" }
    }),
    createElement(VexaArc, {
      id: "arc", cx: 160, cy: 40, radiusX: 20, radiusY: 10, startDegrees: 0, endDegrees: 180,
      style: { stroke: { color: "cyan", width: 3 } }
    })
  );

  const { renderer, scene } = await renderAndCapture(10, child);
  const layer = scene.children[0];
  assert.equal(layer?.kind, "layer");
  if (layer?.kind !== "layer") throw new Error("expected shape layer");
  assert.equal(layer.children.every((node) => node.kind === "shape"), true);
  assert.deepEqual(layer.children.map((node) => node.kind === "shape" ? node.shape.geometry.kind : null), [
    "ellipse", "rectangle", "ellipse", "ellipse", "line", "polygon", "star", "path", "arc"
  ]);
  const circle = layer.children[3];
  if (circle?.kind !== "shape" || circle.shape.geometry.kind !== "ellipse") {
    throw new Error("expected circle to normalize to ellipse geometry");
  }
  assert.equal(circle.shape.geometry.radiusX, 10);
  assert.equal(circle.shape.geometry.radiusY, 10);
  const rectangle = layer.children[1];
  assert.equal(rectangle?.kind === "shape" ? rectangle.shape.style?.fillRule : undefined, "nonzero");
  await act(async () => renderer.unmount());
});

test("asset helpers preserve static and storage references for core policy validation", () => {
  const local = vexaStorageAsset("local", "video", { kind: "local", path: "C:/media/a.mp4" });
  const remote = vexaStorageAsset("remote", "image", { kind: "http", url: "https://example.com/a.png" });
  assert.deepEqual(vexaStaticAsset("logo", "image", "/logo.png", "metadata"), {
    id: "logo",
    kind: "image",
    source: { kind: "static", src: "/logo.png" },
    preload: "metadata"
  });
  assert.equal(local.source.kind, "storage");
  assert.equal(remote.source.kind, "storage");
});

test("render-ready delay lifecycle blocks, resumes, and cleans pending work on unmount", async () => {
  const readiness = new VexaRenderReadyController();
  let continueRender: (() => void) | undefined;
  let readyValue: boolean | undefined;

  function AsyncProbe(): null {
    continueRender = useVexaRenderDelay("font-load");
    readyValue = useVexaRenderReady();
    return null;
  }

  const first = await renderAndCapture(0, createElement(AsyncProbe), {
    readinessController: readiness
  });
  assert.equal(readiness.isReady, false);
  assert.equal(readiness.pendingCount, 1);
  assert.deepEqual(readiness.pendingLabels, ["font-load"]);
  assert.equal(readyValue, false);
  await act(async () => continueRender?.());
  assert.equal(readiness.isReady, true);
  await act(async () => first.renderer.unmount());

  const second = await renderAndCapture(0, createElement(AsyncProbe), {
    readinessController: readiness
  });
  assert.equal(readiness.pendingCount, 1);
  await act(async () => second.renderer.unmount());
  assert.equal(readiness.pendingCount, 0);
  assert.equal(readiness.isReady, true);
});

test("hooks fail clearly when used outside a Vexa composition runtime", async () => {
  function InvalidProbe(): null {
    useVexaFrame();
    return null;
  }
  await assert.rejects(
    async () => {
      await act(async () => {
        create(createElement(InvalidProbe));
      });
    },
    VexaReactContextError
  );
});

test("preview and render consumers observe identical timing and scene values for the same React composition", async () => {
  const vectors: Array<{ frame: number; absolute: number }> = [];
  function Animated(): ReturnType<typeof createElement> {
    const frame = useVexaFrame();
    const absolute = useVexaAbsoluteFrame();
    vectors.push({ frame, absolute });
    return createElement(VexaText, {
      id: "animated-title",
      text: `f${frame}`,
      transform: { x: frame, y: 10 }
    });
  }

  const preview = await renderAndCapture(42, createElement(Animated));
  const render = await renderAndCapture(42, createElement(Animated));
  assert.deepEqual(vectors, [
    { frame: 42, absolute: 42 },
    { frame: 42, absolute: 42 }
  ]);
  assert.deepEqual(preview.scene, render.scene);
  await act(async () => preview.renderer.unmount());
  await act(async () => render.renderer.unmount());
});

test("React package source has no Node/SDK/FFmpeg/Redis runtime imports", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  for (const forbidden of [
    /from\s+["']node:/u,
    /child_process/u,
    /@vexa-video\/sdk/u,
    /@vexa-video\/ffmpeg/u,
    /\bredis\b/iu,
    /from\s+["'](?:fs|path|os)["']/u
  ]) {
    assert.equal(forbidden.test(source), false, `forbidden browser dependency pattern: ${forbidden}`);
  }
  assert.match(source, /@vexa-video\/core\/browser/u);
});

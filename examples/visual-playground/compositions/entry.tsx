import { defineBundleCompositions } from "@vexa-video/bundler/entry";
import {
  defineComposition,
  defineExecutableComposition,
  defineExecutableCompositions,
  defineProgrammableScene,
  defineStill,
  type JsonObject,
  type ResolvedProgrammableCompositionMetadata
} from "@vexa-video/core/browser";
import badgeUrl from "./vexa-badge.svg";
import "./theme.css";

interface BackgroundProps extends JsonObject {
  readonly background: string;
}

interface ProductDemoProps extends BackgroundProps {
  readonly fps: number;
  readonly storageAssetKey: string;
}

interface ShapeShowcaseProps extends BackgroundProps {
  readonly unsupportedRotation: boolean;
}

const productDemo = defineComposition<ProductDemoProps>({
  id: "product-demo",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 300,
  defaultProps: { background: "#0b1220", fps: 30, storageAssetKey: "" },
  calculateMetadata({ props }) {
    return { fps: props.fps };
  }
});

const shapeShowcase = defineComposition<ShapeShowcaseProps>({
  id: "shape-showcase",
  width: 320,
  height: 180,
  fps: 12,
  durationInFrames: 24,
  defaultProps: { background: "#0f172a", unsupportedRotation: false }
});

const socialSquare = defineStill<BackgroundProps>({
  id: "social-square",
  width: 1080,
  height: 1080,
  defaultProps: { background: "#111827" }
});

const verticalShort = defineComposition<BackgroundProps>({
  id: "vertical-short",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450,
  defaultProps: { background: "#172033" }
});

function sceneFromResolvedMetadata(
  metadata: ResolvedProgrammableCompositionMetadata,
  background: string
) {
  return defineProgrammableScene({
    id: metadata.id,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.kind === "video" ? metadata.fps : 1,
    durationInFrames: metadata.kind === "video" ? metadata.durationInFrames : 1,
    background
  });
}


function shapeShowcaseScene(
  metadata: ResolvedProgrammableCompositionMetadata,
  props: ShapeShowcaseProps
) {
  const durationInFrames = metadata.kind === "video" ? metadata.durationInFrames : 1;
  return defineProgrammableScene({
    id: metadata.id,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.kind === "video" ? metadata.fps : 1,
    durationInFrames,
    background: props.background,
    children: [
      {
        id: "shape-rectangle",
        kind: "shape",
        transform: props.unsupportedRotation ? { rotation: 15 } : { x: 4, y: 2 },
        shape: {
          geometry: { kind: "rectangle", x: 16, y: 18, width: 58, height: 38, radiusX: 8 },
          style: {
            fill: "#ef4444",
            stroke: { color: "#f8fafc", width: 2 }
          }
        }
      },
      {
        id: "shape-ellipse",
        kind: "shape",
        zIndex: 1,
        shape: {
          geometry: { kind: "ellipse", cx: 114, cy: 38, radiusX: 24, radiusY: 15 },
          style: { fill: "#3b82f6" }
        }
      },
      {
        id: "shape-line",
        kind: "shape",
        zIndex: 2,
        shape: {
          geometry: { kind: "line", from: { x: 152, y: 20 }, to: { x: 222, y: 54 } },
          style: {
            stroke: {
              color: "#facc15",
              width: 4,
              lineCap: "round",
              dash: [8, 5]
            }
          }
        }
      },
      {
        id: "shape-polygon",
        kind: "shape",
        zIndex: 3,
        shape: {
          geometry: {
            kind: "polygon",
            points: [{ x: 18, y: 116 }, { x: 50, y: 72 }, { x: 82, y: 116 }]
          },
          style: { fill: "#22c55e" }
        }
      },
      {
        id: "shape-star",
        kind: "shape",
        zIndex: 4,
        startFrame: 4,
        durationInFrames: 16,
        opacity: 0.9,
        shape: {
          geometry: {
            kind: "star",
            cx: 122,
            cy: 104,
            points: 5,
            innerRadius: 12,
            outerRadius: 29
          },
          style: { fill: "#f59e0b" }
        }
      },
      {
        id: "shape-path",
        kind: "shape",
        zIndex: 5,
        shape: {
          geometry: { kind: "path", d: "M 158 82 C 184 60 210 132 238 98" },
          style: {
            fill: "none",
            stroke: { color: "#f472b6", width: 3, lineCap: "round" }
          }
        }
      },
      {
        id: "shape-arc",
        kind: "shape",
        zIndex: 6,
        shape: {
          geometry: {
            kind: "arc",
            cx: 278,
            cy: 101,
            radiusX: 25,
            radiusY: 20,
            startDegrees: 0,
            endDegrees: 270
          },
          style: {
            stroke: { color: "#22d3ee", width: 4, lineCap: "round" }
          }
        }
      }
    ]
  });
}

function productDemoScene(
  metadata: ResolvedProgrammableCompositionMetadata,
  props: ProductDemoProps
) {
  const storageAssetKey = props.storageAssetKey.trim();
  const durationInFrames = metadata.kind === "video" ? metadata.durationInFrames : 1;
  return defineProgrammableScene({
    id: metadata.id,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.kind === "video" ? metadata.fps : 1,
    durationInFrames,
    background: props.background,
    ...(storageAssetKey
      ? {
          assets: [{
            id: "product-art",
            kind: "image" as const,
            source: {
              kind: "storage" as const,
              source: { kind: "object" as const, provider: "custom" as const, key: storageAssetKey }
            }
          }],
          children: [{
            id: "product-art-image",
            kind: "image" as const,
            assetId: "product-art",
            durationInFrames
          }]
        }
      : {})
  });
}

export const vexaExecutableCompositions = defineExecutableCompositions([
  defineExecutableComposition({
    definition: productDemo,
    createScene({ metadata, props }) {
      return productDemoScene(metadata, props);
    }
  }),
  defineExecutableComposition({
    definition: shapeShowcase,
    createScene({ metadata, props }) {
      return shapeShowcaseScene(metadata, props);
    }
  }),
  defineExecutableComposition({
    definition: socialSquare,
    createScene({ metadata, props }) {
      return sceneFromResolvedMetadata(metadata, props.background);
    }
  }),
  defineExecutableComposition({
    definition: verticalShort,
    createScene({ metadata, props }) {
      return sceneFromResolvedMetadata(metadata, props.background);
    }
  })
]);

export const vexaCompositions = defineBundleCompositions([
  {
    id: "product-demo",
    kind: "video",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300
  },
  {
    id: "shape-showcase",
    kind: "video",
    width: 320,
    height: 180,
    fps: 12,
    durationInFrames: 24
  },
  {
    id: "social-square",
    kind: "still",
    width: 1080,
    height: 1080
  },
  {
    id: "vertical-short",
    kind: "video",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 450
  }
]);

export const playgroundBundleFixture = Object.freeze({
  label: process.env.VEXA_PLAYGROUND_LABEL ?? "Vexa",
  badgeUrl
});

export async function loadPlaygroundBundleMetadata() {
  return import("./metadata.js");
}

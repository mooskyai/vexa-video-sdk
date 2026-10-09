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

interface BackgroundProps extends JsonObject {
  readonly background: string;
}

interface ProductDemoProps extends BackgroundProps {
  readonly fps: number;
  readonly storageAssetKey: string;
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

const socialSquare = defineStill<BackgroundProps>({
  id: "social-square",
  width: 1080,
  height: 1080,
  defaultProps: { background: "#111827" }
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
              source: {
                kind: "object" as const,
                provider: "custom" as const,
                key: storageAssetKey
              }
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
    definition: socialSquare,
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
    id: "social-square",
    kind: "still",
    width: 1080,
    height: 1080
  }
]);

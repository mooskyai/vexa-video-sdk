import { defineBundleCompositions } from "@vexa-video/bundler/entry";
import {
  defineComposition,
  defineExecutableComposition,
  defineExecutableCompositions,
  defineProgrammableScene,
  type JsonObject
} from "@vexa-video/core/browser";

interface SurfaceFixtureProps extends JsonObject {
  readonly background: string;
  readonly rendererId: string;
  readonly unsupportedRotation: boolean;
}

const surfaceShowcase = defineComposition<SurfaceFixtureProps>({
  id: "surface-showcase",
  width: 160,
  height: 90,
  fps: 10,
  durationInFrames: 20,
  defaultProps: {
    background: "#08111f",
    rendererId: "fixture.surface",
    unsupportedRotation: false
  }
});

export const vexaExecutableCompositions = defineExecutableCompositions([
  defineExecutableComposition({
    definition: surfaceShowcase,
    createScene({ metadata, props }) {
      return defineProgrammableScene({
        id: metadata.id,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.kind === "video" ? metadata.fps : 1,
        durationInFrames: metadata.kind === "video" ? metadata.durationInFrames : 1,
        background: props.background,
        children: [{
          id: "surface-card",
          kind: "surface",
          startFrame: 4,
          durationInFrames: 8,
          ...(props.unsupportedRotation ? { transform: { rotation: 15 } } : {}),
          transitions: {
            in: { kind: "fade", durationInFrames: 2, easing: "ease-out" },
            out: { kind: "fade", durationInFrames: 2, easing: "ease-in" }
          },
          surface: {
            kind: "svg",
            rendererId: props.rendererId,
            data: { label: "Surface adapter", fill: "#22c55e" }
          }
        }]
      });
    }
  })
]);

export const vexaCompositions = defineBundleCompositions([{
  id: "surface-showcase",
  kind: "video",
  width: 160,
  height: 90,
  fps: 10,
  durationInFrames: 20
}]);

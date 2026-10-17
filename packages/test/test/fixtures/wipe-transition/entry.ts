import { defineBundleCompositions } from "@vexa-video/bundler/entry";
import {
  defineComposition,
  defineExecutableComposition,
  defineExecutableCompositions,
  defineProgrammableScene,
  type JsonObject
} from "@vexa-video/core/browser";

interface VisualWipeProps extends JsonObject {}

const visualWipe = defineComposition<VisualWipeProps>({
  id: "visual-wipe",
  width: 64,
  height: 36,
  fps: 10,
  durationInFrames: 12,
  defaultProps: {}
});

export const vexaExecutableCompositions = defineExecutableCompositions([
  defineExecutableComposition({
    definition: visualWipe,
    createScene({ metadata }) {
      const durationInFrames = metadata.kind === "video" ? metadata.durationInFrames : 1;
      return defineProgrammableScene({
        id: metadata.id,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.kind === "video" ? metadata.fps : 1,
        durationInFrames,
        background: "#0f172a",
        children: [
          {
            id: "wipe-fill",
            kind: "fill",
            color: "#38bdf8",
            startFrame: 2,
            durationInFrames: 9,
            transitions: {
              in: {
                kind: "wipe",
                durationInFrames: 4,
                easing: "linear",
                direction: "left"
              }
            }
          }
        ]
      });
    }
  })
]);

export const vexaCompositions = defineBundleCompositions([
  {
    id: "visual-wipe",
    kind: "video",
    width: 64,
    height: 36,
    fps: 10,
    durationInFrames: 12
  }
]);

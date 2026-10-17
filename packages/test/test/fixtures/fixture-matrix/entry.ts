import { defineBundleCompositions } from "@vexa-video/bundler/entry";
import {
  defineComposition,
  defineExecutableComposition,
  defineExecutableCompositions,
  defineProgrammableScene,
  type JsonObject,
  type ResolvedProgrammableCompositionMetadata
} from "@vexa-video/core/browser";

interface EmptyProps extends JsonObject {}

interface TemplateProps extends JsonObject {
  readonly background: string;
  readonly accent: string;
}

const WIDTH = 64;
const HEIGHT = 36;
const FPS = 10;
const DURATION = 12;

function videoDefinition<Props extends JsonObject>(id: string, defaultProps: Props) {
  return defineComposition<Props>({
    id,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    durationInFrames: DURATION,
    defaultProps
  });
}

const shapeText = videoDefinition<EmptyProps>("fixture-shape-text", {});
const image = videoDefinition<EmptyProps>("fixture-image", {});
const video = videoDefinition<EmptyProps>("fixture-video", {});
const audio = videoDefinition<EmptyProps>("fixture-audio", {});
const captions = videoDefinition<EmptyProps>("fixture-captions", {});
const templateProps = defineComposition<TemplateProps>({
  id: "fixture-template-props",
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  durationInFrames: DURATION,
  defaultProps: { background: "#0f172a", accent: "#38bdf8" },
  inputSchema: {
    type: "object",
    properties: {
      background: { type: "string", minLength: 7, maxLength: 7 },
      accent: { type: "string", minLength: 7, maxLength: 7 }
    },
    required: ["background", "accent"],
    additionalProperties: false
  },
  validateProps(props) {
    if (!/^#[0-9a-f]{6}$/iu.test(props.background) || !/^#[0-9a-f]{6}$/iu.test(props.accent)) {
      throw new Error("background and accent must be six-digit hex colors.");
    }
  }
});

function sceneBase(metadata: ResolvedProgrammableCompositionMetadata) {
  return {
    id: metadata.id,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.kind === "video" ? metadata.fps : 1,
    durationInFrames: metadata.kind === "video" ? metadata.durationInFrames : 1
  } as const;
}

export const vexaExecutableCompositions = defineExecutableCompositions([
  defineExecutableComposition({
    definition: shapeText,
    createScene({ metadata }) {
      return defineProgrammableScene({
        ...sceneBase(metadata),
        background: "#0f172a",
        children: [
          {
            id: "animated-shape",
            kind: "shape",
            startFrame: 2,
            durationInFrames: 6,
            shape: {
              geometry: { kind: "rectangle", x: 8, y: 8, width: 24, height: 16, radiusX: 2 },
              style: { fill: "#f97316" }
            }
          },
          {
            id: "animated-text",
            kind: "text",
            text: "Vexa",
            startFrame: 8,
            durationInFrames: 4,
            transform: { x: 10, y: 8 },
            style: { fontSize: 16, color: "#e2e8f0" }
          }
        ]
      });
    }
  }),
  defineExecutableComposition({
    definition: image,
    createScene({ metadata }) {
      return defineProgrammableScene({
        ...sceneBase(metadata),
        background: "#000000",
        assets: [{
          id: "image-source",
          kind: "image",
          source: { kind: "static", src: "fixture-image.png" }
        }],
        children: [{
          id: "image-node",
          kind: "image",
          assetId: "image-source",
          fit: "fill",
          durationInFrames: DURATION
        }]
      });
    }
  }),
  defineExecutableComposition({
    definition: video,
    createScene({ metadata }) {
      return defineProgrammableScene({
        ...sceneBase(metadata),
        background: "#000000",
        assets: [{
          id: "video-source",
          kind: "video",
          source: { kind: "static", src: "fixture-video.mp4" }
        }],
        children: [{
          id: "video-node",
          kind: "video",
          assetId: "video-source",
          fit: "fill",
          muted: true,
          durationInFrames: DURATION
        }]
      });
    }
  }),
  defineExecutableComposition({
    definition: audio,
    createScene({ metadata }) {
      return defineProgrammableScene({
        ...sceneBase(metadata),
        background: "#111827",
        assets: [{
          id: "audio-source",
          kind: "audio",
          source: { kind: "static", src: "fixture-audio.wav" }
        }],
        children: [{
          id: "audio-node",
          kind: "audio",
          assetId: "audio-source",
          durationInFrames: DURATION,
          volume: 0.5
        }]
      });
    }
  }),
  defineExecutableComposition({
    definition: captions,
    createScene({ metadata }) {
      return defineProgrammableScene({
        ...sceneBase(metadata),
        background: "#111827",
        captions: {
          schemaVersion: 1,
          format: "vtt",
          cues: [{
            id: "fixture-caption",
            start: 0.3,
            end: 0.9,
            text: "Vexa caption",
            style: {
              fontSize: 12,
              position: "bottom",
              marginBottom: 4
            }
          }]
        }
      });
    }
  }),
  defineExecutableComposition({
    definition: templateProps,
    createScene({ metadata, props }) {
      return defineProgrammableScene({
        ...sceneBase(metadata),
        background: props.background,
        children: [{
          id: "accent",
          kind: "solid",
          color: props.accent,
          width: 24,
          height: 16,
          transform: { x: 20, y: 10 }
        }]
      });
    }
  })
]);

export const vexaCompositions = defineBundleCompositions([
  { id: "fixture-shape-text", kind: "video", width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION },
  { id: "fixture-image", kind: "video", width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION },
  { id: "fixture-video", kind: "video", width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION },
  { id: "fixture-audio", kind: "video", width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION },
  { id: "fixture-captions", kind: "video", width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION },
  { id: "fixture-template-props", kind: "video", width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION }
]);

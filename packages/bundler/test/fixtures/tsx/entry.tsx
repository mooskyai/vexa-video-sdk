import { defineBundleCompositions } from "@vexa-video/bundler/entry";

export const vexaCompositions = defineBundleCompositions([
  { id: "tsx-card", kind: "video", width: 960, height: 540, fps: 24, durationInFrames: 48 }
]);

export function Card(): JSX.Element {
  return <div data-vexa-fixture="tsx">Vexa TSX</div>;
}

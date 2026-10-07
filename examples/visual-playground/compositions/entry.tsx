import { defineBundleCompositions } from "@vexa-video/bundler/entry";
import badgeUrl from "./vexa-badge.svg";
import "./theme.css";

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

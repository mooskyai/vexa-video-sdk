import "./styles.css";
import logoUrl from "./logo.svg";
import { defineBundleCompositions } from "@vexa-video/bundler/entry";

export const vexaCompositions = defineBundleCompositions([
  { id: "z-outro", kind: "still", width: 640, height: 360 },
  { id: "a-intro", kind: "video", width: 1280, height: 720, fps: 30, durationInFrames: 90 }
]);

export const logo = logoUrl;
export const publicApi = process.env.VEXA_PUBLIC_API_URL;
export const hiddenSecret = process.env.VEXA_PRIVATE_SECRET;
export async function loadLazyValue(): Promise<string> {
  return (await import("./lazy.js")).lazyValue;
}

import { defineBundleCompositions } from "@vexa-video/bundler/entry";
export const vexaCompositions = defineBundleCompositions([
  { id: "env", kind: "still", width: 320, height: 180 }
]);
export const allowed = process.env.VEXA_ALLOWED;
export const blocked = process.env.VEXA_BLOCKED;

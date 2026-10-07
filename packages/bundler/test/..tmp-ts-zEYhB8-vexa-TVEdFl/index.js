import {
  define_process_env_default
} from "./chunks/chunk-EVNNL6IG.js";

// logo.svg
var logo_default = "./assets/logo-LJ2IAHAH.svg";

// ../../../src/entry.ts
var InvalidVexaBundleCompositionError = class extends Error {
  code = "INVALID_BUNDLE_COMPOSITION";
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
};
function requireNonEmptyText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidVexaBundleCompositionError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}
function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new InvalidVexaBundleCompositionError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}
function requirePositiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InvalidVexaBundleCompositionError(`${label} must be a positive finite number.`);
  }
  return value;
}
function normalizeDescriptor(input, index) {
  if (!input || typeof input !== "object") {
    throw new InvalidVexaBundleCompositionError(`Composition at index ${index} must be an object.`);
  }
  const id = requireNonEmptyText(input.id, `Composition ${index} id`);
  const kind = input.kind;
  if (kind !== "video" && kind !== "still") {
    throw new InvalidVexaBundleCompositionError(
      `Composition "${id}" kind must be either "video" or "still".`
    );
  }
  const width = requirePositiveInteger(input.width, `Composition "${id}" width`);
  const height = requirePositiveInteger(input.height, `Composition "${id}" height`);
  if (kind === "still") {
    if (input.fps !== void 0 || input.durationInFrames !== void 0) {
      throw new InvalidVexaBundleCompositionError(
        `Still composition "${id}" must not declare fps or durationInFrames.`
      );
    }
    return Object.freeze({ id, kind, width, height });
  }
  const fps = requirePositiveFinite(input.fps, `Composition "${id}" fps`);
  const durationInFrames = requirePositiveInteger(
    input.durationInFrames,
    `Composition "${id}" durationInFrames`
  );
  return Object.freeze({ id, kind, width, height, fps, durationInFrames });
}
function defineBundleCompositions(descriptors) {
  if (!Array.isArray(descriptors)) {
    throw new InvalidVexaBundleCompositionError("Bundle compositions must be an array.");
  }
  const seen = /* @__PURE__ */ new Set();
  const normalized = descriptors.map((descriptor, index) => {
    const value = normalizeDescriptor(descriptor, index);
    if (seen.has(value.id)) {
      throw new InvalidVexaBundleCompositionError(
        `Bundle composition id "${value.id}" is duplicated.`
      );
    }
    seen.add(value.id);
    return value;
  });
  normalized.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return Object.freeze(normalized);
}

// entry.ts
var vexaCompositions = defineBundleCompositions([
  { id: "z-outro", kind: "still", width: 640, height: 360 },
  { id: "a-intro", kind: "video", width: 1280, height: 720, fps: 30, durationInFrames: 90 }
]);
var logo = logo_default;
var publicApi = define_process_env_default.VEXA_PUBLIC_API_URL;
var hiddenSecret = define_process_env_default.VEXA_PRIVATE_SECRET;
async function loadLazyValue() {
  return (await import("./chunks/lazy-T7T3EG44.js")).lazyValue;
}
export {
  hiddenSecret,
  loadLazyValue,
  logo,
  publicApi,
  vexaCompositions
};

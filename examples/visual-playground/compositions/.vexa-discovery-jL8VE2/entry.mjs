var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// <define:import.meta.env>
var init_define_import_meta_env = __esm({
  "<define:import.meta.env>"() {
  }
});

// <define:process.env>
var define_process_env_default;
var init_define_process_env = __esm({
  "<define:process.env>"() {
    define_process_env_default = { VEXA_PLAYGROUND_LABEL: "Vexa Playground" };
  }
});

// examples/visual-playground/compositions/metadata.ts
var metadata_exports = {};
__export(metadata_exports, {
  metadata: () => metadata
});
var metadata;
var init_metadata = __esm({
  "examples/visual-playground/compositions/metadata.ts"() {
    init_define_import_meta_env();
    init_define_process_env();
    metadata = Object.freeze({
      purpose: "visual-playground bundling acceptance",
      dynamicImport: true
    });
  }
});

// examples/visual-playground/compositions/entry.tsx
init_define_import_meta_env();
init_define_process_env();

// packages/bundler/dist/entry.js
init_define_import_meta_env();
init_define_process_env();
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
    throw new InvalidVexaBundleCompositionError(`Composition "${id}" kind must be either "video" or "still".`);
  }
  const width = requirePositiveInteger(input.width, `Composition "${id}" width`);
  const height = requirePositiveInteger(input.height, `Composition "${id}" height`);
  if (kind === "still") {
    if (input.fps !== void 0 || input.durationInFrames !== void 0) {
      throw new InvalidVexaBundleCompositionError(`Still composition "${id}" must not declare fps or durationInFrames.`);
    }
    return Object.freeze({ id, kind, width, height });
  }
  const fps = requirePositiveFinite(input.fps, `Composition "${id}" fps`);
  const durationInFrames = requirePositiveInteger(input.durationInFrames, `Composition "${id}" durationInFrames`);
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
      throw new InvalidVexaBundleCompositionError(`Bundle composition id "${value.id}" is duplicated.`);
    }
    seen.add(value.id);
    return value;
  });
  normalized.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return Object.freeze(normalized);
}

// examples/visual-playground/compositions/entry.tsx
import {
  defineComposition,
  defineExecutableComposition,
  defineExecutableCompositions,
  defineProgrammableScene,
  defineStill
} from "@vexa-video/core/browser";

// examples/visual-playground/compositions/vexa-badge.svg
init_define_import_meta_env();
init_define_process_env();
var vexa_badge_default = "C:/working/Projects/nodejs/vexa-video-sdk/examples/visual-playground/compositions/vexa-badge.svg";

// examples/visual-playground/compositions/theme.css
init_define_import_meta_env();
init_define_process_env();

// examples/visual-playground/compositions/entry.tsx
var productDemo = defineComposition({
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
var socialSquare = defineStill({
  id: "social-square",
  width: 1080,
  height: 1080,
  defaultProps: { background: "#111827" }
});
var verticalShort = defineComposition({
  id: "vertical-short",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450,
  defaultProps: { background: "#172033" }
});
function sceneFromResolvedMetadata(metadata2, background) {
  return defineProgrammableScene({
    id: metadata2.id,
    width: metadata2.width,
    height: metadata2.height,
    fps: metadata2.kind === "video" ? metadata2.fps : 1,
    durationInFrames: metadata2.kind === "video" ? metadata2.durationInFrames : 1,
    background
  });
}
function productDemoScene(metadata2, props) {
  const storageAssetKey = props.storageAssetKey.trim();
  const durationInFrames = metadata2.kind === "video" ? metadata2.durationInFrames : 1;
  return defineProgrammableScene({
    id: metadata2.id,
    width: metadata2.width,
    height: metadata2.height,
    fps: metadata2.kind === "video" ? metadata2.fps : 1,
    durationInFrames,
    background: props.background,
    ...storageAssetKey ? {
      assets: [{
        id: "product-art",
        kind: "image",
        source: {
          kind: "storage",
          source: { kind: "object", provider: "custom", key: storageAssetKey }
        }
      }],
      children: [{
        id: "product-art-image",
        kind: "image",
        assetId: "product-art",
        durationInFrames
      }]
    } : {}
  });
}
var vexaExecutableCompositions = defineExecutableCompositions([
  defineExecutableComposition({
    definition: productDemo,
    createScene({ metadata: metadata2, props }) {
      return productDemoScene(metadata2, props);
    }
  }),
  defineExecutableComposition({
    definition: socialSquare,
    createScene({ metadata: metadata2, props }) {
      return sceneFromResolvedMetadata(metadata2, props.background);
    }
  }),
  defineExecutableComposition({
    definition: verticalShort,
    createScene({ metadata: metadata2, props }) {
      return sceneFromResolvedMetadata(metadata2, props.background);
    }
  })
]);
var vexaCompositions = defineBundleCompositions([
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
var playgroundBundleFixture = Object.freeze({
  label: define_process_env_default.VEXA_PLAYGROUND_LABEL ?? "Vexa",
  badgeUrl: vexa_badge_default
});
async function loadPlaygroundBundleMetadata() {
  return Promise.resolve().then(() => (init_metadata(), metadata_exports));
}
export {
  loadPlaygroundBundleMetadata,
  playgroundBundleFixture,
  vexaCompositions,
  vexaExecutableCompositions
};

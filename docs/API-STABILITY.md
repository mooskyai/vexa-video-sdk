# API stability and versioning

Vexa follows Semantic Versioning for published packages and treats public TypeScript types as part of the supported API surface.

## Versioning policy

- **Patch** releases fix defects without intentionally changing valid public behavior.
- **Minor** releases add backward-compatible capabilities. Before `1.0.0`, a minor release may also contain a necessary public API correction, but it must be called out prominently in release notes.
- **Major** releases may remove or change public APIs after a documented migration path.

Vexa packages are released from one repository and currently use a synchronized public version. Internal package dependencies use the matching release version so a release can be reproduced from its tag. New Version 2 packages join the synchronized release only after their public boundary is ready to be supported under the same major-version policy.

## Stable surface

The following are public when exported from a published package entry point:

- classes, functions, constants, interfaces, and type aliases;
- package subpath exports such as `@vexa-video/core/browser`;
- serializable schema fields and documented string unions;
- documented execution-plan fields;
- documented error codes.

Source-file paths below `src/`, generated `dist/` internals that are not exported, test helpers, examples, and undocumented implementation details are not public API.

## Deprecation

A public API should be deprecated before removal whenever practical. Deprecations use JSDoc `@deprecated`, release notes, and a documented replacement. Removal normally waits for the next major release.

## Serializable schemas

Serialized contracts include an explicit `schemaVersion`. A reader must reject unsupported schema versions instead of guessing. Additive optional fields may be introduced compatibly; changes that reinterpret existing required fields require a schema revision.

## Browser/runtime boundaries

Browser-safe packages and entry points must remain free of Node execution imports. Moving a browser-safe API to a Node-only runtime, or vice versa, is considered a breaking change.

Version 2 composition, player, React-authoring, Studio-browser, and web-renderer surfaces must preserve this rule. Node-only bundling, rendering, process execution, and service code must live behind an explicit Node package or server boundary.

`@vexa-video/react` is a public authoring adapter over `@vexa-video/core/browser`. Its frame/config/props hooks, sequence/series/loop/freeze timing behavior, scene-component prop mapping, registration lifecycle, and render-readiness semantics are public behavior. React-specific authoring must not reinterpret the underlying core timing or scene contracts.

`@vexa-video/player` is a public browser-safe playback surface. Frame clamping, seek rounding, end/loop behavior, playback-rate progression, buffering, poster-frame presentation, volume/mute, responsive fit math, typed event ordering, and controller disposal semantics are public behavior. Browser DOM scheduling/fullscreen integration must remain an adapter over that deterministic controller rather than a second playback state machine.

`@vexa-video/bundler` is a public Node-side build-tool surface. Bundle-manifest schema/version fields, portable path normalization, composition discovery ordering, environment allowlisting, public-asset collision behavior, and documented bundler error codes are public behavior. The `@vexa-video/bundler/entry` subpath is browser-safe metadata authoring support and must not acquire Node execution imports.

`@vexa-video/renderer` is a public Node-side rendering surface. Render-plan schema fields, composition-selection behavior, executable bundle export validation, resolved frame-bound behavior, exclusive frame-range semantics, deterministic frame-range filenames, concurrency/timeout validation, `VexaRenderProgress`, hardware-selection/fallback behavior, storage injection/options, and typed renderer error codes are public behavior. Still/single-frame/frame-range/video execution delegates programmable-scene lowering, process cancellation/timeouts, FFmpeg progress parsing, hardware capability selection, and storage acquisition/workspace cleanup to existing Vexa contracts. Unresolved programmable-scene storage assets are materialized before lowering and cleaned after execution; caller-provided `resolvedAssets` remain an explicit override, while acquisition failures use `RENDER_ASSET_RESOLUTION_FAILED`. Exact video subranges are represented by final-graph video/audio trimming rather than a second intermediate render. Durable job integration must keep the same boundary instead of creating parallel execution semantics.

## Version 2 composition schemas

Serializable composition/project/render contracts introduced for Version 2 must carry an explicit schema version when persisted or sent across a process/network boundary. The programmable-scene schema is part of that contract: node kinds, asset-source shapes, timing/z-order semantics, and deterministic serialization/lowering behavior must not be reinterpreted without an appropriate schema or major-version change.

The frame/time semantics of a published composition API are public behavior. A change that reinterprets frame offsets, sequence boundaries, interpolation, default props, scene transforms/z-order, asset references, or serialized render inputs may require a major version even when the TypeScript shape is unchanged.

## Release verification

A public release must pass:

1. `npm run verify`
2. `npm run release:check`
3. `npm run release:pack`
4. clean installation/testing from packed tarballs when release infrastructure is available
5. the platform-specific checks relevant to the changed area

The release workflow performs package validation and a dry-run pack before publication. Actual publication is a separately authorized action.

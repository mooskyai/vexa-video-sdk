# API stability and versioning

Vexa follows Semantic Versioning for published packages and treats public TypeScript types as part of the supported API surface.

## Versioning policy

- **Patch** releases fix defects without intentionally changing valid public behavior.
- **Minor** releases add backward-compatible capabilities. Before `1.0.0`, a minor release may also contain a necessary public API correction, but it must be called out prominently in release notes.
- **Major** releases may remove or change public APIs after a documented migration path.

Vexa packages are released from one repository and use a synchronized version during the pre-1.0 period. Internal package dependencies use the matching release version so a release can be reproduced from its tag.

## Stable surface

The following are public when exported from a published package entry point:

- classes, functions, constants, interfaces, and type aliases;
- package subpath exports such as `@moosky-video/core/browser`;
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

## Release verification

A public release must pass:

1. `npm run verify`
2. `npm run release:check`
3. `npm run release:pack`
4. clean installation/testing from packed tarballs when release infrastructure is available
5. the platform-specific checks relevant to the changed area

The release workflow performs package validation and a dry-run pack before publication. Actual publication is a separately authorized action.

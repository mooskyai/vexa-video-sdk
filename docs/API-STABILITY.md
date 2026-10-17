# API Stability and Versioning

Vexa Video SDK follows Semantic Versioning for the synchronized public `@vexa-video/*` package set.

## Current stable line

The current stable release is **2.0.0**. All eighteen public packages are released in lockstep at the same version.

## Stability categories

### Stable public API

A documented export from a public package root or documented subpath is considered stable unless the documentation explicitly marks it experimental.

Patch releases may fix incorrect behavior, validation gaps, crashes, security issues or documentation without intentionally breaking valid documented usage.

Minor releases may add backward-compatible APIs and capabilities.

Major releases may make intentional breaking changes and require migration guidance.

### Internal API

Source paths, test fixtures, unexported modules, generated build files and repository-internal scripts are not public compatibility contracts unless separately documented.

Do not import from unpublished `src/` paths in consumer applications.

### Experimental/provider contracts

Provider/plugin adapters are public typed contracts, but third-party provider behavior is outside Vexa's compatibility control. Vexa preserves the adapter shape; applications own vendor credentials, SDK versions and vendor-specific operational behavior.

## Synchronized package versions

Public packages move together so a consumer can reason about one Vexa release baseline. Internal Vexa dependencies in published packages should reference the same synchronized release version.

Mixing Vexa majors is unsupported unless a package explicitly documents compatibility.

## Browser/runtime compatibility

A browser-safe package gaining a runtime dependency on Node execution code is considered an architectural breaking change even if TypeScript still compiles.

Likewise, changing a serializable public schema in a way that makes previously valid persisted data invalid requires explicit migration/versioning treatment.

## Composition/project schemas

Version 2 composition and project contracts are designed to be deterministic and serializable where practical. Applications that persist long-lived project data should record application/schema metadata and avoid persisting repository-internal objects.

Version 3 plans an explicit Project Format 2.0 migration/schema layer; do not assume that future format exists in 2.0.0.

## Deprecation

When practical, deprecations should:

1. remain usable for at least one compatible release window;
2. include a replacement in documentation/types;
3. identify the major release where removal may occur.

Security or correctness issues may require faster removal when continuing the behavior would be unsafe.

## Release qualification

A public release is not considered complete only because packages compile. The release process verifies tests/builds, release metadata, packed-package contents, isolated consumer installs, browser acceptance where relevant, FFmpeg capability baseline and protected npm publication.

See [Release operations](./release-operations.md).

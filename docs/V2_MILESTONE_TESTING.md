# Version 2 Release Qualification Record

**Status: Passed and released.**

This file keeps its historical name for stable repository links. Detailed pre-release test journals are archived under `docs/archive/v2.0.0/`; this document records the final release evidence that matters to users and maintainers.

## Qualified source

```text
Release version: 2.0.0
Tag:             v2.0.0
Source SHA:      af8d1d8e0c967e2651b8f77c1e02b6f11135a90a
```

## Tag-triggered release qualification

GitHub Actions run `39007176321` completed successfully for `v2.0.0`.

It passed:

- repository verification on Ubuntu/Node 24;
- repository verification on Windows/Node 24;
- repository verification on macOS/Node 24;
- Ubuntu/Node 26 compatibility;
- Chrome Studio acceptance on Ubuntu;
- Chrome Studio acceptance on Windows;
- Edge Studio acceptance on Windows;
- Chrome Studio acceptance on macOS;
- protected `verify-and-release` checks;
- FFmpeg capability baseline;
- packed-package consumer installation;
- GitHub release creation.

The npm publish step was intentionally skipped on the tag push.

## Protected npm publication

Manual workflow-dispatch run `39008019957` targeted the `v2.0.0` tag and the exact qualified SHA. It completed successfully with **Publish with npm provenance** executed through GitHub Actions OIDC trusted publishing.

## Registry verification

All eighteen public packages were verified at `2.0.0` with npm `latest` pointing to `2.0.0`.

The final clean consumer smoke test installed public-registry packages, imported `@vexa-video/sdk`, executed `npx vexa --help`, and ran `npm audit signatures` successfully.

The smoke environment reported verified registry signatures for all installed packages and verified provenance attestations for provenance-enabled Vexa packages in that dependency set.

## CLI publication note

Immediately after publication the CLI version briefly returned registry E404 while npm processing completed. The publish workflow log had already confirmed acceptance and provenance. After propagation:

```text
@vexa-video/cli@2.0.0 = visible
bin.vexa = dist/bin.js
latest = 2.0.0
provenance = present
```

No corrective patch release was required.

## Ongoing verification

The current engineering test policy is maintained in [`MILESTONE-TESTING.md`](./MILESTONE-TESTING.md). Future releases should preserve the same principle: validate packed consumer artifacts and real runtime boundaries, not only workspace builds.

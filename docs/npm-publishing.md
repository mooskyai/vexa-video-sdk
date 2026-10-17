# npm Publishing

Vexa public packages are published through GitHub Actions trusted publishing, not by maintainers running `npm publish` locally.

## Current release model

- workflow: `.github/workflows/release.yml`;
- protected GitHub environment: `npm-release`;
- package versions are synchronized;
- publication uses GitHub OIDC and npm provenance;
- the protected workflow rejects legacy npm token variables;
- packed package contents and isolated consumer installs are verified before publication.

## Trusted-publisher identity

Each public package must trust the canonical repository/workflow/environment combination:

```text
repository:  mooskyai/vexa-video-sdk
workflow:    release.yml
environment: npm-release
permission:  publish
```

## Release behavior

A pushed `v*` tag triggers release qualification and GitHub release creation. It does **not** publish npm packages by itself.

After the tag-triggered run succeeds, an authorized maintainer dispatches the same workflow on the version tag with `publish=true`. That protected run performs the real npm publication with provenance.

This two-step design separates immutable release qualification from the explicit publication decision.

## Do not

- add `NPM_TOKEN` or `NODE_AUTH_TOKEN` to the protected publish path;
- run normal production releases with local `npm publish`;
- publish from an unqualified branch SHA;
- mix public package versions;
- change dist-tags manually during the critical release path unless recovering from a documented release incident.

## Verification

After publication, verify each public package:

```bash
npm view @vexa-video/sdk@2.0.0 version
npm dist-tag ls @vexa-video/sdk
npm view @vexa-video/sdk@2.0.0 dist.attestations --json
```

Then perform a clean public-registry consumer install and run `npm audit signatures`.

For the operator sequence, see [Release operations](./release-operations.md).

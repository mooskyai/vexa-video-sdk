# Release Operations

This runbook describes the protected release process used for Vexa Video SDK 2.0.0 and expected for subsequent synchronized releases.

## Principles

- release from a clean, reviewed `main` commit;
- all public packages share one version;
- qualify the immutable version tag before npm publication;
- publish only through GitHub Actions OIDC trusted publishing;
- verify public-registry consumer behavior after publication.

## 1. Preflight

From the intended release commit:

```bash
git status -sb
git rev-parse HEAD
npm ci
npm run verify
npm run verify:studio
npm run release:check
npm run release:pack
npm run release:install-check
npm run release:ffmpeg-check
```

The working tree must be clean after verification.

## 2. Version synchronization

Use the repository release-version helper for a new release version:

```bash
npm run release:version -- <version>
```

Review all package/example/lockfile changes and rerun release checks.

## 3. Merge and tag

After the exact release candidate is merged to `main`, record the merge SHA and create an annotated version tag on that SHA.

Example pattern:

```bash
git tag -a vX.Y.Z <MERGE_SHA> -m "Vexa Video SDK X.Y.Z"
git rev-list -n 1 vX.Y.Z
git push origin vX.Y.Z
```

Verify the peeled tag equals the qualified merge SHA.

## 4. Tag-triggered qualification

The tag triggers `.github/workflows/release.yml`.

The run executes the shared release-acceptance matrix and protected `verify-and-release` job. On a tag push, npm publication is intentionally skipped while the GitHub release is created/updated.

Do not continue if any acceptance lane fails.

## 5. Protected npm publication

After the tag-triggered run is fully green, dispatch the release workflow on the **tag ref** with publication enabled:

```bash
gh workflow run release.yml \
  --repo mooskyai/vexa-video-sdk \
  --ref vX.Y.Z \
  -f publish=true
```

Verify the workflow-dispatch run targets the version tag and exact release SHA. `Publish with npm provenance` must execute successfully.

## 6. Registry audit

For every public package verify:

- `@package@X.Y.Z` exists;
- npm `latest` is the intended release;
- provenance/attestation metadata is present where expected;
- no package was silently skipped.

Registry propagation can be asynchronous immediately after npm accepts a publish. Check workflow logs before assuming an E404 means publication failed.

## 7. Clean consumer smoke test

Create a fresh directory outside the repository, install representative packages from the public registry, import the SDK, execute the CLI and run:

```bash
npm audit signatures
```

This catches registry/package/bin/export problems that workspace testing cannot.

## 8. Post-release

- confirm GitHub release notes;
- update `CHANGELOG.md`/roadmap status if needed;
- keep release evidence/run IDs in the release qualification record;
- only then delete merged release branches if desired.

## 2.0.0 evidence

The Version 2 release used:

```text
Source:                 af8d1d8e0c967e2651b8f77c1e02b6f11135a90a
Tag qualification run:  39007176321
Publish run:             39008019957
```

Both completed successfully and the public-registry smoke test passed.

# Release operations

This document defines the operator contract for the first public Vexa Video SDK Version 2 release. It does not authorize a version cut or publication by itself.

## Supported release baseline

| Surface | First public release contract |
| --- | --- |
| Node.js | 24.21.0 or newer; Node 24.21 is the primary release runtime and Node 26 remains a compatibility lane |
| npm | 11.15.0 or newer for trusted-publisher administration and release preflight |
| FFmpeg | 6.1 or newer with `drawtext`, `libx264`, and AAC encoding available |
| ffprobe | 6.1 or newer, preferably shipped with the same FFmpeg distribution/build |
| Windows | Windows 11 local acceptance plus GitHub `windows-latest` release verification |
| Linux | GitHub `ubuntu-24.04`; the release baseline is pinned to Ubuntu 24.04 and its FFmpeg 6.1 series |
| macOS | GitHub `macos-latest` with Homebrew `ffmpeg-full` so text/caption rendering has `drawtext` |
| Browsers | Chrome on Ubuntu/Windows/macOS and Microsoft Edge on Windows through the existing Studio/CDP acceptance harness |

Release-critical Linux jobs intentionally use `ubuntu-24.04` rather than `ubuntu-latest`, so a GitHub runner-label migration cannot silently change the OS or packaged FFmpeg baseline. The Node 26 compatibility lane runs on the same Ubuntu 24.04 image to isolate Node compatibility from operating-system changes. Release workflows use `actions/checkout@v7` and `actions/setup-node@v7`, keeping the action runtime on supported Node 24 while preserving tokenless npm OIDC publication.

`npm run release:ffmpeg-check` is the executable media baseline. It validates FFmpeg/ffprobe versions and the required software-rendering capabilities. Hardware encoders such as NVENC, Quick Sync, AMF, and VideoToolbox are optional and remain runtime-detected with CPU fallback.

Browser-only packages do not require FFmpeg in the browser. The FFmpeg baseline applies to Node execution/rendering and to the release acceptance host used by Studio rendering tests.

## npm trusted-publisher identity

The canonical npm OIDC identity is:

```text
Repository:  mooskyai/vexa-video-sdk
Workflow:    release.yml
Environment: npm-release
Permission:  npm publish
```

The workflow must remain at `.github/workflows/release.yml`, run on a GitHub-hosted runner, grant `id-token: write`, target the `npm-release` GitHub environment, and use `https://registry.npmjs.org` as the registry. `NPM_TOKEN` and `NODE_AUTH_TOKEN` are intentionally rejected for publication.

Run the local/static audit before any release work:

```bash
npm run release:trusted-publish-check
```

The protected workflow reruns the same audit in live OIDC mode. Actual publication repeats the repository/workflow/environment/OIDC checks and additionally requires a tag ref.

## Configure trust on npm

`npm trust` requires npm 11.15.0 or newer, package write access, account-level 2FA, and an npm package that already exists. The command is unaware of workspaces, so configure every public package individually.

For one existing package:

```bash
npm trust github @vexa-video/core \
  --file release.yml \
  --repo mooskyai/vexa-video-sdk \
  --env npm-release \
  --allow-publish \
  --yes
```

On Windows PowerShell, configure all package names that already exist in the npm registry:

```powershell
$packages = node --input-type=module -e "import { releasePackages } from './scripts/release-packages.mjs'; console.log(releasePackages.map((entry) => entry.name).join('\n'))"

foreach ($package in $packages) {
  npm view $package name --json *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "$package does not exist in npm yet; bootstrap it separately before configuring trust."
    continue
  }

  npm trust github $package `
    --file release.yml `
    --repo mooskyai/vexa-video-sdk `
    --env npm-release `
    --allow-publish `
    --yes
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Start-Sleep -Seconds 2
}
```

For a package name that does not exist yet, trusted publishing cannot create the initial registry package. Bootstrap that package separately using an npm maintainer account with 2FA, then configure the trusted publisher immediately afterward. Do not add a long-lived publish token to GitHub Actions as a bootstrap workaround.

Verify an existing package's configured relationship with:

```bash
npm trust list @vexa-video/core
```

## Version cut

Use the checked-in version helper so the root package, all eighteen public packages, and exact internal Vexa dependency references move together:

```bash
npm run release:version -- 2.0.0
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

The version helper deliberately does not hand-edit `package-lock.json`; npm must regenerate the workspace lock metadata with the repository-pinned npm version. Private example packages keep their own package version but update their `@vexa-video/*` dependencies to the release version.

## Final release sequence

Before a Version 2 tag or publication:

1. Confirm every public package exists in npm and has the canonical trusted-publisher relationship.
2. Confirm the `npm-release` GitHub environment has the intended deployment protection rules.
3. Complete the migration notes and release notes, run the synchronized version cut, and regenerate `package-lock.json`.
4. Run `npm run format:check`, `npm run verify`, `npm run release:check`, `npm run release:ffmpeg-check`, `npm run release:pack`, and `npm run release:install-check`.
5. Push the reviewed release-cut commit on `feature/v2-programmable-video`; require all eight PR acceptance lanes plus a `publish=false` `release.yml` run on that exact commit.
6. Merge the release-ready PR into `main` and verify the exact merged commit still contains version `2.0.0`.
7. Create `v2.0.0` from that exact `main` commit; do not tag the feature branch.
8. Confirm the tag-triggered reusable eight-lane release-acceptance workflow is green.
9. Dispatch `release.yml` on the `v2.0.0` tag with `publish=true` only after the protected environment approves the deployment.
10. Verify npm provenance and installed package versions from a clean consumer after publication.

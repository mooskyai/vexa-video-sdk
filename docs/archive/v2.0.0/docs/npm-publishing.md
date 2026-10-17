# Publishing the npm packages

The GitHub release and npm packages are separate. All eighteen public packages use the same version as the private root workspace, and the release scripts share one canonical package registry.

## First publication

Create the `vexa-video` organization on npm and use an npm account with publish access. Run `npm login`, `npm run verify`, `npm run release:check`, `npm run release:pack`, and `npm run release:install-check` from the repository root. The install check must pass from real packed tarballs before any package is published. Publish each package in this order, completing npm's browser or two-factor prompts:

```powershell
$packages = @(
    "core", "ffmpeg", "sdk", "angular", "ai", "editor", "react", "player", "bundler",
    "renderer", "gif", "waveform", "sound-effects", "web-renderer", "studio", "cli", "mcp", "test"
)
foreach ($package in $packages) {
    npm publish --workspace "@vexa-video/$package" --access public --provenance=false
    if ($LASTEXITCODE -ne 0) { throw "Publishing failed for $package" }
}
```

Check each result with `npm view "@vexa-video/<package>@<version>" version`. Do not retry a name and version that is already published. As of v1.0.0, `@vexa-video/core` is published; check the registry for the other packages before continuing.

## Trusted publishing for later versions

After each package exists on npm, add a GitHub Actions trusted publisher to **each of the eighteen packages** in npm package settings:

- GitHub organization: `mooskyai`
- Repository: `vexa-video-sdk`
- Workflow filename: `release.yml`
- Environment: `npm-release`
- Allowed action: direct `npm publish`

The fields must match the release workflow exactly. npm accepts this workflow's GitHub OIDC identity without a stored npm token. The workflow uses `id-token: write` and publishes with provenance.

For a new release, update the root and every public package to the same new version, update internal dependencies and the lockfile, run `npm run verify`, `npm run release:check`, `npm run release:pack`, and `npm run release:install-check`, then commit and push. Create and push a new `v<version>` tag. The tag workflow verifies the source, installs the packed artifacts into a clean consumer, and creates the GitHub release; it does **not** publish to npm. In GitHub Actions, run **Release packages** manually on that tag with `publish` enabled. The workflow rejects branch-based publish requests. Verify all eighteen new versions with `npm view` after the run.

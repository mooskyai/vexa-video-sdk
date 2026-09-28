# Publishing the npm packages

The GitHub release and npm packages are separate. All seven public packages use the same version as the private root workspace.

## First publication

Create the `vexa-video` organization on npm and use an npm account with publish access. Run `npm login`, `npm run verify`, `npm run release:check`, and `npm run release:pack` from the repository root. Publish each package in this order, completing npm's browser or two-factor prompts:

```powershell
$packages = "core", "ffmpeg", "sdk", "angular", "ai", "editor", "cli"
foreach ($package in $packages) {
    npm publish --workspace "@vexa-video/$package" --access public --provenance=false
    if ($LASTEXITCODE -ne 0) { throw "Publishing failed for $package" }
}
```

Check each result with `npm view "@vexa-video/<package>@<version>" version`. Do not retry a name and version that is already published. As of v1.0.0, `@vexa-video/core` is published; check the registry for the other packages before continuing.

## Trusted publishing for later versions

After each package exists on npm, add a GitHub Actions trusted publisher to **each of the seven packages** in npm package settings:

- GitHub organization: `mooskyai`
- Repository: `vexa-video-sdk`
- Workflow filename: `release.yml`
- Environment: `npm-release`
- Allowed action: direct `npm publish`

The fields must match the release workflow exactly. npm accepts this workflow's GitHub OIDC identity without a stored npm token. The workflow uses `id-token: write` and publishes with provenance.

For a new release, update the root and every public package to the same new version, update internal dependencies and the lockfile, run `npm run verify`, `npm run release:check`, and `npm run release:pack`, then commit and push. Create and push a new `v<version>` tag. The tag workflow verifies the source and creates the GitHub release; it does **not** publish to npm. In GitHub Actions, run **Release packages** manually on that tag with `publish` enabled. The workflow rejects branch-based publish requests. Verify all seven new versions with `npm view` after the run.

# Migrating to Vexa Video SDK 2.0

Version 2 adds Vexa's programmable-video layer on top of the existing deterministic media, timeline, storage, jobs, hardware, and FFmpeg foundations. It does not introduce a second media engine.

## Keep Vexa packages synchronized

All public `@vexa-video/*` packages are released together at `2.0.0`. Applications that use more than one Vexa package should upgrade those packages in the same dependency change and should not mix exact `1.0.0` and `2.0.0` Vexa package versions.

For example:

```bash
npm install @vexa-video/core@2.0.0 @vexa-video/sdk@2.0.0
```

Add only the programmable-video packages the application actually needs:

- `@vexa-video/react` for browser-safe React authoring;
- `@vexa-video/player` for deterministic browser playback;
- `@vexa-video/bundler` for TypeScript/TSX composition bundling and discovery;
- `@vexa-video/renderer` for Node composition/still/video rendering;
- `@vexa-video/studio` for the browser-safe Studio runtime;
- `@vexa-video/web-renderer` for capability-gated WebCodecs rendering;
- `@vexa-video/cli` for composition CLI workflows;
- `@vexa-video/mcp` for typed MCP composition/render operations;
- `@vexa-video/test` for Node-side visual regression and media timing assertions.

## Preserve the browser/Node boundary

Browser applications should consume browser-safe Vexa packages and call a Node render service or custom transport when server rendering is required. Do not move `@vexa-video/sdk`, FFmpeg execution, filesystem access, Redis clients, or other Node-only execution code into browser bundles.

The Angular integration remains a browser client boundary. Node rendering continues through the SDK/renderer/job surfaces.

## Media runtime baseline

Node render hosts for the 2.0 release line require:

- Node.js 24.21.0 or newer;
- FFmpeg and ffprobe 6.1 or newer;
- FFmpeg `drawtext`, `libx264`, and AAC encoding support for the supported software-rendering baseline.

Hardware encoders remain optional and runtime-detected.

## Upgrade checklist

1. Upgrade every Vexa package used by the application to `2.0.0` in one dependency change.
2. Reinstall dependencies and regenerate the application's lockfile.
3. Run the application's typecheck, tests, and production build.
4. Verify browser bundles still respect the browser/Node dependency boundary.
5. Verify the render host with the documented FFmpeg baseline.
6. If adopting programmable compositions, validate the same composition through the intended Player/Studio/local/hosted render path before production rollout.

Version 2 introduces new programmable-video packages and surfaces, so there is no repository-wide codemod. Resolve any compiler or export errors against the package's documented public exports rather than importing internal files.

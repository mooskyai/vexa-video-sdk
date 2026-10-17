# Migrating to Vexa Video SDK 2.0

Version 2 keeps the deterministic media APIs from the 1.x line and adds a programmable composition platform, new public packages and stricter release/runtime boundaries.

## Upgrade all Vexa packages together

Public packages are synchronized at `2.0.0`. Do not intentionally mix 1.x and 2.x Vexa packages in the same application.

Example:

```bash
npm install \
  @vexa-video/core@2.0.0 \
  @vexa-video/ffmpeg@2.0.0 \
  @vexa-video/sdk@2.0.0
```

Add optional packages only if your application uses them.

## Runtime baseline

Version 2 uses Node.js **24.21.0+** as its primary Node baseline. FFmpeg/ffprobe **6.1+** with the required codec/filter capabilities is the release baseline for Node media execution.

## Browser applications

Do not import `@vexa-video/sdk` into Angular/React/browser code. Version 2 reinforces the browser/server boundary with dedicated packages:

- `@vexa-video/angular`;
- `@vexa-video/react`;
- `@vexa-video/player`;
- `@vexa-video/editor`;
- `@vexa-video/studio`;
- `@vexa-video/web-renderer`.

Execute FFmpeg/server rendering behind an explicit HTTP/custom transport.

## Programmable video

New Version 2 applications can use:

- `@vexa-video/bundler` to bundle/discover TS/TSX compositions;
- `@vexa-video/renderer` for Node composition rendering;
- `@vexa-video/player` for browser playback;
- `@vexa-video/react` for React authoring;
- `@vexa-video/studio` for composition preview/editor coordination.

Existing `Video` and project/timeline workflows do not need to be rewritten into programmable compositions unless that model benefits your application.

## CLI

The published CLI is available as `@vexa-video/cli` and exposes media plus composition workflows:

```bash
npm install --global @vexa-video/cli@2.0.0
vexa --help
```

## Plugins and AI

The plugin and AI layers remain optional. Provider/vendor SDKs should stay in application-owned adapters rather than deterministic core packages.

## Validation checklist

After upgrading:

1. install all Vexa packages at `2.0.0`;
2. run your TypeScript build;
3. run media integration tests with your FFmpeg distribution;
4. verify browser bundles do not pull Node modules;
5. verify render-service transport contracts;
6. test cancellation/progress and output paths;
7. verify persisted project/composition inputs still validate.

For repository contributors, use the verification commands in [Engineering verification](./MILESTONE-TESTING.md).

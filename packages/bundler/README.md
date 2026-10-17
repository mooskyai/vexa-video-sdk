# @vexa-video/bundler

Bundles TypeScript/TSX programmable compositions and produces deterministic manifests/discovery metadata with controlled CSS/assets, source maps and environment exposure.

> Stable baseline: **2.0.0** · Node.js build-time package.

## Install

```bash
npm install @vexa-video/bundler@2.0.0
```

## When to use it

Use this package when composition source code must be converted into an executable Vexa bundle for Studio, CLI or Node rendering.

## Capabilities

- TypeScript/TSX composition bundling
- Deterministic composition discovery/manifests
- CSS and static asset handling
- Source-map modes
- Explicit public-environment allowlisting

## Minimal example

```ts
import { defineBundleCompositions } from "@vexa-video/bundler/entry";

export const vexaCompositions = defineBundleCompositions([
  { id: "intro", kind: "video", width: 1920, height: 1080, fps: 30, durationInFrames: 150 }
]);
```

## Runtime boundary

Bundling is Node/build-time work. Do not expose private environment variables into browser composition bundles.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

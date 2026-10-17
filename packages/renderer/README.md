# @vexa-video/renderer

Executes bundled programmable compositions for inspection, props resolution/validation and still/frame/range/video rendering through existing Vexa execution paths.

> Stable baseline: **2.0.0** · Node.js only.

## Install

```bash
npm install @vexa-video/renderer@2.0.0
```

## When to use it

Use this package in render services and workers that execute composition bundles.

## Capabilities

- Bundle-backed composition inspection
- Default/input-schema/dynamic-metadata resolution
- Still and selected-frame rendering
- Bounded frame-range and video rendering
- Progress, cancellation, timeouts and hardware selection
- Managed scene/storage assets and specialized surface adapters

## Runtime boundary

The renderer reuses Vexa project/FFmpeg/storage contracts; it must not create a parallel media engine.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [hosted-rendering.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/hosted-rendering.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

# @vexa-video/web-renderer

Capability-probes browser WebCodecs and provides deterministic browser/backend fallback planning, capture, encoding and supported A/V container output.

> Stable baseline: **2.0.0** · Browser-safe WebCodecs rendering package.

## Install

```bash
npm install @vexa-video/web-renderer@2.0.0
```

## When to use it

Use this package when compatible browsers should render compositions locally and the application can fall back to a backend when capabilities are missing.

## Capabilities

- WebCodecs capability detection and typed fallback planning
- Cancellable video plus AAC/Opus audio encoding
- H.264/AAC MP4 and VP9-or-AV1/Opus WebM muxing
- Canvas and serializable-DOM frame capture adapters
- Blob/File output with progress

## Runtime boundary

Capability detection must remain explicit. Unsupported browser/codec combinations should choose a typed backend fallback rather than silently changing semantics.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

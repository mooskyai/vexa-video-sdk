# @vexa-video/waveform

Rasterizes deterministic audio waveforms for programmable composition surfaces through FFmpeg-backed logical sources.

> Stable baseline: **2.0.0** · Node.js optional composition-media adapter.

## Install

```bash
npm install @vexa-video/waveform@2.0.0
```

## When to use it

Use this package when a composition needs a visual waveform while keeping waveform execution out of the browser-safe core.

## Capabilities

- Logical audio source IDs
- Deterministic FFmpeg waveform rasterization
- Composition-surface integration
- Managed private temporary-workspace cleanup

## Runtime boundary

Optional Node integration; browser/core packages do not take an FFmpeg dependency from it.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [package-guide.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

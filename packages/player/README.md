# @vexa-video/player

Deterministic browser playback state and a thin responsive DOM/fullscreen host for programmable compositions.

> Stable baseline: **2.0.0** · Browser-safe and framework-neutral.

## Install

```bash
npm install @vexa-video/player@2.0.0
```

## When to use it

Use this package when an application needs play/pause, seek, step, loop, playback-rate, buffering and responsive preview behavior without a Node dependency.

## Capabilities

- Playback controller and frame-accurate seek/step semantics
- Loop/rate/buffering state and typed events
- Responsive host and accessible default controls
- Fullscreen integration

## Runtime boundary

Preview/playback stays browser-side; final Node execution remains in renderer/SDK packages.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

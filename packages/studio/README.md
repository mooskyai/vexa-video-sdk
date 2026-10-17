# @vexa-video/studio

Coordinates composition selection, draft props, resolved metadata, Player preview, Editor timeline state and hot-reload frame preservation.

> Stable baseline: **2.0.0** · Browser-safe Studio session/runtime state.

## Install

```bash
npm install @vexa-video/studio@2.0.0
```

## When to use it

Use this package when building a local or embedded composition-development UI on top of Vexa Player and Editor contracts.

## Capabilities

- Composition/session selection
- Draft props and resolved metadata coordination
- Preview/playhead + timeline synchronization
- Safe current-frame preservation across source reloads

## Runtime boundary

Studio state is browser-side; source watching, bundling and final Node rendering belong to the development host/bundler/renderer.

## Documentation

- [visual-playground.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/visual-playground.md)
- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

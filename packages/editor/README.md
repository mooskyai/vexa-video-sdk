# @vexa-video/editor

Timeline-editor state, selection, playhead/viewport state, snapping, clip move/trim commands and undo/redo history around serializable Vexa projects.

> Stable baseline: **2.0.0** · Browser-safe and framework-neutral.

## Install

```bash
npm install @vexa-video/editor@2.0.0
```

## When to use it

Use this package as the state engine behind a custom browser editor UI.

## Capabilities

- Framework-neutral timeline state
- Selection, playhead and viewport/zoom state
- Time snapping and clip move/trim operations
- Undo/redo history over serializable project state

## Runtime boundary

This is an editor-state foundation, not a DOM editor and not a Node renderer. Professional ripple/slip/grouping semantics are planned for Version 3.

## Documentation

- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)
- [ROADMAP.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/ROADMAP.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

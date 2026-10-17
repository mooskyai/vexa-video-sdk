# @vexa-video/react

React primitives for authoring Vexa programmable compositions while keeping deterministic timing and scene contracts owned by `@vexa-video/core`.

> Stable baseline: **2.0.0** · Browser-safe React authoring adapter.

## Install

```bash
npm install @vexa-video/react@2.0.0
```

## When to use it

Use this package to express code-defined composition scenes in React and feed them into the normal Vexa bundling/rendering path.

## Capabilities

- React composition authoring primitives
- Timing scopes and deterministic frame semantics
- Scene/media components backed by shared Vexa contracts
- Browser-safe authoring without Node execution imports

## Runtime boundary

React is an authoring adapter, not a second rendering model. Representable scenes lower through the shared Vexa composition/project contracts.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

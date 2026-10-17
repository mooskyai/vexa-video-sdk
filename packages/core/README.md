# @vexa-video/core

Backend-neutral types, validation, serializable media/timeline/composition contracts, timing primitives, templates, errors, jobs/storage descriptors, and plugin metadata.

> Stable baseline: **2.0.0** · Browser-safe shared contracts; no FFmpeg or Node process execution.

## Install

```bash
npm install @vexa-video/core@2.0.0
```

## When to use it

Use this package when code must share Vexa contracts across browser and server runtimes without depending on execution backends.

## Capabilities

- Serializable media, project, job, storage, hosted-render and programmable-composition contracts
- Composition timing, input schemas, reusable templates, shapes, transitions and effects
- Typed validation/errors suitable for application and tooling boundaries
- Browser-safe shared types consumed by framework packages

## Runtime boundary

Do not add FFmpeg, filesystem, child-process, Redis, cloud SDK, or other Node-only runtime dependencies here.

## Documentation

- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)
- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [API-STABILITY.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/API-STABILITY.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

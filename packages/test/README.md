# @vexa-video/test

Deterministic visual/runtime regression helpers used to compare reviewed frame checkpoints, runtime timing observations and media duration/A/V sync.

> Stable baseline: **2.0.0** · Node.js testing utilities.

## Install

```bash
npm install @vexa-video/test@2.0.0
```

## When to use it

Use this package when a Vexa application or integration needs explicit, tolerance-aware regression checks around composition output.

## Capabilities

- Selected-frame checkpoint rendering/comparison
- 8-bit RGBA PNG normalization and tolerance-aware diffs
- Reviewed baseline helpers
- Runtime checkpoint parity assertions
- Frame-derived media duration and A/V sync assertions

## Runtime boundary

This package is Node-only and does not create a browser dependency path. Baselines should be reviewed artifacts, not an implicit snapshot model.

## Documentation

- [MILESTONE-TESTING.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/MILESTONE-TESTING.md)
- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

# @vexa-video/ffmpeg

The deterministic FFmpeg backend used by Vexa for probing, planning, filter compilation, process execution, captions, streaming, composition rendering and hardware verification.

> Stable baseline: **2.0.0** · Node.js only; executes FFmpeg/ffprobe processes.

## Install

```bash
npm install @vexa-video/ffmpeg@2.0.0
```

## When to use it

Use this package when implementing backend-level integrations. Most application code should prefer `@vexa-video/sdk` or `@vexa-video/renderer`.

## Capabilities

- FFprobe normalization and media probing
- Codec/container compatibility and deterministic argument planning
- Audio, caption, timeline and programmable-effect filter compilation
- HLS/DASH packaging and hardware encoder verification
- Progress, cancellation, timeout and typed process failures

## Runtime boundary

Keep shell execution explicit and argument-array based. Application-level storage/jobs/UI concerns belong in higher packages.

## Documentation

- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)
- [getting-started.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/getting-started.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

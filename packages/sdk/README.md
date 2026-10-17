# @vexa-video/sdk

The primary high-level Node.js API for media editing, audio, captions, timeline projects, streaming, storage, hardware, jobs/workers, plugins and hosted-render adapters.

> Stable baseline: **2.0.0** · Node.js only; may execute FFmpeg/ffprobe and access the filesystem/network.

## Install

```bash
npm install @vexa-video/sdk@2.0.0
```

## When to use it

Start here for a Node service, CLI-like application, worker, media API or server-side render workflow.

## Capabilities

- Immutable `Video` and `Audio` workflows with inspectable plans
- `VideoProject` timeline composition
- Streaming, storage and safe remote-media resolution
- Local/Redis-backed jobs, retries, idempotency, progress and cancellation
- Runtime-verified hardware acceleration with CPU fallback
- Plugin and hosted-render integration points

## Minimal example

```ts
import { Video } from "@vexa-video/sdk";

await Video.load("input.mp4")
  .trim({ start: 2, duration: 10 })
  .resize({ width: 1280, height: 720, fit: "contain" })
  .export("output.mp4", { videoCodec: "h264", audioCodec: "aac" });
```

## Runtime boundary

Do not import this package into browser bundles. Browser packages communicate with Node execution through HTTP or another application-owned transport.

## Documentation

- [getting-started.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/getting-started.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)
- [hosted-rendering.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/hosted-rendering.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

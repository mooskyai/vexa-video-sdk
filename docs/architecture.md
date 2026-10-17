# Architecture

This document describes the released Vexa Video SDK **2.0.0** architecture. Planned Version 3 work is documented separately and must not be treated as current behavior.

## Design goals

Vexa is designed around five constraints:

1. public APIs express media intent instead of raw shell commands;
2. plans are typed, inspectable and deterministic where practical;
3. browser runtimes never depend on Node/FFmpeg execution code;
4. optional providers/plugins remain explicit and replaceable;
5. new surfaces reuse the same renderer, jobs, storage and validation contracts.

## Runtime layers

```text
Browser / framework layer
Angular | React | Player | Editor | Studio | Web Renderer
                         |
                         | serializable contracts / explicit transport
                         v
Shared contracts
@vexa-video/core
                         |
            +------------+------------+
            |                         |
            v                         v
Composition toolchain            Media SDK
Bundler -> Renderer              @vexa-video/sdk
            |                         |
            +------------+------------+
                         |
                         v
Planning / execution
@vexa-video/ffmpeg
                         |
                         v
FFmpeg / ffprobe / filesystem / storage / workers
```

## Browser boundary

The following packages are designed to remain browser-safe at runtime:

- `@vexa-video/core` shared contracts;
- `@vexa-video/angular`;
- `@vexa-video/react`;
- `@vexa-video/player`;
- `@vexa-video/editor`;
- `@vexa-video/studio`;
- `@vexa-video/web-renderer`;
- `@vexa-video/sound-effects`.

They must not runtime-import `@vexa-video/sdk`, Node process modules, FFmpeg executors or Redis clients.

## Node media path

A normal `Video` workflow is:

```text
Video API
  -> immutable operation AST
  -> validation
  -> execution plan
  -> optimization/hardware decision
  -> FFmpeg argument graph
  -> process execution
  -> typed progress/result/error
```

Process launch uses explicit argument arrays. Compatible untouched streams can be copied instead of re-encoded.

## Timeline/project path

`VideoProjectAst` is the serializable multi-track representation for video/audio/image/text composition. Project rendering lowers track/clip/keyframe/transition intent into the same deterministic media/FFmpeg planning path rather than spawning a separate engine.

## Programmable composition path

```text
TS/TSX source
  -> @vexa-video/bundler
  -> bundle + manifest
  -> composition discovery/validation
  -> @vexa-video/renderer
  -> project/surface lowering
  -> existing execution path
```

Browser preview and Node rendering share timing/composition contracts but use runtime-appropriate implementations.

## Jobs and workers

Version 2 provides:

- local worker pools;
- serializable job descriptors;
- retries;
- idempotency keys;
- cancellation;
- progress reporting;
- Redis-backed distributed transport.

Version 2 does **not** yet claim full worker leases, heartbeat/stale-claim recovery, dead-letter reconciliation or capability-aware scheduling. Those are Version 3 work.

## Storage

The storage/workspace layer resolves local and remote media into managed execution paths and exposes adapter hooks for cloud providers. S3/GCS/Azure hooks in 2.0.0 are contracts, not first-party cloud SDK packages.

First-party cloud packages are planned for Version 3.

## Hardware

Version 2 detects and verifies eligible encoding providers:

- CPU;
- NVIDIA NVENC;
- Intel Quick Sync;
- AMD AMF;
- Apple VideoToolbox.

Automatic selection verifies a provider with a real encode before use and supports CPU fallback. A fully GPU-resident decode/filter/encode pipeline is future Version 3 work.

## Hosted rendering

Hosted composition requests reuse existing renderer/job/storage contracts. Typed requests preserve artifact identity and idempotency; single-file remote publication reuses the storage upload boundary.

The full multi-tenant hosted platform—quotas, priority queues, autoscaling, capability scheduling, reconciliation and tenant controls—is planned for Version 3.

## Plugins

The plugin host supports explicit lifecycle-managed registration for operations, storage adapters, jobs, render backends and encoder providers. Plugin metadata can be consumed by tooling, but plugin runtime code is loaded only by the host.

Plugins are not a sandbox and must not bypass normal planning/security rules.

## AI extension

`@vexa-video/ai` is separate from deterministic media packages. Provider adapters normalize transcription/tracking/highlight data into Vexa-owned types, then deterministic Vexa APIs produce edit/composition plans.

This prevents model-provider output from becoming the authoritative render format.

## Error and lifecycle model

Long-running execution paths should preserve:

- typed validation errors before work begins where possible;
- cancellation through `AbortSignal`/existing lifecycle contracts;
- structured progress;
- bounded timeouts where supported;
- deterministic cleanup of managed temporary resources.

## Architecture commitments

Unless intentionally changed through a documented API revision:

1. `@vexa-video/core` remains backend-neutral;
2. `@vexa-video/sdk` remains Node execution code;
3. browser packages remain free of Node execution imports;
4. FFmpeg processes use explicit arguments, not shell-concatenated strings;
5. plans remain inspectable before expensive execution;
6. new surfaces reuse existing validators/renderers/jobs/storage instead of parallel engines;
7. Windows, Linux and macOS differences are tested where paths/processes/fonts/hardware are involved.

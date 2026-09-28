# Vexa Video SDK

[![CI](https://github.com/mooskyai/vexa-video-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/mooskyai/vexa-video-sdk/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.21.0-339933.svg?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

A typed, modular media-processing SDK for Node.js and TypeScript.

Vexa provides high-level APIs for video editing, timeline composition, audio processing, captions, adaptive streaming, hardware-accelerated encoding, remote media, background jobs, and browser-safe Angular integration while keeping FFmpeg behind a backend-neutral API.

> **Project status:** active development. The seven public SDK packages are versioned together at 1.0.0; example workspaces remain private.

## Why Vexa?

FFmpeg is extremely capable, but production applications usually need more than command-line construction. They also need validation, codec/container compatibility, filter-graph planning, progress, cancellation, retries, storage, worker coordination, GPU selection, and browser/server boundaries.

Vexa keeps those concerns behind a typed SDK:

- **Backend-neutral APIs** — describe media intent instead of raw FFmpeg flags.
- **Immutable pipelines** — build edits first; execute only at terminal operations.
- **Deterministic plans** — inspect filters, codecs, hardware decisions, and generated arguments before rendering.
- **Single-pass optimization** — compatible operations are combined into one FFmpeg graph where practical.
- **Cross-platform behavior** — Windows, Linux, and macOS are treated as first-class Node.js targets.
- **Safe process execution** — argument arrays, typed errors, timeouts, cancellation, and structured progress.
- **Runtime-verified GPU acceleration** — NVENC, Quick Sync, AMF, and VideoToolbox are tested before automatic selection.
- **Browser/server separation** — Angular clients never import Node-only FFmpeg execution code.

## Capabilities

| Area | Current capabilities |
| --- | --- |
| Video | Probe, trim, resize, crop, rotate, thumbnail, audio extraction, export |
| Planning | Serializable ASTs, deterministic execution plans, validation, stream-copy optimization |
| Timeline | Video/audio/image/text tracks, transforms, keyframes, transitions, blend modes, track ordering |
| Audio | Loudness normalization, fades, channel mapping, ducking, silence detection, waveforms |
| Captions | SRT, WebVTT, ASS, styling, templates, word timings, burn-in |
| Streaming | HLS, MPEG-DASH, rendition ladders, segments, manifests, preview sprites |
| Hardware | CPU, NVIDIA NVENC, Intel Quick Sync, AMD AMF, Apple VideoToolbox |
| Storage | Local files, safe HTTPS, managed workspaces, S3/GCS/Azure adapter hooks |
| Jobs | Local workers, retries, idempotency, cancellation, Redis-backed distributed transport |
| Angular | Browser-safe providers, uploads, render jobs, Signals, RxJS polling, preview helpers |
| Plugins | Lifecycle-managed custom operations, storage adapters, job handlers, render backends, encoder providers |
| AI extension | Provider-neutral transcription/captions, FFmpeg scene detection, silence removal, smart reframe, highlight hooks |
| CLI | Probe, plan, render, hardware inspection, and adaptive streaming from the terminal |
| Browser editor foundation | Framework-neutral timeline state, snapping, clip edits, viewport state, undo/redo |
| Hosted rendering | Provider-neutral submit/get/cancel contract for cloud or hosted render services |

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js | **24.21.0+** |
| npm | 11+ recommended |
| FFmpeg | Available in `PATH`, or configured explicitly |
| ffprobe | Available in `PATH`, or configured explicitly |
| TypeScript | 5.9.x in the repository toolchain |

Verify your local tools:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## Quick start

```bash
git clone https://github.com/mooskyai/vexa-video-sdk.git
cd vexa-video-sdk
npm install
npm run verify
```

A basic video edit:

```ts
import { Video } from "@moosky-video/sdk";

await Video.load("input.mp4")
  .trim({ start: 5, duration: 20 })
  .resize({ width: 1280, height: 720, fit: "contain" })
  .rotate({ degrees: 90 })
  .export("output.mp4", {
    videoCodec: "h264",
    audioCodec: "aac",
    crf: 20,
    preset: "fast",
    onProgress(progress) {
      console.log(progress.percent);
    }
  });
```

Editing methods build an immutable pipeline. FFmpeg starts only when a terminal operation such as `export()` is called.

## Inspect an execution plan

```ts
const video = Video.load("input.mp4")
  .resize({ width: 1920, height: 1080, fit: "cover" });

const plan = await video.planExport("output.mp4", {
  videoCodec: "h264",
  audioCodec: "aac",
  hardwareAcceleration: "auto"
});

console.log(plan.video);
console.log(plan.audio);
console.log(plan.filters);
console.log(plan.hardware);
console.log(plan.optimizations);
```

For compatible untouched media, Vexa can choose stream copy instead of re-encoding.

## Timeline composition

`VideoProject` provides a serializable multi-track editing model:

```ts
import { createProject } from "@moosky-video/sdk";

const project = createProject({
  id: "demo",
  name: "Demo edit",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "black"
})
  .addTrack({ id: "video", type: "video", name: "Main video" })
  .addTrack({ id: "titles", type: "text", name: "Titles" })
  .addClip("video", {
    id: "scene-1",
    kind: "video",
    source: "scene.mp4",
    start: 0,
    duration: 5,
    transform: { fit: "cover" }
  })
  .addClip("titles", {
    id: "title-1",
    kind: "text",
    text: "Hello from Vexa",
    start: 0.5,
    duration: 2.5,
    transform: { x: 80, y: 80 },
    style: { fontSize: 64, color: "white" }
  });

await project.render("project-output.mp4");
```

Projects support video, audio, image, and text tracks; clip-relative keyframes; fades, crossfades and wipes; full-canvas blend modes; mixed audio; and deterministic planning before execution.

## Audio

```ts
import { Audio } from "@moosky-video/sdk";

await Audio.load("music.wav")
  .trim({ start: 2, duration: 30 })
  .normalize({ targetLufs: -16, truePeakDb: -1.5, loudnessRange: 11 })
  .fadeIn(0.5)
  .fadeOut(1)
  .channels("stereo")
  .export("music.m4a", { codec: "aac", bitrate: "192k" });
```

Audio workflows also include sidechain ducking, silence detection, and waveform generation.

## Captions

```ts
import { Captions, Video } from "@moosky-video/sdk";

const captions = Captions.applyTemplate(
  Captions.parse(`1
00:00:00,500 --> 00:00:02,500
Welcome to Vexa Video
`, "srt"),
  "subtitle",
  {
    fontSize: 42,
    color: "white",
    backgroundColor: "black@0.55",
    animation: "fade"
  }
);

await Video.load("input.mp4").burnCaptions(captions, "captioned.mp4");
```

Supported text formats are SRT, WebVTT, and ASS. Caption documents can preserve word-level timing metadata for transcription and karaoke-style workflows.

## Adaptive streaming

```ts
import { Streaming } from "@moosky-video/sdk";

await Streaming.load("input.mp4").package("./dist/hls", {
  protocol: "hls",
  preset: "balanced",
  segmentDuration: 4
});
```

Vexa can create HLS and MPEG-DASH packages, custom rendition ladders, aligned segments, and JPEG/WebVTT seek-preview sprites. Windows-specific path normalization keeps generated manifests portable.

## Hardware acceleration

```ts
import { Hardware, Video } from "@moosky-video/sdk";

const capabilities = await Hardware.detect();
console.log(capabilities.providers);

await Video.load("input.mp4")
  .resize({ width: 1920, height: 1080 })
  .export("output.mp4", {
    videoCodec: "h264",
    hardwareAcceleration: "auto",
    hardwareFallback: true,
    crf: 21,
    preset: "fast"
  });
```

An encoder is not considered usable merely because it appears in `ffmpeg -encoders`. Hardware providers are verified with a small real encode before they become eligible for automatic selection.

## Storage and remote media

```ts
import { Storage, Video } from "@moosky-video/sdk";

const storage = new Storage();

await storage.withResolved(
  "https://cdn.example.com/input.mp4",
  async (media) => {
    console.log(await Video.load(media.path).probe());
  }
);
```

Remote HTTP handling is conservative by default: HTTPS only, no embedded credentials, public-network destinations only, redirect revalidation, byte limits, and managed cleanup. S3, Google Cloud Storage, and Azure Blob are supported through application-owned adapter hooks rather than mandatory cloud SDK dependencies.

## Jobs and workers

```ts
import { JobQueue, Video } from "@moosky-video/sdk";

const jobs = new JobQueue({ concurrency: 2 });

jobs.register("video.render", async (payload, context) => {
  const output = `renders/${context.job.descriptor.id}.mp4`;

  await Video.load(payload.source).export(output, {
    signal: context.signal,
    onProgress(progress) {
      void context.reportProgress({
        ...(progress.percent != null ? { percent: progress.percent } : {}),
        phase: "render"
      });
    }
  });

  return { output };
});
```

The same serializable job model can run through the local worker pool or a Redis-backed distributed transport. Idempotency keys deduplicate submission; handlers should still make external side effects idempotent when retries are enabled.

## Angular integration

`@moosky-video/angular` is a separate browser-safe package. It never imports FFmpeg, `child_process`, `node:*`, or the Node-only `@moosky-video/sdk` runtime.

```ts
import { provideVexaVideo } from "@moosky-video/angular";

export const appConfig = {
  providers: [
    provideVexaVideo({
      baseUrl: "http://127.0.0.1:4180",
      pollIntervalMs: 500
    })
  ]
};
```

The Angular integration provides upload, preview, render-job, Signal, RxJS, cancellation, and customizable transport/provider APIs.

### Local Angular demo

The repository includes a browser client and Node render-service example. In the current development setup, the Angular demo toolchain should stay on an Angular 21.2.x release compatible with TypeScript 5.9.x; do not let Angular build tooling float to a version that requires TypeScript 6 without upgrading the whole repository together.

Run the render service:

```bash
npm run example:angular-service
```

Service status:

```text
http://127.0.0.1:4180/
http://127.0.0.1:4180/health
```

Start the complete Angular demo with:

```bash
npm run example:angular-demo
```

The browser UI runs on `http://127.0.0.1:4200` and talks to the render API on port `4180`.

See [docs/angular-integration.md](./docs/angular-integration.md) for configuration, API contracts, local-demo setup, and troubleshooting.

## Plugin system

`PluginRegistry` provides explicit, namespaced extension points without allowing installed packages to silently replace Vexa's normal planning or safety behavior.

```ts
import { definePlugin, PluginRegistry, Video } from "@moosky-video/sdk";

const watermarkTools = definePlugin({
  metadata: {
    schemaVersion: 1,
    id: "acme.video-tools",
    name: "Acme video tools",
    version: "1.0.0",
    capabilities: ["video-operation"]
  },
  setup(context) {
    context.registerVideoOperation({
      name: "square",
      transform() {
        return { type: "crop", options: { width: 1080, height: 1080 } };
      }
    });
  }
});

const plugins = new PluginRegistry();
await plugins.register(watermarkTools);
const edited = plugins.applyVideoOperation(
  Video.load("input.mp4"),
  "acme.video-tools:square",
  {}
);
await edited.export("square.mp4");
```

Plugins can contribute backend-neutral video operations, storage adapters, job handlers, explicit render backends, and encoder providers. Metadata/catalog types are safe for framework tooling, while plugin runtime code is loaded explicitly only by the Node host.

See [docs/plugins.md](./docs/plugins.md).

## Optional AI extension

`@moosky-video/ai` is a separate Node package. It does not add model SDKs or provider credentials to `@moosky-video/core`, `@moosky-video/ffmpeg`, or the normal Node SDK. Applications choose the transcription, tracking, and highlight providers they want.

Generate captions from any transcription adapter:

```ts
import { VexaAI } from "@moosky-video/ai";

const ai = new VexaAI({
  transcription: myTranscriptionAdapter
});

const { captions } = await ai.captions("interview.mp4", {
  language: "en",
  template: "subtitle",
  style: { color: "white", backgroundColor: "black@0.55" }
});
```

The normalized transcript preserves segment and optional word timings, so the resulting `CaptionDocument` can be burned with the existing caption renderer.

Scene detection works out of the box through a deterministic FFmpeg detector:

```ts
const scenes = await new VexaAI().detectScenes("input.mp4", {
  threshold: 0.3
});

console.log(scenes.scenes);
```

Silence removal reuses the existing audio detector and timeline renderer:

```ts
const ai = new VexaAI();
const plan = await ai.planSilenceRemoval("talk.mp4", {
  noiseDb: -40,
  minSilenceDuration: 0.6,
  paddingSeconds: 0.08
});

console.log(plan.outputDurationSeconds);
await ai.removeSilence("talk.mp4", "talk-tight.mp4");
```

Provider hooks are also available for subject tracking/smart reframing and highlight extraction. Those adapters return validated normalized results; Vexa converts them into serializable `VideoProjectAst` plans instead of exposing provider-specific model output to the render layer.

See [docs/ai-extension.md](./docs/ai-extension.md).

## CLI and service templates

The repository now includes a dependency-light CLI and deployable service templates around the same SDK contracts.

```bash
npm run cli -- probe input.mp4
npm run cli -- plan input.mp4 output.mp4 --width 1280 --height 720 --hardware auto
npm run cli -- render input.mp4 output.mp4 --video-codec h264 --audio-codec aac
npm run cli -- hardware --json
npm run cli -- stream input.mp4 ./hls --protocol hls --preset balanced
```

A generic REST render-service template is available with:

```bash
npm run example:rest-service
```

It listens on `http://127.0.0.1:4190` by default and exposes health, raw media upload, background render jobs, cancellation, and output serving. A matching Docker worker recipe lives under `deploy/docker-worker`.

Source-only React and Vue examples demonstrate the same upload → job → progress → playback contract without adding either framework to the SDK dependency graph.

## Browser timeline editor foundation

`@moosky-video/editor` provides framework-neutral timeline state helpers for browser editors. It owns selection, playhead, viewport/zoom state, time snapping, clip move/trim commands, and undo/redo history while keeping the project itself as a serializable `VideoProjectAst`.

```ts
import { TimelineHistory, createTimelineEditorState } from "@moosky-video/editor";

const history = new TimelineHistory(
  createTimelineEditorState(project, { snapSeconds: 0.1 })
);

history.dispatch({
  type: "move-clip",
  trackId: "video",
  clipId: "scene-1",
  start: 3.27
});

console.log(history.state.project);
history.undo();
```

The package has no DOM renderer and no Node execution dependency, so Angular/React/Vue applications can build their own timeline UI around the same state model.

## Hosted rendering

`HostedRenderer` wraps cloud or hosted render providers behind a small submit/get/cancel adapter contract:

```ts
import { HostedRenderer } from "@moosky-video/sdk";

const renderer = new HostedRenderer(myHostedAdapter);

const job = await renderer.submit({
  schemaVersion: 1,
  type: "video.render",
  payload: {
    source: "s3://media/input.mp4",
    output: "s3://media/output.mp4"
  },
  idempotencyKey: "customer-42-render-7"
});

const result = await renderer.wait(job.id);
```

The adapter owns vendor SDKs, authentication, queueing, and artifact storage. Vexa keeps the public contract portable.

See [docs/hosted-rendering.md](./docs/hosted-rendering.md) and [docs/ecosystem-distribution.md](./docs/ecosystem-distribution.md).

## Local visual playground

The repository also includes a framework-independent editor-style acceptance playground:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4173
```

It exercises uploads, video edits, timeline composition, audio, captions, streaming, hardware selection, remote media, background jobs, progress, cancellation, and generated outputs. The playground uses a compact desktop-editor layout with a focused clip inspector, dense timeline, predictable truncation/wrapping, and an overlay control drawer for project/audio/captions/streaming/GPU/job settings so the preview canvas keeps more working space.

See [docs/visual-playground.md](./docs/visual-playground.md).

## Packages

| Package | Responsibility |
| --- | --- |
| `@moosky-video/core` | Backend-neutral types, ASTs, validation, errors, and browser-safe shared contracts |
| `@moosky-video/ffmpeg` | FFmpeg/ffprobe planning, filter compilation, process execution, hardware detection, streaming packaging |
| `@moosky-video/sdk` | Node-only developer API for media, storage, hardware, and jobs/workers |
| `@moosky-video/angular` | Browser-safe Angular providers, uploads, render clients, Signals/RxJS state, and preview helpers |
| `@moosky-video/ai` | Optional Node-side AI/provider adapters plus deterministic media-planning helpers |
| `@moosky-video/editor` | Browser-safe, framework-neutral timeline-editor state/history foundations |
| `@moosky-video/cli` | Node.js command-line interface for probing, planning, rendering, hardware, and streaming |

## Architecture

```text
Angular application                       Node application / render service
        |                                           |
        v                                           v
@moosky-video/angular ---------------------> @moosky-video/sdk
        |                              serializable contracts
        |                                           |
        +------------------- @moosky-video/core ------+
                                                    |
                                                    v
                                      planning + optimization
                                                    |
                                      @moosky-video/ffmpeg
                                                    |
                                  FFmpeg / ffprobe / storage
```

The public model is intentionally not a one-to-one wrapper around FFmpeg flags. This makes it possible to optimize execution, keep browser packages safe, and add alternate backends later.

See [docs/architecture.md](./docs/architecture.md).

## Development

```bash
npm run verify           # typecheck + tests + builds
npm run typecheck        # TypeScript project references
npm test                 # automated test suite
npm run build            # build workspace packages/examples
npm run dev              # watch + tests + visual playground
npm run playground       # build + visual playground
```

CI uses the repository's supported Node.js line and installs FFmpeg before running verification.

## Documentation

- [Architecture](./docs/architecture.md)
- [Angular integration](./docs/angular-integration.md)
- [Visual playground](./docs/visual-playground.md)
- [Plugin system](./docs/plugins.md)
- [AI extension](./docs/ai-extension.md)
- [Ecosystem and distribution](./docs/ecosystem-distribution.md)
- [Hosted rendering](./docs/hosted-rendering.md)
- [API stability and versioning](./docs/API-STABILITY.md)
- [Changelog](./CHANGELOG.md)
- [Roadmap](./ROADMAP.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)

## Project direction

Vexa now includes the media core, browser integrations, extension layers, CLI/service tooling, container recipes, editor foundations, hosted-render contracts, and controlled release automation. Current work is focused on platform acceptance, deployment hardening, clean-install package verification, observability, and public release readiness.

See [ROADMAP.md](./ROADMAP.md) for current priorities.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before changing public APIs, execution behavior, or package boundaries.

## Security

Please review [SECURITY.md](./SECURITY.md) before reporting a security issue or deploying remote-media/render endpoints on an untrusted network.

## License

MIT

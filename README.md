# Vexa Video SDK

[![CI](https://github.com/mooskyai/vexa-video-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/mooskyai/vexa-video-sdk/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.21.0-339933.svg?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript&logoColor=white)
![npm](https://img.shields.io/badge/npm-v2.0.0-CB3837.svg?logo=npm)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

Vexa Video SDK is a typed media-processing and programmable-video platform for Node.js, TypeScript, browser applications, render services, and agent-driven workflows.

**Current stable release: `2.0.0`.** Version 2 is published to npm across eighteen synchronized `@vexa-video/*` packages. The release was qualified on Windows, Linux, macOS, Chrome, Edge, Node.js 24.21.0, and a Node.js 26 compatibility lane, then published through GitHub Actions OIDC with npm provenance.

## What Vexa gives you

Vexa keeps FFmpeg, browser rendering, job execution, storage, and programmable compositions behind typed contracts so applications can describe *what* should be rendered without scattering process arguments or provider-specific code throughout the product.

- deterministic video, audio, caption, timeline, and streaming plans;
- code-defined video compositions with browser preview and Node rendering;
- CLI and MCP surfaces that reuse the same validation and rendering contracts;
- background jobs, retries, cancellation, idempotency, and Redis transport;
- runtime-verified NVENC, Quick Sync, AMF, and VideoToolbox encoding with CPU fallback;
- browser-safe Angular, React, Player, Editor, Studio, and WebCodecs packages;
- provider-neutral storage, hosted-rendering, plugin, and AI extension points;
- cross-platform release validation and packed-package consumer verification.

## Choose the right entry point

| Goal | Start with |
| --- | --- |
| Edit/probe/render media from Node.js | `@vexa-video/sdk` |
| Define shared serializable media/composition contracts | `@vexa-video/core` |
| Author programmable compositions with React | `@vexa-video/react` |
| Bundle TypeScript/TSX compositions | `@vexa-video/bundler` |
| Render bundled compositions on Node.js | `@vexa-video/renderer` |
| Preview compositions in a browser | `@vexa-video/player` |
| Build a browser editor | `@vexa-video/editor` + `@vexa-video/studio` |
| Integrate an Angular application | `@vexa-video/angular` |
| Render in a compatible browser with WebCodecs | `@vexa-video/web-renderer` |
| Add provider-neutral AI editing helpers | `@vexa-video/ai` |
| Expose composition workflows to agents | `@vexa-video/mcp` |
| Use Vexa from a terminal | `@vexa-video/cli` |

See [Package guide](./docs/package-guide.md) for the complete package map.

## Requirements

- Node.js **24.21.0 or newer** for Node packages and repository development.
- FFmpeg and ffprobe **6.1 or newer** for Node rendering paths that use FFmpeg.
- npm **11+** for repository development.
- TypeScript **5.9.x** is the repository baseline.

Check your local environment:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## Install

For a Node media application:

```bash
npm install @vexa-video/sdk@2.0.0
```

For programmable compositions rendered on Node.js:

```bash
npm install \
  @vexa-video/core@2.0.0 \
  @vexa-video/bundler@2.0.0 \
  @vexa-video/renderer@2.0.0
```

Install only the packages your runtime needs. Browser packages are intentionally separated from Node/FFmpeg execution packages.

## Quick start: edit a video

```ts
import { Video } from "@vexa-video/sdk";

await Video.load("input.mp4")
  .trim({ start: 5, duration: 20 })
  .resize({ width: 1280, height: 720, fit: "contain" })
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

Vexa edit operations build an immutable plan. FFmpeg starts only when a terminal operation such as `export()` executes.

## Inspect before rendering

```ts
import { Video } from "@vexa-video/sdk";

const video = Video.load("input.mp4")
  .resize({ width: 1920, height: 1080, fit: "cover" });

const plan = await video.planExport("output.mp4", {
  videoCodec: "h264",
  audioCodec: "aac",
  hardwareAcceleration: "auto"
});

console.log(plan.filters);
console.log(plan.hardware);
console.log(plan.optimizations);
```

Execution planning is a first-class API so applications can validate or explain a render before expensive work begins.

## Quick start: timeline composition

```ts
import { createProject } from "@vexa-video/sdk";

const project = createProject({
  id: "product-demo",
  name: "Product demo",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "black"
})
  .addTrack({ id: "video", type: "video", name: "Main" })
  .addTrack({ id: "title", type: "text", name: "Titles" })
  .addClip("video", {
    id: "scene-1",
    kind: "video",
    source: "scene.mp4",
    start: 0,
    duration: 5,
    transform: { fit: "cover" }
  })
  .addClip("title", {
    id: "title-1",
    kind: "text",
    text: "Built with Vexa",
    start: 0.5,
    duration: 2.5,
    transform: { x: 80, y: 80 },
    style: { fontSize: 64, color: "white" }
  });

await project.render("product-demo.mp4");
```

## Quick start: programmable compositions

A bundle entry exports composition descriptors through the bundler entry API:

```ts
import { defineBundleCompositions } from "@vexa-video/bundler/entry";

export const vexaCompositions = defineBundleCompositions([
  {
    id: "product-demo",
    kind: "video",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 150
  }
]);
```

Use the CLI or bundler API to produce a deterministic composition bundle, then render that bundle with `@vexa-video/renderer`. See [Programmable compositions](./docs/compositions.md) for the complete workflow.

## CLI

```bash
npm install --global @vexa-video/cli@2.0.0
vexa --help
vexa probe input.mp4
vexa plan input.mp4 output.mp4 --width 1280 --height 720 --hardware auto
vexa hardware --json
```

Composition commands include `compositions`, `bundle`, `inspect`, `validate`, `render`, and `still`.

## Browser and framework boundary

Browser packages never runtime-import FFmpeg execution, `child_process`, `node:*`, Redis clients, or `@vexa-video/sdk`. A typical application keeps execution behind an HTTP/custom transport:

```text
Angular / React / browser UI
          |
          v
browser-safe Vexa package
          |
          v
HTTP or custom transport
          |
          v
Node render service
          |
          v
@vexa-video/sdk / @vexa-video/renderer
          |
          v
FFmpeg / storage / workers
```

This boundary is an architectural guarantee, not merely a build convention.

## Public packages

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `@vexa-video/core` | shared/browser-safe | contracts, ASTs, validation, errors, composition primitives |
| `@vexa-video/ffmpeg` | Node | FFmpeg/ffprobe planning and execution |
| `@vexa-video/sdk` | Node | high-level media, storage, hardware, jobs and workers |
| `@vexa-video/angular` | browser | Angular transport/providers and render-job state |
| `@vexa-video/ai` | Node | provider-neutral AI adapters and deterministic edit planning |
| `@vexa-video/editor` | browser | framework-neutral timeline/editor state |
| `@vexa-video/react` | browser | React composition authoring adapter |
| `@vexa-video/player` | browser | framework-neutral playback controller and host |
| `@vexa-video/bundler` | Node | TypeScript/TSX composition bundling and discovery |
| `@vexa-video/renderer` | Node | bundle-backed composition rendering |
| `@vexa-video/gif` | Node | GIF composition surface adapter |
| `@vexa-video/waveform` | Node | audio waveform surface adapter |
| `@vexa-video/sound-effects` | browser-safe | reusable logical sound-effect catalogs |
| `@vexa-video/web-renderer` | browser | WebCodecs capability/render planning |
| `@vexa-video/studio` | browser | Studio composition/preview/editor coordination |
| `@vexa-video/cli` | Node | terminal interface for media and compositions |
| `@vexa-video/mcp` | Node | MCP composition and hosted-render tools |
| `@vexa-video/test` | Node | deterministic visual/runtime regression helpers |

## Repository development

```bash
git clone https://github.com/mooskyai/vexa-video-sdk.git
cd vexa-video-sdk
npm install
npm run verify
```

Useful commands:

```bash
npm run typecheck
npm test
npm run build
npm run verify
npm run verify:studio
npm run playground
npm run release:check
npm run release:pack
npm run release:install-check
npm run release:ffmpeg-check
```

The release path additionally validates packed tarballs on Windows, Linux, and macOS and runs browser acceptance before protected publication.

## Documentation

Start with the [documentation index](./docs/README.md).

- [Getting started](./docs/getting-started.md)
- [Package guide](./docs/package-guide.md)
- [Programmable compositions](./docs/compositions.md)
- [Architecture](./docs/architecture.md)
- [Angular integration](./docs/angular-integration.md)
- [AI extension](./docs/ai-extension.md)
- [Plugin system](./docs/plugins.md)
- [Hosted rendering](./docs/hosted-rendering.md)
- [API stability](./docs/API-STABILITY.md)
- [Release operations](./docs/release-operations.md)
- [Roadmap](./ROADMAP.md)
- [Version 2 migration](./docs/V2_MIGRATION.md)

## Version direction

Version 2.0.0 is the stable programmable-video baseline. Version 3 is not a rewrite of Vexa; it builds production-platform capabilities on that baseline: worker resilience, capability-aware scheduling, render caching, advanced hardware pipelines, professional editor semantics, proxy workflows, richer graphics, AI editing, first-party cloud media adapters, Streaming 2.0, project-format evolution, collaboration, and hosted-render infrastructure.

The current V3 development line adds renewable distributed-worker leases and heartbeats, bounded expired-lease recovery, durable dead-letter inspection, and atomic cancellation/retry reconciliation for Redis workers. Wider artifact reconciliation and operator-controlled replay remain subsequent V3.1 work.

See [ROADMAP.md](./ROADMAP.md) for current status and sequencing. These features are **unreleased** and do not change the published 2.0.0 package. Stop older V3 workers before upgrading; external side effects remain at-least-once and should use stable idempotent artifact identities.

## Contributing and security

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before changing public APIs or package boundaries. Report security concerns according to [SECURITY.md](./SECURITY.md).

## License

MIT

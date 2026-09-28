# Ecosystem and distribution

This repository contains the distribution surfaces around the media SDK:

- `@vexa-video/cli` for command-line probing, planning, rendering, hardware inspection, and adaptive packaging;
- `examples/rest-service` as a dependency-light HTTP/job-service template;
- `deploy/docker-worker` as a containerized render-service/worker recipe with FFmpeg;
- `examples/react-client` and `examples/vue-client` as source-only browser integration examples;
- `@vexa-video/editor` as framework-neutral timeline state/history/snap foundations;
- `HostedRenderer` and `HostedRenderAdapter` for provider-neutral hosted rendering;
- `.github/workflows/release.yml` plus release validation scripts for controlled npm publication.

## CLI

After packages are published:

```bash
npx @vexa-video/cli probe input.mp4
npx @vexa-video/cli plan input.mp4 output.mp4 --width 1280 --height 720 --hardware auto
npx @vexa-video/cli render input.mp4 output.mp4 --video-codec h264 --audio-codec aac
npx @vexa-video/cli hardware --json
npx @vexa-video/cli stream input.mp4 ./hls --protocol hls --preset balanced
```

## REST service template

```bash
npm run example:rest-service
```

The template listens on `127.0.0.1:4190` by default and exposes health, raw media upload, background render jobs, cancellation, and output serving.

## Container worker

```bash
docker compose -f deploy/docker-worker/compose.yaml up --build
```

The container includes Node.js 24 and FFmpeg and runs the REST job worker with configurable concurrency.

## Framework examples

React and Vue examples are intentionally source-only so the monorepo does not force React/Vue dependencies onto SDK contributors. Copy them into an application created with the framework's preferred toolchain.

## Browser editor foundation

`@vexa-video/editor` is framework-neutral and owns serializable timeline selection, playhead, viewport, snapping, clip move/trim operations, and undo/redo history. It does not render DOM or import Node execution code.

## Public releases

`npm run release:check` validates package metadata and synchronized versions. `npm run release:pack` performs dry-run packing. Publication requires the guarded release workflow/operator confirmation; normal CI never publishes packages.

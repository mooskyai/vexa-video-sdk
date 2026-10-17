# Package Guide

Vexa is intentionally split into small packages so browser applications do not inherit Node/FFmpeg dependencies and Node services do not inherit framework UI dependencies.

All public packages in the Version 2 release are synchronized at `2.0.0`.

## Core media packages

| Package | Runtime | Use it when |
| --- | --- | --- |
| `@vexa-video/core` | shared/browser-safe | you need serializable contracts, validation, project/composition primitives or typed errors |
| `@vexa-video/ffmpeg` | Node | you need lower-level FFmpeg/ffprobe planning/execution |
| `@vexa-video/sdk` | Node | you want the high-level media, storage, hardware, jobs or timeline API |

Most Node applications should begin with `@vexa-video/sdk`.

## Programmable video

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `@vexa-video/react` | browser-safe | React composition authoring primitives |
| `@vexa-video/player` | browser-safe | composition playback state and DOM host |
| `@vexa-video/bundler` | Node | TS/TSX bundling, manifests and composition discovery |
| `@vexa-video/renderer` | Node | bundle-backed inspection, validation and rendering |
| `@vexa-video/studio` | browser-safe | Studio session state coordinating preview/editor/props |
| `@vexa-video/web-renderer` | browser | WebCodecs capability and render planning |

## Framework/editor packages

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `@vexa-video/angular` | browser-safe | Angular providers, transports, uploads and render-job state |
| `@vexa-video/editor` | browser-safe | framework-neutral timeline/editing state and history |

## Optional media adapters

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `@vexa-video/gif` | Node | deterministic GIF frame/surface integration |
| `@vexa-video/waveform` | Node | audio waveform surface rasterization |
| `@vexa-video/sound-effects` | browser-safe | reusable logical sound-effect catalogs |

## Automation and extensions

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `@vexa-video/ai` | Node | provider-neutral transcription/tracking/highlight adapters and deterministic edit planning |
| `@vexa-video/cli` | Node | terminal workflows for media and compositions |
| `@vexa-video/mcp` | Node | typed agent/MCP composition and hosted-render tools |
| `@vexa-video/test` | Node | visual/runtime regression helpers |

## Installation examples

Node media service:

```bash
npm install @vexa-video/sdk@2.0.0
```

Composition toolchain:

```bash
npm install \
  @vexa-video/core@2.0.0 \
  @vexa-video/bundler@2.0.0 \
  @vexa-video/renderer@2.0.0
```

Angular browser client:

```bash
npm install @vexa-video/angular@2.0.0
```

CLI:

```bash
npm install --global @vexa-video/cli@2.0.0
```

## Boundary rule

Do not solve a missing browser feature by importing a Node package into the browser bundle. Add or use a serializable contract and execute server-side instead.

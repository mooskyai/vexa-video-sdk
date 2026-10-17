# @vexa-video/ai

Provider-neutral AI-assisted editing contracts and deterministic conversion of provider results into ordinary Vexa caption/project plans.

> Stable baseline: **2.0.0** · Node.js extension package.

## Install

```bash
npm install @vexa-video/ai@2.0.0
```

## When to use it

Use this package when transcription, scene analysis, silence removal, smart reframe or highlight workflows should feed the same deterministic Vexa rendering pipeline.

## Capabilities

- Provider-neutral transcription with normalized segment/word timing
- Automatic `CaptionDocument` generation
- FFmpeg scene-boundary detection
- Silence-removal planning/rendering
- Subject-tracking smart-reframe hooks
- Highlight extraction hooks

## Minimal example

```ts
import { VexaAI } from "@vexa-video/ai";

const scenes = await new VexaAI().detectScenes("input.mp4", { threshold: 0.3 });
console.log(scenes.scenes);
```

## Runtime boundary

Provider/model SDKs remain application-owned. AI output does not become a parallel render engine; Vexa contracts remain authoritative.

## Documentation

- [ai-extension.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/ai-extension.md)
- [ROADMAP.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/ROADMAP.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

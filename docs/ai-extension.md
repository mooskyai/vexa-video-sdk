# AI Extension

`@vexa-video/ai` adds provider-neutral AI-assisted editing workflows without adding model/vendor SDKs to Vexa's deterministic media packages.

## Install

```bash
npm install @vexa-video/ai@2.0.0 @vexa-video/sdk@2.0.0
```

## Design rule

Provider output is normalized into Vexa-owned types, then deterministic Vexa APIs create captions, projects or render plans. Provider-specific JSON should not become your persisted render format.

## Transcription and automatic captions

```ts
import { VexaAI } from "@vexa-video/ai";

const ai = new VexaAI({
  transcription: myTranscriptionAdapter
});

const { captions } = await ai.captions("interview.mp4", {
  language: "en",
  template: "subtitle",
  style: {
    color: "white",
    backgroundColor: "black@0.55"
  }
});
```

The normalized transcript can preserve segment and optional word timing so the ordinary Vexa caption renderer can render the result.

## Scene detection

Scene detection has a deterministic FFmpeg-backed implementation:

```ts
const ai = new VexaAI();
const result = await ai.detectScenes("input.mp4", { threshold: 0.3 });
console.log(result.scenes);
```

## Silence removal

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

Silence removal reuses existing audio detection and timeline/rendering paths.

## Smart reframe and highlights

Applications can supply provider adapters for subject tracking and highlight extraction. Vexa validates normalized provider results and converts them into ordinary serializable Vexa project/composition plans.

## Credentials and privacy

Provider credentials belong to your Node application/provider adapter. Do not place AI secrets in browser bundles or composition JSON.

Applications are responsible for provider data-retention/privacy terms for uploaded media.

## Version 3 direction

Version 3 plans diarization, stronger word alignment, filler-word detection, OCR, object/face tracking, scene understanding, semantic search and moderation. These are planned capabilities, not part of the 2.0.0 guarantee.

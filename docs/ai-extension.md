# AI extension

`@moosky-video/ai` is an optional Node-side package for AI/provider-assisted media workflows. It deliberately stays outside `@moosky-video/core`, `@moosky-video/ffmpeg`, and the main SDK runtime so applications can choose their own transcription, vision, tracking, and highlight providers without making those dependencies mandatory for every Vexa user.

## Design rule

Provider output is normalized before it reaches media planning.

```text
AI / provider SDK
      |
      v
Vexa adapter contract
      |
      v
normalized transcript / scene / tracking / highlight model
      |
      v
CaptionDocument / VideoProjectAst / deterministic SDK helpers
      |
      v
existing Vexa render pipeline
```

Provider-specific credentials, clients, request formats, and model names remain application-owned.

## Configure adapters

```ts
import { VexaAI } from "@moosky-video/ai";

const ai = new VexaAI({
  transcription: myTranscriptionAdapter,
  tracking: mySubjectTrackingAdapter,
  highlights: myHighlightAdapter
});
```

Every adapter exposes a stable `id` plus one typed method. Cancellation and timeouts use the same `AbortSignal`/timeout conventions as the rest of the SDK.

## Transcription

A transcription adapter returns normalized segments and optional word timing:

```ts
const adapter = {
  id: "acme.speech",

  async transcribe(request) {
    const response = await mySpeechClient.transcribe(request.source);

    return {
      text: response.text,
      language: response.language,
      segments: response.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
        words: segment.words
      }))
    };
  }
};
```

`VexaAI.transcribe(...)` validates finite timing, confidence values, and word timings before returning the result.

## Automatic captions

`VexaAI.captions(...)` converts normalized transcript segments directly into the existing caption model:

```ts
const { transcription, captions } = await ai.captions("interview.mp4", {
  language: "en",
  template: "subtitle",
  style: {
    fontSize: 42,
    color: "white",
    backgroundColor: "black@0.55"
  }
});
```

The returned `CaptionDocument` can be serialized to SRT/WebVTT/ASS or burned through the normal `Video.burnCaptions(...)` path. Word timing is preserved when supplied by the adapter.

## Scene detection

A deterministic FFmpeg-based detector is included, so scene analysis does not require an external AI provider:

```ts
const result = await new VexaAI().detectScenes("input.mp4", {
  threshold: 0.3,
  minSceneDuration: 0.5
});
```

It uses FFmpeg's scene score metadata and returns normalized boundaries plus complete scene ranges. Applications may replace it with a custom `SceneDetectionAdapter` when model-based scene semantics are needed.

## Silence removal

Silence removal is intentionally built from existing deterministic APIs rather than a separate media engine:

```ts
const plan = await ai.planSilenceRemoval("talk.mp4", {
  noiseDb: -40,
  minSilenceDuration: 0.6,
  paddingSeconds: 0.08,
  minimumKeepDuration: 0.12
});

console.log(plan.removed);
console.log(plan.kept);
console.log(plan.project);

await ai.removeSilence("talk.mp4", "talk-tight.mp4");
```

The helper runs the existing silence detector, computes retained ranges, and builds a serializable `VideoProjectAst` that compacts those ranges while preserving audio.

## Subject tracking and smart reframe

A subject-tracking adapter returns normalized frame regions in `0..1` coordinates:

```ts
const tracking = await ai.trackSubject("speaker.mp4", {
  subject: "main speaker",
  sampleIntervalSeconds: 0.5
});
```

`smartReframe(...)` converts tracking samples into an animated project:

```ts
const reframe = await ai.smartReframe("speaker.mp4", {
  width: 1080,
  height: 1920,
  subject: "main speaker",
  margin: 0.2
});

console.log(reframe.project);
```

The generated project uses normal Vexa keyframes for position and scale. The tracking provider never gets direct FFmpeg argument access.

## Highlight extraction

Highlight adapters return scored time ranges:

```ts
const analysis = await ai.extractHighlights("match.mp4", {
  maxHighlights: 5,
  prompt: "goals and decisive moments"
});
```

A compact highlight timeline can be generated from the same adapter:

```ts
const { project } = await ai.highlightProject("match.mp4", {
  maxHighlights: 5,
  gapSeconds: 0.15
});
```

The project is a normal `VideoProjectAst`, so applications can inspect, edit, serialize, queue, or render it using the existing SDK.

## Dependency policy

`@moosky-video/ai` includes no OpenAI, Whisper, cloud speech, object-detection, or tracking-model SDK. Install the provider SDK you need in your application and implement the matching adapter interface.

This keeps provider churn, credentials, model lifecycle, usage policy, and billing outside Vexa's deterministic media packages.

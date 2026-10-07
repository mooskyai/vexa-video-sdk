# Visual Playground

The visual playground is a local, framework-independent acceptance UI for exercising Vexa's Node SDK against real media. It is designed for development and regression testing, not as a production editor application.

## Editor workspace

The playground uses a compact desktop-editor layout that keeps the preview canvas and timeline visually dominant while still exposing the full SDK surface:

- the top bar stays shallow and keeps project status, import, and render actions in one row;
- the left tool rail switches between high-frequency clip controls and advanced workflow areas;
- the media bin applies single-line ellipsis to filenames/metadata while descriptive copy wraps naturally;
- the primary inspector keeps trim, transform, export, and thumbnail controls visible in a narrow pane;
- Project, Audio, Captions, Streaming, Hardware, and Jobs open in the right-side **More** drawer rather than permanently taking canvas width;
- the drawer includes its own compact navigation and closes with `Esc`, the close button, or the backdrop;
- the timeline uses denser tracks and toolbar spacing so more vertical space stays available for preview;
- JSON, logs, long labels, metadata, and generated filenames use explicit wrapping or ellipsis rules so content cannot spill into adjacent panes.

The drawer only reorganizes controls. SDK payloads and execution behavior are unchanged.

## Start

From the repository root:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4173
```

The server binds to loopback and stores temporary uploads/outputs under `.tmp/visual-playground`.

## What the playground validates

The UI provides one place to exercise the public media features:

- local media uploads;
- safe public HTTPS imports;
- source metadata and browser-safe preview generation;
- trim, resize, crop, rotate, and export planning;
- project/timeline composition;
- audio processing and analysis;
- captions, live preview, burn-in, and fullscreen testing;
- HLS/DASH packaging and preview sprites;
- hardware detection and benchmark diagnostics;
- background render jobs;
- generated-output playback and download links;
- the framework-neutral programmable Player workspace, including play/pause, frame stepping, seeking, looping, playback rate, volume/mute, responsive fit modes, buffering state, fullscreen, live state, and typed player events;
- the V2 composition Bundles workspace, including deterministic composition discovery, development/production builds, source-map modes, emitted CSS/assets/chunks/public files, manifest inspection, and sanitized bundler failures.

## Programmable player

Select **Player** from the left rail or the preview tabs in the normal playground at `http://127.0.0.1:4173/`. Player mode is part of the existing playground workspace: it hides unrelated media-editing inspector/timeline controls and gives playback, display, live-state, and event diagnostics their own focused layout. No separate demo URL is required.

The visual surface is a deterministic acceptance composition driven by `@vexa-video/player`; it is not a second rendering engine. Use it to verify controller behavior and browser integration while later rendering stages connect real bundled compositions to frame/video output.

## Composition bundles

Select **Bundles** from the left rail or **Compositions** from the preview tabs. This workspace exercises the real Node-side `@vexa-video/bundler` against the Vexa-owned fixture under `examples/visual-playground/compositions/`.

Use **Discover** to verify stable composition ordering and metadata. Use **Build bundle** to switch between development/production output and none/external/inline source maps, then inspect the schema-versioned manifest, emitted JavaScript/CSS, dynamic-import chunks, fingerprinted assets, copied public files, byte sizes, and SHA-256 metadata. The playground uses a fixed repository fixture and fixed environment allowlist; it does not accept arbitrary local source paths or expose environment values.

## Media library

Uploaded or imported assets appear in the media library with normalized metadata.

If a source codec/container is not likely to play directly in the browser, the Node server can generate a temporary H.264/AAC preview. The original source remains the input used by the SDK.

### Remote media

The Remote media input uses the same `Storage` security policy as the SDK:

- public HTTPS by default;
- plain HTTP rejected;
- loopback/private/link-local/reserved destinations rejected;
- redirects revalidated;
- temporary files kept inside the playground workspace.

A URL such as `https://127.0.0.1/test.mp4` should be rejected rather than used to access a local service.

## Video editing workflow

1. Upload/select a video.
2. Configure trim/resize/crop/rotation.
3. Inspect the payload and execution plan.
4. Render.
5. Watch structured progress reach 100%.
6. Play the generated output and compare metadata/duration/framing with the request.

Use cancellation on a longer render to verify process abortion.

## Project timeline

Project mode exercises `VideoProject` and the serializable timeline AST.

Test:

- multiple video clips;
- images;
- standalone audio;
- text layers;
- track ordering;
- hidden/muted/locked state;
- drag-to-move and trim handles;
- keyframe motion presets;
- fades, crossfades, wipes;
- supported blend modes;
- project planning before render.

Project source references remain opaque session identifiers in the browser and are resolved to local paths on the Node side.

## Audio

The Audio inspector supports:

- trim;
- loudness normalization;
- fade-in/fade-out;
- channel mapping;
- sidechain ducking;
- processing plan inspection;
- silence detection;
- waveform generation.

Use a second audio-capable asset as the sidechain source when testing ducking.

## Captions

Paste SRT, WebVTT, or ASS into the Captions inspector.

Recommended flow:

1. choose template/style settings;
2. click **Parse & preview**;
3. play/scrub the source and confirm the active cue is visible at the expected time;
4. use **Plan burn-in** to inspect the render plan;
5. render captions through the dedicated action or the main render action when caption inclusion is enabled;
6. play the final output and confirm the text is permanently burned in.

The **Full** transport button fullscreens the whole video stage so the live caption overlay remains visible.

## Streaming

The Streaming inspector supports HLS and MPEG-DASH packaging, built-in rendition presets, segment duration, HLS playlist type, and sprite/VTT generation.

### HLS acceptance

Confirm:

- master playlist;
- rendition playlists;
- `.ts` segments;
- portable forward-slash URIs.

### DASH acceptance

Confirm:

- `manifest.mpd`;
- init/media `.m4s` files;
- package files remain inside the selected output directory.

### Seek-preview sprite

Generate a sprite and confirm both the image and WebVTT `#xywh` cues are present.

Native browser playback of HLS/DASH is intentionally not required by this acceptance UI because browser support differs and the playground should not depend on an external CDN player library.

## Hardware

The Hardware inspector can:

- select CPU, Auto, NVIDIA, Intel, AMD, or Apple;
- detect compiled FFmpeg encoders;
- run runtime availability probes;
- show per-codec capability information;
- benchmark a short real-source encode;
- feed the selected provider into normal renders and streaming plans.

`runtimeAvailable: false` is a valid result when an encoder is compiled but the required GPU/device/driver cannot be used.

## Background jobs

The Jobs inspector executes the current video render through the local worker pool.

Verify:

- queued/running/succeeded state changes;
- progress propagation;
- cancellation;
- retry configuration;
- idempotency-key reuse for identical work;
- idempotency conflict for different work with the same key;
- deterministic job-based output naming.

## Generated assets

Depending on the workflow, generated items may include:

- video renders;
- thumbnails;
- extracted/processed audio;
- waveforms;
- HLS/DASH manifests and segments;
- preview sprites/VTT;
- browser-safe previews.

These are temporary development artifacts and should not be treated as durable application storage.

## Troubleshooting

### Port 4173 is already in use

Set another local port through the playground's supported environment variable or stop the existing process.

### Video does not play in the browser

Confirm the source was successfully probed, then use/allow browser-preview generation. Browser playback capability is separate from FFmpeg input support.

### Captions parse but are not visible

Confirm **Parse & preview** completed, the caption inclusion toggle is enabled, and playback is inside a cue's time range.

### GPU encoder appears but render falls back to CPU

Inspect runtime capability output. FFmpeg may advertise the encoder while the hardware runtime probe fails.

### HLS contains backslashes on Windows

Generated `.m3u8` files should be normalized to `/`. Treat any new backslash URI regression as a bug.

## Relationship to the Angular demo

The visual playground and Angular demo serve different purposes:

- **Visual playground (`4173`)** — direct local acceptance harness around Node SDK functionality.
- **Angular demo (`4200` + render API `4180`)** — validates the browser-safe Angular package and browser-to-server job contract.

Both should remain useful because they test different architectural boundaries.

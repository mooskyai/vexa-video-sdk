# Programmable Compositions

Version 2 adds a Vexa-native code-defined video layer without creating a second media engine. Composition metadata, timing and scene definitions remain deterministic and serializable where practical; Node rendering lowers supported work into the existing Vexa execution paths.

## Package flow

```text
composition source (TS/TSX)
        |
        v
@vexa-video/bundler
        |
        v
bundle + manifest
        |
        +------------------> @vexa-video/player / Studio preview
        |
        v
@vexa-video/renderer
        |
        v
Vexa project / FFmpeg execution
```

## Define bundle compositions

A bundle entry can export descriptors with `defineBundleCompositions`:

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
  },
  {
    id: "thumbnail",
    kind: "still",
    width: 1200,
    height: 630
  }
]);
```

Executable compositions can additionally provide validated props, dynamic metadata and frame/surface behavior through the public composition APIs.

## CLI workflow

From a project with the Vexa CLI installed:

```bash
vexa compositions ./src/video.tsx --json
vexa bundle ./src/video.tsx --out-dir ./.vexa/bundle --json
vexa inspect product-demo --manifest ./.vexa/bundle/vexa.bundle.json --json
vexa validate product-demo --manifest ./.vexa/bundle/vexa.bundle.json --props '{"fps":30}' --json
vexa render product-demo output.mp4 --manifest ./.vexa/bundle/vexa.bundle.json
vexa still product-demo thumbnail.png --manifest ./.vexa/bundle/vexa.bundle.json --frame 15
```

On Windows/PowerShell, if JSON quoting is transformed by an npm command shim, invoke the built CLI entry directly or provide JSON through an application-owned wrapper that preserves quoting.

## Rendering behavior

`@vexa-video/renderer` owns bundle-backed:

- composition discovery/inspection;
- props defaulting and validation;
- dynamic metadata resolution;
- still and selected-frame rendering;
- bounded frame ranges;
- MP4/WebM video output;
- progress, cancellation and timeout handling;
- hardware selection;
- managed storage-backed assets.

Do not bypass the renderer by invoking arbitrary composition code from agent/browser inputs.

## Browser preview

`@vexa-video/player` provides framework-neutral playback state and a browser host. `@vexa-video/studio` coordinates composition selection, draft props, resolved metadata, preview state, timeline state and hot-reload frame preservation.

Browser packages remain execution-safe: they do not import the Node SDK or FFmpeg process code.

## Graphics and media

The Version 2 composition system includes deterministic shape/text/media primitives, effects, transitions, fonts, captions, GIF/waveform adapters and logical sound effects. Optional adapters remain additive packages rather than dependencies of `@vexa-video/core`.

## Templates and automation

Parameterized templates use validated input schemas and deterministic composition discovery. Agent/MCP/CLI calls resolve through the same composition contracts, so automation does not create a separate validation or render path.

## Hosted rendering

For remote execution, use the hosted-render contracts described in [Hosted rendering](./hosted-rendering.md). Hosted requests delegate to the normal renderer/jobs/storage boundaries.

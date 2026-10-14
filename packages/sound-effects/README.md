# @vexa-video/sound-effects

Browser-safe reusable sound-effect catalogs for Vexa programmable compositions.

The package does not decode, load, or execute audio. It maps stable logical sound IDs to existing Vexa audio assets and creates ordinary programmable-scene audio nodes, so storage resolution and FFmpeg execution remain on Vexa's existing project path.

```ts
import { defineProgrammableScene } from "@vexa-video/core";
import { createSoundEffectLibrary } from "@vexa-video/sound-effects";

const sounds = createSoundEffectLibrary({
  effects: {
    click: {
      source: { kind: "static", src: "/media/click.wav" },
      volume: 0.7
    },
    success: { kind: "static", src: "/media/success.wav" }
  }
});

const scene = defineProgrammableScene({
  id: "sound-demo",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 180,
  assets: sounds.assets,
  children: [
    sounds.createNode("click", {
      id: "click-1",
      startFrame: 12,
      durationInFrames: 18
    }),
    sounds.createNode("click", {
      id: "click-2",
      startFrame: 60,
      durationInFrames: 18,
      playbackRate: 1.1
    })
  ]
});
```

Catalog entries may use any existing `ProgrammableSceneAssetSource`, including storage-backed sources. Per-effect defaults support preload, source offset, playback rate, volume, and mute. Each node instance can override playback settings without duplicating the asset definition.

The package depends only on `@vexa-video/core`. It has no FFmpeg, filesystem, renderer, SDK, or browser-DOM runtime dependency.

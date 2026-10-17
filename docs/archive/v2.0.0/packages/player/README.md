# @vexa-video/player

Browser-safe, framework-neutral playback state and DOM hosting for Vexa programmable compositions.

```ts
import { createVexaPlayerController, mountVexaPlayer } from "@vexa-video/player";

const controller = createVexaPlayerController({
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 300,
  controls: "default"
});

const host = mountVexaPlayer(document.querySelector("#player")!, controller, {
  renderFrame: ({ frame, viewport }) => {
    viewport.textContent = `frame ${frame}`;
  }
});

controller.play();
```

The controller owns deterministic frame, seek, loop, volume, rate, buffering, end, poster-frame, resize, and typed-event semantics. Browser scheduling and DOM behavior are thin adapters over that state machine.

`controls: "default"` mounts accessible native buttons/range input. `controls: "custom"` and `controls: "none"` inject no default controls so applications can bind their own UI to the same controller.

The package may depend on `@vexa-video/core/browser`, but it must not runtime-import the Node SDK, FFmpeg execution code, Redis, filesystem modules, or `node:*` APIs.

# @vexa-video/studio

Browser-safe Studio session state for local Vexa programmable-composition development.

The package composes the existing `@vexa-video/player` playback controller and `@vexa-video/editor` timeline state instead of defining another frame or editor model.

```ts
import { createVexaStudioSession } from "@vexa-video/studio";

const studio = createVexaStudioSession({
  compositions: discoveredCompositions,
  selectedCompositionId: "product-demo"
});

studio.seekFrame(45);
studio.setProps({ title: "Launch day" });

const snapshot = studio.getSnapshot();
console.log(snapshot.frame, snapshot.props, snapshot.resolvedMetadata);
```

A development host is responsible for bundle discovery, dynamic metadata resolution, hot-reload transport, and Node rendering. The browser package owns deterministic composition selection, draft props, resolved metadata inspection, preview/playhead coordination, timeline viewport state, and safe frame preservation across catalog reloads.

The repository Playground now includes a **Studio** workspace that binds this session runtime to the existing composition bundler and Node renderer. It loads the generated browser bundle through an explicit local development-host route, evaluates props/dynamic metadata in the browser-safe bundle, exposes Player-backed frame controls and Editor-backed playhead state, inspects scene assets, and sends the resolved props through the existing renderer boundary for still/frame/video output.

The Playground development host now watches the composition source tree and streams revisioned change notifications over SSE. Studio responds by rebuilding/reloading through `VexaStudioSession.reloadCompositions()`, preserving the legal current frame and any unapplied props draft for the same composition. The browser package still never watches the filesystem itself; source watching, bundling, and rendering remain Node-host responsibilities. Repository acceptance drives the real Studio UI through Chrome/Edge, including composition switching, playback/scrubbing, hot reload, frame rendering/progress, renderer-error recovery, and the Windows path-with-spaces development-host case.

`@vexa-video/studio` must remain browser-safe. It must not runtime-import `@vexa-video/sdk`, `@vexa-video/renderer`, FFmpeg wrappers, filesystem APIs, Redis, `child_process`, or `node:*` modules.

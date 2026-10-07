# @vexa-video/react

Browser-safe React authoring primitives for Vexa programmable video compositions. React is an adapter over `@vexa-video/core` composition, timing, and scene contracts; this package does not execute FFmpeg or import the Node SDK.

```tsx
import { defineComposition, resolveProgrammableComposition } from "@vexa-video/core/browser";
import {
  VexaCompositionRoot,
  VexaLayer,
  VexaText,
  useVexaFrame,
  vexaStaticAsset
} from "@vexa-video/react";

const definition = defineComposition({
  id: "title-card",
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 90,
  defaultProps: { title: "Vexa Video" }
});

function TitleCard() {
  const frame = useVexaFrame();
  return (
    <VexaLayer id="title-layer" transform={{ x: frame * 2, y: 200 }}>
      <VexaText id="title" text="Vexa Video" style={{ fontSize: 72, color: "white" }} />
    </VexaLayer>
  );
}

const resolved = await resolveProgrammableComposition(definition);
const logo = vexaStaticAsset("logo", "image", "/assets/logo.png");

<VexaCompositionRoot resolved={resolved} frame={0} assets={[logo]} onScene={(scene) => console.log(scene)}>
  <TitleCard />
</VexaCompositionRoot>;
```

The package also provides composition registration, sequence/series/loop/freeze timing scopes, media scene components, input/config hooks, and render-readiness coordination for asynchronous authoring work.

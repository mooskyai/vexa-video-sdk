# @vexa-video/react

Browser-safe React authoring primitives for Vexa programmable video compositions. React is an adapter over `@vexa-video/core` composition, timing, and scene contracts; this package does not execute FFmpeg or import the Node SDK.

```tsx
import { defineComposition, resolveProgrammableComposition } from "@vexa-video/core/browser";
import {
  VexaCompositionRoot,
  VexaLayer,
  VexaRectangle,
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
      <VexaRectangle
        id="accent"
        x={80}
        y={80}
        width={240}
        height={120}
        radiusX={24}
        style={{ fill: "#5b5df0" }}
        effects={[{ kind: "glow", radius: 18, color: "#8b5cf6", opacity: 0.65 }]}
        transitions={{ in: { kind: "zoom", durationInFrames: 12, easing: "ease-out" } }}
      />
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

The package also provides composition registration, sequence/series/loop/freeze timing scopes, media scene components, generic `VexaShape` authoring plus rectangle/ellipse/circle/line/polygon/star/path/arc convenience components, ordered `effects` and `transitions` props on visual scene components, input/config hooks, and render-readiness coordination for asynchronous authoring work. Effects and transitions use the shared browser-safe contracts from `@vexa-video/core/browser`; audio and group/layer containers intentionally do not expose visual effects or transitions. Transition authoring currently normalizes intent only; renderer execution remains fail-closed until the dedicated transition graph is implemented.

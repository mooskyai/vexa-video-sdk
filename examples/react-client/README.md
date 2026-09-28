# React integration example

This source-only example shows the framework boundary without introducing React as a dependency of the Vexa monorepo. Copy `src/VexaRenderDemo.tsx` into a React/Vite/Next client and point it at the REST service template.

It demonstrates upload → background render job → polling → output playback using only browser `fetch`.

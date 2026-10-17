# Vue integration example

This source-only example keeps Vue out of the Vexa runtime dependency graph. Copy `src/App.vue` into a Vue/Vite application and point it at the REST service template.

It demonstrates upload → background render job → polling → output playback using browser `fetch`.

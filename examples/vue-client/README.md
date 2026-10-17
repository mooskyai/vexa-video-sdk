# Vue render-service integration example

This is a source-only Vue example for the browser → render-service boundary. It keeps Vue out of Vexa's runtime dependency graph.

`src/App.vue` demonstrates:

1. selecting/uploading media from a browser;
2. submitting a background render job to the REST service template;
3. polling job/progress state;
4. playing the completed output.

Copy or adapt the component into an existing Vue/Vite application and point it at a compatible Vexa render service. For a runnable backend from this repository:

```bash
npm run example:rest-service
```

The default service origin is `http://127.0.0.1:4190`.

Vexa `2.0.0` does not publish a first-party `@vexa-video/vue` framework package; the example intentionally consumes the service boundary directly. A framework package is future Version 3 ecosystem work, not a current feature.

# React render-service integration example

This is a source-only React example for the browser → render-service boundary. It intentionally does not add React as a runtime dependency of the Vexa monorepo.

`src/VexaRenderDemo.tsx` demonstrates:

1. selecting/uploading media from a browser;
2. submitting a background render job to the REST service template;
3. polling job/progress state;
4. playing the completed output.

Copy or adapt the component into an existing React/Vite/Next application and point it at a compatible Vexa render service. For a runnable backend from this repository:

```bash
npm run example:rest-service
```

The default service origin is `http://127.0.0.1:4190`.

This example uses the service contract; it is separate from `@vexa-video/react`, which is the programmable-composition authoring adapter. See [`../../docs/package-guide.md`](../../docs/package-guide.md).

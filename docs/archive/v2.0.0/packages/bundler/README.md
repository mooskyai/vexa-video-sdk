# @vexa-video/bundler

Node-side composition bundling and discovery tooling for Vexa programmable video.

The package turns a TypeScript/TSX composition entry into a browser-executable ESM bundle plus a deterministic `vexa.bundle.json` manifest. It is development/build tooling: playback remains in `@vexa-video/player`, composition semantics remain in `@vexa-video/core` / `@vexa-video/react`, and Node rendering is owned by `@vexa-video/renderer`.

## Entry contract

A composition entry exports a `vexaCompositions` array. Use the browser-safe helper from `@vexa-video/bundler/entry` to validate and deterministically sort the metadata:

```ts
import { defineBundleCompositions } from "@vexa-video/bundler/entry";

export const vexaCompositions = defineBundleCompositions([
  {
    id: "product-demo",
    kind: "video",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300
  }
]);
```

The entry can also export the React/components/runtime values needed by the browser bundle. Discovery requires module initialization to remain side-effect-safe for Node execution; DOM work should happen inside components/runtime functions rather than at module top level.

## Bundle

```ts
import { bundleCompositions } from "@vexa-video/bundler";

const result = await bundleCompositions({
  rootDir: process.cwd(),
  entry: "src/video.tsx",
  outDir: ".vexa/bundle",
  publicDir: "public",
  mode: "development",
  sourceMap: "external",
  environmentAllowlist: ["VEXA_PUBLIC_API_URL"]
});

console.log(result.manifest.compositions);
```

Only environment variables named in `environmentAllowlist` are embedded. Both `process.env` and `import.meta.env` are replaced with the filtered object; other host environment values are not exposed to the browser bundle.

## Output

A build can contain:

```text
.vexa/bundle/
  index.js
  index.js.map
  index.css
  chunks/
  assets/
  <copied public files>
  vexa.bundle.json
```

The manifest contains normalized relative paths, sorted composition discovery, the allowlisted environment-variable names, and SHA-256/size metadata for emitted files. It intentionally contains no timestamps or machine-specific absolute paths.

Bundle publication uses a staging directory and final directory promotion. On Windows, transient `EPERM`, `EACCES`, or `EBUSY` promotion failures are retried with a short bounded backoff so filesystem indexing or antivirus handles do not make otherwise successful builds flaky.

## Security boundary

Bundling and discovery execute trusted application source in the local Node development/build environment. This package is not a sandbox. A hosted service that accepts untrusted composition code must isolate bundling/discovery at the process or container boundary.

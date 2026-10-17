# Ecosystem and Distribution

Vexa 2.0.0 is distributed as eighteen synchronized public npm packages plus repository examples and deployment recipes.

## Public package model

Use the smallest package set that matches a runtime. Node media execution, browser UI, optional adapters and automation surfaces are intentionally separated.

See [Package guide](./package-guide.md).

## CLI

`@vexa-video/cli` exposes media and composition operations without creating a separate execution engine. Commands delegate to the same SDK/bundler/renderer contracts used by application code.

```bash
npm install --global @vexa-video/cli@2.0.0
vexa --help
```

## REST/service examples

The repository includes a generic Node render-service example and Docker worker recipe. They demonstrate how to keep browser clients separated from Node execution, but they are templates rather than a hosted Vexa SaaS product.

Run the REST example:

```bash
npm run example:rest-service
```

Default address:

```text
http://127.0.0.1:4190
```

## Framework examples

Browser examples demonstrate transport/job/progress/playback patterns without adding all frameworks as runtime dependencies of the SDK.

Angular has a published browser integration package. React has a published composition authoring package. Additional framework/service packages planned for Version 3 should reuse shared contracts rather than duplicate renderer behavior.

## MCP and agents

`@vexa-video/mcp` provides typed composition and hosted-render tools over the existing contracts. It intentionally does not expose arbitrary shell execution.

## Release model

Public packages are versioned together and published through the protected GitHub Actions release workflow using npm trusted publishing/provenance. See [Release operations](./release-operations.md).

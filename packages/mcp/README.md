# @vexa-video/mcp

Transport-neutral, agent-safe composition operations for MCP hosts and other automation layers.

This package does not create a second renderer, queue, hosted API, props schema, or shell-command surface. It delegates composition listing/inspection/validation to `VexaCompositionRenderer` and render submission/state/cancellation to `HostedRenderer`-compatible contracts.

```ts
import { VexaMcpCompositionTools } from "@vexa-video/mcp";
import { VexaCompositionRenderer } from "@vexa-video/renderer";
import { HostedRenderer } from "@vexa-video/sdk";

const renderer = await VexaCompositionRenderer.fromManifest("./.vexa/bundle/vexa.bundle.json");
const hostedRenderer = new HostedRenderer(hostedAdapter);
const tools = new VexaMcpCompositionTools({ renderer, hostedRenderer });

const result = await tools.callTool("vexa.compositions.validate", {
  compositionId: "product-demo",
  inputProps: { headline: "Launch" }
});
```

The first public surface exposes six stable operations:

- `vexa.compositions.list`
- `vexa.compositions.inspect`
- `vexa.compositions.validate`
- `vexa.renders.start`
- `vexa.renders.get`
- `vexa.renders.cancel`

`listTools()` returns transport-neutral tool descriptors with JSON-object input schemas. `callTool()` rejects unsupported fields at the automation boundary, preserves renderer/hosted error codes when available, and never accepts raw media commands or shell fragments. Composition props still resolve through the existing Vexa schema/custom-validator/dynamic-metadata path, while render requests still normalize through the existing hosted composition contract.

A protocol-specific MCP server/stdio transport can be layered over this package later without changing composition or render semantics.

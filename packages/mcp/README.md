# @vexa-video/mcp

Agent-safe Vexa composition operations with an official Model Context Protocol server boundary.

The package keeps composition and render semantics in their existing owners. `VexaMcpCompositionTools` delegates composition listing/inspection/validation to `VexaCompositionRenderer` and render submission/state/cancellation to `HostedRenderer`-compatible contracts. The protocol layer only publishes those six operations over MCP; it does not create a second renderer, queue, hosted API, props schema, or shell-command surface.

```ts
import { VexaMcpCompositionTools } from "@vexa-video/mcp";
import { serveVexaMcpStdio } from "@vexa-video/mcp/stdio";
import { VexaCompositionRenderer } from "@vexa-video/renderer";
import { HostedRenderer } from "@vexa-video/sdk";

const renderer = await VexaCompositionRenderer.fromManifest("./.vexa/bundle/vexa.bundle.json");
const hostedRenderer = new HostedRenderer(hostedAdapter);
const tools = new VexaMcpCompositionTools({ renderer, hostedRenderer });

await serveVexaMcpStdio(tools, {
  name: "my-vexa-server",
  version: "1.0.0"
});
```

`@vexa-video/mcp/server` exposes `createVexaMcpServer()` for hosts that need to connect another MCP transport. `@vexa-video/mcp/stdio` uses the official `@modelcontextprotocol/sdk` `StdioServerTransport`; the SDK is a peer dependency so an MCP host controls the compatible 1.x runtime it loads.

The public tool catalog is stable:

- `vexa.compositions.list`
- `vexa.compositions.inspect`
- `vexa.compositions.validate`
- `vexa.renders.start`
- `vexa.renders.get`
- `vexa.renders.cancel`

`tools/list` publishes the same JSON-object schemas returned by `VexaMcpCompositionTools.listTools()`. `tools/call` routes directly into `callTool()`, so the existing strict operation-envelope checks still reject unsupported fields before renderer or hosted-render delegation. Renderer/hosted error codes are returned as MCP tool errors (`isError: true`) with machine-readable JSON text. No raw media command or arbitrary shell execution tool is exposed.

For local development, install a compatible protocol runtime alongside the package:

```bash
npm install @vexa-video/mcp @modelcontextprotocol/sdk@^1.30.0
```

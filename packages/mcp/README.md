# @vexa-video/mcp

Publishes typed Vexa composition and hosted-render operations through a transport-neutral tool dispatcher plus the official MCP server/stdio boundary.

> Stable baseline: **2.0.0** · Node.js agent/MCP integration.

## Install

```bash
npm install @vexa-video/mcp@2.0.0
```

## When to use it

Use this package when agents should list/inspect/validate compositions or start/get/cancel hosted renders without receiving raw shell access.

## Capabilities

- Typed composition list/inspect/validate tools
- Hosted render start/get/cancel tools
- Official MCP server adapter
- stdio transport
- Stable machine-readable Vexa failures

## Minimal example

```ts
import { serveVexaMcpStdio } from "@vexa-video/mcp/stdio";

await serveVexaMcpStdio(tools, { name: "my-vexa-server", version: "1.0.0" });
```

## Runtime boundary

Tools reuse renderer/hosted contracts and intentionally do not accept arbitrary shell/media commands.

## Documentation

- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)
- [hosted-rendering.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/hosted-rendering.md)
- [SECURITY.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/SECURITY.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

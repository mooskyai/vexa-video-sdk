import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { VexaMcpCompositionTools } from "./index.js";
import {
  createVexaMcpServer,
  type VexaMcpProtocolServerOptions
} from "./server.js";

/**
 * Connect the Vexa MCP server to process stdin/stdout using the official MCP stdio transport.
 * Application code still owns renderer/hosted-adapter construction and credentials.
 */
export async function serveVexaMcpStdio(
  tools: VexaMcpCompositionTools,
  options: VexaMcpProtocolServerOptions = {}
): Promise<Server> {
  const server = createVexaMcpServer(tools, options);
  await server.connect(new StdioServerTransport());
  return server;
}

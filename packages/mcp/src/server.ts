import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import type {
  VexaMcpCompositionTools,
  VexaMcpToolCallResult,
  VexaMcpToolDefinition
} from "./index.js";

export interface VexaMcpProtocolServerOptions {
  readonly name?: string;
  readonly version?: string;
}

const DEFAULT_SERVER_NAME = "vexa-video";
const DEFAULT_SERVER_VERSION = "1.0.0";

function optionalText(value: string | undefined, fallback: string, label: string): string {
  const normalized = value?.trim() ?? fallback;
  if (!normalized) throw new TypeError(`${label} must be a non-empty string.`);
  return normalized;
}

function serializeToolPayload(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? "null";
}

function protocolTool(definition: VexaMcpToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema as Tool["inputSchema"]
  };
}

function protocolResult(result: VexaMcpToolCallResult): CallToolResult {
  if (result.ok) {
    return {
      content: [{ type: "text", text: serializeToolPayload(result.value) }]
    };
  }

  return {
    content: [{
      type: "text",
      text: serializeToolPayload({
        error: result.error,
        tool: result.tool
      })
    }],
    isError: true
  };
}

export function createVexaMcpServer(
  tools: VexaMcpCompositionTools,
  options: VexaMcpProtocolServerOptions = {}
): Server {
  if (!tools || typeof tools.listTools !== "function" || typeof tools.callTool !== "function") {
    throw new TypeError("createVexaMcpServer requires VexaMcpCompositionTools-compatible operations.");
  }

  const server = new Server(
    {
      name: optionalText(options.name, DEFAULT_SERVER_NAME, "MCP server name"),
      version: optionalText(options.version, DEFAULT_SERVER_VERSION, "MCP server version")
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.listTools().map(protocolTool)
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await tools.callTool(request.params.name, request.params.arguments);
    return protocolResult(result);
  });

  return server;
}

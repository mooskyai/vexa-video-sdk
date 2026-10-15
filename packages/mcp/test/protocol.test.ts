import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  HostedCompositionRenderPayload,
  HostedRenderJob,
  JsonObject,
  ProgrammableCompositionStaticMetadata,
  ResolvedProgrammableComposition
} from "@vexa-video/core";
import {
  VEXA_MCP_TOOL_NAMES,
  VexaMcpCompositionTools,
  type VexaMcpCompositionRuntime,
  type VexaMcpHostedRenderRuntime
} from "../src/index.js";
import { createVexaMcpServer } from "../src/server.js";

class ProtocolCompositionRuntime implements VexaMcpCompositionRuntime {
  listCompositions() {
    return Object.freeze([
      Object.freeze({
        id: "product-demo",
        kind: "video" as const,
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 120
      })
    ]);
  }

  async inspectComposition(id: string): Promise<ProgrammableCompositionStaticMetadata> {
    return Object.freeze({
      schemaVersion: 1,
      kind: "video" as const,
      id,
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 120,
      defaultProps: Object.freeze({ background: "#0b1220" })
    });
  }

  async resolveComposition(id: string, inputProps?: JsonObject): Promise<ResolvedProgrammableComposition> {
    if (inputProps?.background === "invalid") {
      const error = new Error("background must be a six-digit hex color.") as Error & {
        code: string;
        compositionId: string;
      };
      error.code = "RENDER_INPUT_PROPS_INVALID";
      error.compositionId = id;
      throw error;
    }
    return Object.freeze({
      metadata: Object.freeze({
        schemaVersion: 1,
        kind: "video" as const,
        id,
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 120
      }),
      props: Object.freeze({ background: "#0b1220", ...(inputProps ?? {}) })
    });
  }
}

class ProtocolHostedRuntime implements VexaMcpHostedRenderRuntime {
  async submitComposition<TResult = unknown>(
    payload: HostedCompositionRenderPayload
  ): Promise<HostedRenderJob<TResult>> {
    return {
      id: `job-${payload.output.artifactId}`,
      state: "queued"
    } as HostedRenderJob<TResult>;
  }

  async get<TResult = unknown>(jobId: string): Promise<HostedRenderJob<TResult>> {
    return {
      id: jobId,
      state: "running",
      progress: { percent: 50, phase: "render" }
    } as HostedRenderJob<TResult>;
  }

  async cancel<TResult = unknown>(jobId: string): Promise<HostedRenderJob<TResult>> {
    return { id: jobId, state: "cancelled" } as HostedRenderJob<TResult>;
  }
}

function createProtocolTools(): VexaMcpCompositionTools {
  return new VexaMcpCompositionTools({
    renderer: new ProtocolCompositionRuntime(),
    hostedRenderer: new ProtocolHostedRuntime()
  });
}

function textContent(result: CallToolResult): string {
  const content = result.content[0];
  assert.ok(content && content.type === "text");
  return content.text;
}

test("MCP protocol server lists the existing tool catalog and routes typed calls", async () => {
  const server = createVexaMcpServer(createProtocolTools(), {
    name: "vexa-protocol-test",
    version: "1.0.0"
  });
  const client = new Client({ name: "vexa-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  try {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map((tool) => tool.name), VEXA_MCP_TOOL_NAMES);
    assert.equal(catalog.tools[0]?.inputSchema.type, "object");

    const listed = await client.callTool({
      name: "vexa.compositions.list",
      arguments: {}
    });
    assert.notEqual(listed.isError, true);
    assert.deepEqual(JSON.parse(textContent(listed)), [
      {
        id: "product-demo",
        kind: "video",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 120
      }
    ]);

    const invalid = await client.callTool({
      name: "vexa.compositions.validate",
      arguments: {
        compositionId: "product-demo",
        inputProps: { background: "invalid" }
      }
    });
    assert.equal(invalid.isError, true);
    assert.deepEqual(JSON.parse(textContent(invalid)), {
      error: {
        code: "RENDER_INPUT_PROPS_INVALID",
        message: "background must be a six-digit hex color.",
        compositionId: "product-demo"
      },
      tool: "vexa.compositions.validate"
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP stdio transport works through a spawned Node process", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/stdio-server.ts", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", fixture]
  });
  const client = new Client({ name: "vexa-stdio-test-client", version: "1.0.0" });

  await client.connect(transport);
  try {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map((tool) => tool.name), VEXA_MCP_TOOL_NAMES);

    const render = await client.callTool({
      name: "vexa.renders.get",
      arguments: { jobId: "stdio-job-1" }
    });
    assert.notEqual(render.isError, true);
    assert.deepEqual(JSON.parse(textContent(render)), {
      id: "stdio-job-1",
      state: "running",
      progress: { percent: 50, phase: "render" }
    });
  } finally {
    await client.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import type {
  HostedCompositionRenderPayload,
  HostedCompositionRenderRequestOptions,
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

function rendererFailure(code: string, message: string, compositionId: string): Error {
  const error = new Error(message) as Error & { code: string; compositionId: string };
  error.code = code;
  error.compositionId = compositionId;
  return error;
}

class FakeCompositionRuntime implements VexaMcpCompositionRuntime {
  readonly composition: ProgrammableCompositionStaticMetadata = Object.freeze({
    schemaVersion: 1,
    kind: "video",
    id: "product-demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 120,
    defaultProps: Object.freeze({ background: "#0b1220", fps: 30 }),
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        background: Object.freeze({ type: "string", minLength: 7, maxLength: 7 }),
        fps: Object.freeze({ type: "number", minimum: 1, maximum: 120 })
      }),
      required: Object.freeze(["background", "fps"]),
      additionalProperties: false
    })
  });

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
    assert.equal(id, "product-demo");
    return this.composition;
  }

  async resolveComposition(id: string, inputProps?: JsonObject): Promise<ResolvedProgrammableComposition> {
    assert.equal(id, "product-demo");
    if (inputProps?.background === "not-a-color") {
      throw rendererFailure(
        "RENDER_INPUT_PROPS_INVALID",
        "background must be a six-digit hex color.",
        id
      );
    }
    const fps = typeof inputProps?.fps === "number" ? inputProps.fps : 30;
    return Object.freeze({
      metadata: Object.freeze({
        schemaVersion: 1,
        kind: "video" as const,
        id,
        width: 1920,
        height: 1080,
        fps,
        durationInFrames: 120
      }),
      props: Object.freeze({
        background: "#0b1220",
        fps: 30,
        ...(inputProps ?? {})
      })
    });
  }
}

class FakeHostedRuntime implements VexaMcpHostedRenderRuntime {
  submissions = 0;
  lastPayload: HostedCompositionRenderPayload | undefined;
  lastRequestOptions: HostedCompositionRenderRequestOptions | undefined;

  async submitComposition<TResult = unknown>(
    payload: HostedCompositionRenderPayload,
    requestOptions: HostedCompositionRenderRequestOptions = {}
  ): Promise<HostedRenderJob<TResult>> {
    this.submissions += 1;
    this.lastPayload = payload;
    this.lastRequestOptions = requestOptions;
    return { id: "job-1", state: "queued" } as HostedRenderJob<TResult>;
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

function createTools() {
  const renderer = new FakeCompositionRuntime();
  const hostedRenderer = new FakeHostedRuntime();
  return {
    renderer,
    hostedRenderer,
    tools: new VexaMcpCompositionTools({ renderer, hostedRenderer })
  };
}

function renderPayload(): HostedCompositionRenderPayload {
  return {
    schemaVersion: 1,
    bundle: { id: "bundle-1", manifest: "s3://bundles/bundle-1/vexa.bundle.json" },
    compositionId: "product-demo",
    target: { kind: "video", startFrame: 0, endFrameExclusive: 60, container: "mp4" },
    inputProps: { background: "#223344", fps: 24 },
    output: { artifactId: "render-1", destination: "s3://renders/render-1.mp4" }
  };
}

test("MCP tool catalog is stable and exposes strict JSON-object schemas", () => {
  const { tools } = createTools();
  assert.deepEqual(tools.listTools().map((tool) => tool.name), VEXA_MCP_TOOL_NAMES);
  for (const tool of tools.listTools()) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test("MCP composition operations reuse renderer listing, inspection, and prop resolution", async () => {
  const { tools } = createTools();

  const listed = await tools.callTool("vexa.compositions.list", {});
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.deepEqual(listed.value, [
      {
        id: "product-demo",
        kind: "video",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 120
      }
    ]);
  }

  const inspected = await tools.callTool("vexa.compositions.inspect", { compositionId: "product-demo" });
  assert.equal(inspected.ok, true);
  if (inspected.ok) {
    const value = inspected.value as ProgrammableCompositionStaticMetadata;
    assert.equal(value.id, "product-demo");
    assert.deepEqual(value.defaultProps, { background: "#0b1220", fps: 30 });
    assert.equal(value.inputSchema?.type, "object");
  }

  const validated = await tools.callTool("vexa.compositions.validate", {
    compositionId: "product-demo",
    inputProps: { background: "#223344", fps: 24 }
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    const value = validated.value as ResolvedProgrammableComposition;
    assert.equal(value.metadata.kind, "video");
    if (value.metadata.kind === "video") assert.equal(value.metadata.fps, 24);
    assert.equal(value.props.background, "#223344");
  }
});

test("MCP validation surfaces renderer error codes without a second props validator", async () => {
  const { tools } = createTools();
  const result = await tools.callTool("vexa.compositions.validate", {
    compositionId: "product-demo",
    inputProps: { background: "not-a-color" }
  });

  assert.deepEqual(result, {
    ok: false,
    tool: "vexa.compositions.validate",
    error: {
      code: "RENDER_INPUT_PROPS_INVALID",
      message: "background must be a six-digit hex color.",
      compositionId: "product-demo"
    }
  });
});

test("MCP render operations delegate start, state, and cancellation to hosted rendering", async () => {
  const { tools, hostedRenderer } = createTools();
  const payload = renderPayload();

  const started = await tools.callTool("vexa.renders.start", {
    payload,
    requestOptions: { idempotencyKey: "render-1" }
  });
  assert.equal(started.ok, true);
  assert.equal(hostedRenderer.submissions, 1);
  assert.deepEqual(hostedRenderer.lastPayload, payload);
  assert.equal(hostedRenderer.lastRequestOptions?.idempotencyKey, "render-1");

  const state = await tools.callTool("vexa.renders.get", { jobId: "job-1" });
  assert.equal(state.ok, true);
  if (state.ok) assert.deepEqual(state.value, {
    id: "job-1",
    state: "running",
    progress: { percent: 50, phase: "render" }
  });

  const cancelled = await tools.callTool("vexa.renders.cancel", { jobId: "job-1" });
  assert.equal(cancelled.ok, true);
  if (cancelled.ok) assert.deepEqual(cancelled.value, { id: "job-1", state: "cancelled" });
});

test("MCP boundary rejects shell-style or unsupported operation fields before delegation", async () => {
  const { tools, hostedRenderer } = createTools();
  const payload = renderPayload() as HostedCompositionRenderPayload & { command?: string };
  payload.command = "ffmpeg -i input.mp4 output.mp4";

  const result = await tools.callTool("vexa.renders.start", { payload });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "MCP_INVALID_INPUT");
    assert.match(result.error.message, /unsupported field: command/iu);
  }
  assert.equal(hostedRenderer.submissions, 0);
});

test("MCP boundary returns typed failures for unknown tools and malformed job input", async () => {
  const { tools } = createTools();

  const unknown = await tools.callTool("vexa.shell.exec", { command: "echo unsafe" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "MCP_TOOL_NOT_FOUND");

  const malformed = await tools.callTool("vexa.renders.get", { jobId: "", command: "whoami" });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error.code, "MCP_INVALID_INPUT");
});

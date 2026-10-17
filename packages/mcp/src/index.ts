import type {
  HostedCompositionRenderPayload,
  HostedCompositionRenderRequestOptions,
  HostedRenderJob,
  JsonObject,
  ProgrammableCompositionStaticMetadata,
  ResolvedProgrammableComposition
} from "@vexa-video/core";
import type { VexaCompositionRenderer } from "@vexa-video/renderer";
import type { HostedRenderer } from "@vexa-video/sdk";

export const VEXA_MCP_TOOL_NAMES = Object.freeze([
  "vexa.compositions.list",
  "vexa.compositions.inspect",
  "vexa.compositions.validate",
  "vexa.renders.start",
  "vexa.renders.get",
  "vexa.renders.cancel"
] as const);

export type VexaMcpToolName = (typeof VEXA_MCP_TOOL_NAMES)[number];

export type VexaMcpErrorCode =
  | "MCP_TOOL_NOT_FOUND"
  | "MCP_INVALID_INPUT"
  | "MCP_OPERATION_FAILED";

export class VexaMcpError extends Error {
  readonly code: VexaMcpErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: VexaMcpErrorCode, options: { readonly cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface VexaMcpToolDefinition {
  readonly name: VexaMcpToolName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface VexaMcpInspectCompositionInput {
  readonly compositionId: string;
}

export interface VexaMcpValidateCompositionInput extends VexaMcpInspectCompositionInput {
  readonly inputProps?: JsonObject;
}

export interface VexaMcpStartRenderInput {
  readonly payload: HostedCompositionRenderPayload;
  readonly requestOptions?: HostedCompositionRenderRequestOptions;
}

export interface VexaMcpRenderJobInput {
  readonly jobId: string;
}

export type VexaMcpCompositionRuntime = Pick<
  VexaCompositionRenderer,
  "listCompositions" | "inspectComposition" | "resolveComposition"
>;

export type VexaMcpHostedRenderRuntime = Pick<
  HostedRenderer,
  "submitComposition" | "get" | "cancel"
>;

export interface VexaMcpCompositionToolsOptions {
  readonly renderer: VexaMcpCompositionRuntime;
  readonly hostedRenderer: VexaMcpHostedRenderRuntime;
}

export interface VexaMcpToolError {
  readonly code: string;
  readonly message: string;
  readonly compositionId?: string;
  readonly jobId?: string;
}

export type VexaMcpToolCallResult =
  | {
      readonly ok: true;
      readonly tool: VexaMcpToolName;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly tool: string;
      readonly error: VexaMcpToolError;
    };

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  additionalProperties: false
});

const COMPOSITION_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    compositionId: Object.freeze({ type: "string", minLength: 1 })
  }),
  required: Object.freeze(["compositionId"]),
  additionalProperties: false
});

const VALIDATE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    compositionId: Object.freeze({ type: "string", minLength: 1 }),
    inputProps: Object.freeze({ type: "object" })
  }),
  required: Object.freeze(["compositionId"]),
  additionalProperties: false
});

const START_RENDER_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    payload: Object.freeze({ type: "object" }),
    requestOptions: Object.freeze({ type: "object" })
  }),
  required: Object.freeze(["payload"]),
  additionalProperties: false
});

const JOB_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    jobId: Object.freeze({ type: "string", minLength: 1 })
  }),
  required: Object.freeze(["jobId"]),
  additionalProperties: false
});

export const VEXA_MCP_TOOLS: readonly VexaMcpToolDefinition[] = Object.freeze([
  Object.freeze({
    name: "vexa.compositions.list",
    description: "List compositions from the configured Vexa bundle renderer.",
    inputSchema: EMPTY_INPUT_SCHEMA
  }),
  Object.freeze({
    name: "vexa.compositions.inspect",
    description: "Inspect authoritative executable composition defaults and input schema.",
    inputSchema: COMPOSITION_INPUT_SCHEMA
  }),
  Object.freeze({
    name: "vexa.compositions.validate",
    description: "Resolve composition props through Vexa schema, custom validation, and dynamic metadata.",
    inputSchema: VALIDATE_INPUT_SCHEMA
  }),
  Object.freeze({
    name: "vexa.renders.start",
    description: "Submit a typed hosted composition render through the existing HostedRenderer contract.",
    inputSchema: START_RENDER_INPUT_SCHEMA
  }),
  Object.freeze({
    name: "vexa.renders.get",
    description: "Inspect the current state of an existing hosted render job.",
    inputSchema: JOB_INPUT_SCHEMA
  }),
  Object.freeze({
    name: "vexa.renders.cancel",
    description: "Cancel an existing hosted render job through the configured HostedRenderer.",
    inputSchema: JOB_INPUT_SCHEMA
  })
]);

const TOOL_NAME_SET = new Set<string>(VEXA_MCP_TOOL_NAMES);

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new VexaMcpError(`${label} must be a JSON object.`, "MCP_INVALID_INPUT");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new VexaMcpError(`${label} must be a plain JSON object.`, "MCP_INVALID_INPUT");
  }
  return value as Record<string, unknown>;
}

function strictRecord(value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> {
  const record = plainRecord(value, label);
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new VexaMcpError(
      `${label} contains unsupported field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
      "MCP_INVALID_INPUT"
    );
  }
  return record;
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VexaMcpError(`${label} must be a non-empty string.`, "MCP_INVALID_INPUT");
  }
  return value.trim();
}

function parseEmptyInput(input: unknown): void {
  if (input === undefined) return;
  strictRecord(input, [], "tool input");
}

function parseCompositionInput(input: unknown): VexaMcpInspectCompositionInput {
  const record = strictRecord(input, ["compositionId"], "tool input");
  return Object.freeze({ compositionId: nonEmptyText(record.compositionId, "compositionId") });
}

function parseValidateInput(input: unknown): VexaMcpValidateCompositionInput {
  const record = strictRecord(input, ["compositionId", "inputProps"], "tool input");
  const compositionId = nonEmptyText(record.compositionId, "compositionId");
  if (record.inputProps === undefined) return Object.freeze({ compositionId });
  const inputProps = plainRecord(record.inputProps, "inputProps") as JsonObject;
  return Object.freeze({ compositionId, inputProps });
}

function validateTargetShape(value: unknown): void {
  const target = plainRecord(value, "payload.target");
  const kind = nonEmptyText(target.kind, "payload.target.kind");
  switch (kind) {
    case "still":
      strictRecord(target, ["kind", "format"], "payload.target");
      return;
    case "frame":
      strictRecord(target, ["kind", "frame", "format"], "payload.target");
      return;
    case "frame-range":
      strictRecord(target, ["kind", "startFrame", "endFrameExclusive", "format"], "payload.target");
      return;
    case "video":
      strictRecord(target, ["kind", "startFrame", "endFrameExclusive", "container"], "payload.target");
      return;
    default:
      throw new VexaMcpError(
        "payload.target.kind must be still, frame, frame-range, or video.",
        "MCP_INVALID_INPUT"
      );
  }
}

function parseStartRenderInput(input: unknown): VexaMcpStartRenderInput {
  const record = strictRecord(input, ["payload", "requestOptions"], "tool input");
  const payload = strictRecord(
    record.payload,
    ["schemaVersion", "bundle", "compositionId", "target", "inputProps", "output"],
    "payload"
  );
  const bundle = strictRecord(payload.bundle, ["id", "manifest", "integrity"], "payload.bundle");
  nonEmptyText(bundle.id, "payload.bundle.id");
  nonEmptyText(bundle.manifest, "payload.bundle.manifest");
  nonEmptyText(payload.compositionId, "payload.compositionId");
  validateTargetShape(payload.target);
  const output = strictRecord(payload.output, ["artifactId", "destination", "contentType"], "payload.output");
  nonEmptyText(output.artifactId, "payload.output.artifactId");
  if (payload.inputProps !== undefined) plainRecord(payload.inputProps, "payload.inputProps");

  if (record.requestOptions === undefined) {
    return Object.freeze({ payload: payload as unknown as HostedCompositionRenderPayload });
  }
  const requestOptions = strictRecord(
    record.requestOptions,
    ["idempotencyKey", "metadata"],
    "requestOptions"
  );
  if (requestOptions.metadata !== undefined) plainRecord(requestOptions.metadata, "requestOptions.metadata");
  return Object.freeze({
    payload: payload as unknown as HostedCompositionRenderPayload,
    requestOptions: requestOptions as unknown as HostedCompositionRenderRequestOptions
  });
}

function parseJobInput(input: unknown): VexaMcpRenderJobInput {
  const record = strictRecord(input, ["jobId"], "tool input");
  return Object.freeze({ jobId: nonEmptyText(record.jobId, "jobId") });
}

function errorProperty(error: unknown, key: string): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolFailure(
  tool: string,
  error: unknown,
  context: { readonly compositionId?: string; readonly jobId?: string } = {}
): VexaMcpToolCallResult {
  const code = errorProperty(error, "code")
    ?? (error instanceof TypeError ? "MCP_INVALID_INPUT" : "MCP_OPERATION_FAILED");
  const compositionId = errorProperty(error, "compositionId") ?? context.compositionId;
  const jobId = errorProperty(error, "jobId") ?? context.jobId;
  return Object.freeze({
    ok: false,
    tool,
    error: Object.freeze({
      code,
      message: errorMessage(error),
      ...(compositionId ? { compositionId } : {}),
      ...(jobId ? { jobId } : {})
    })
  });
}

export class VexaMcpCompositionTools {
  readonly #renderer: VexaMcpCompositionRuntime;
  readonly #hostedRenderer: VexaMcpHostedRenderRuntime;

  constructor(options: VexaMcpCompositionToolsOptions) {
    if (!options?.renderer) throw new TypeError("VexaMcpCompositionTools requires a renderer.");
    if (!options?.hostedRenderer) throw new TypeError("VexaMcpCompositionTools requires a hostedRenderer.");
    this.#renderer = options.renderer;
    this.#hostedRenderer = options.hostedRenderer;
  }

  listTools(): readonly VexaMcpToolDefinition[] {
    return VEXA_MCP_TOOLS;
  }

  listCompositions(): ReturnType<VexaCompositionRenderer["listCompositions"]> {
    return this.#renderer.listCompositions();
  }

  inspectComposition(input: VexaMcpInspectCompositionInput): Promise<ProgrammableCompositionStaticMetadata> {
    return this.#renderer.inspectComposition(nonEmptyText(input.compositionId, "compositionId"));
  }

  validateComposition(input: VexaMcpValidateCompositionInput): Promise<ResolvedProgrammableComposition> {
    const compositionId = nonEmptyText(input.compositionId, "compositionId");
    return input.inputProps === undefined
      ? this.#renderer.resolveComposition(compositionId)
      : this.#renderer.resolveComposition(compositionId, input.inputProps);
  }

  startRender<TResult = unknown>(input: VexaMcpStartRenderInput): Promise<HostedRenderJob<TResult>> {
    return this.#hostedRenderer.submitComposition<TResult>(input.payload, input.requestOptions ?? {});
  }

  getRender<TResult = unknown>(input: VexaMcpRenderJobInput): Promise<HostedRenderJob<TResult>> {
    return this.#hostedRenderer.get<TResult>(nonEmptyText(input.jobId, "jobId"));
  }

  cancelRender<TResult = unknown>(input: VexaMcpRenderJobInput): Promise<HostedRenderJob<TResult>> {
    return this.#hostedRenderer.cancel<TResult>(nonEmptyText(input.jobId, "jobId"));
  }

  async callTool(tool: string, input?: unknown): Promise<VexaMcpToolCallResult> {
    if (!TOOL_NAME_SET.has(tool)) {
      return toolFailure(
        tool,
        new VexaMcpError(`Unknown Vexa MCP tool: ${tool}`, "MCP_TOOL_NOT_FOUND")
      );
    }

    const name = tool as VexaMcpToolName;
    let compositionId: string | undefined;
    let jobId: string | undefined;
    try {
      switch (name) {
        case "vexa.compositions.list":
          parseEmptyInput(input);
          return Object.freeze({ ok: true, tool: name, value: this.listCompositions() });
        case "vexa.compositions.inspect": {
          const parsed = parseCompositionInput(input);
          compositionId = parsed.compositionId;
          return Object.freeze({ ok: true, tool: name, value: await this.inspectComposition(parsed) });
        }
        case "vexa.compositions.validate": {
          const parsed = parseValidateInput(input);
          compositionId = parsed.compositionId;
          return Object.freeze({ ok: true, tool: name, value: await this.validateComposition(parsed) });
        }
        case "vexa.renders.start": {
          const parsed = parseStartRenderInput(input);
          compositionId = parsed.payload.compositionId;
          return Object.freeze({ ok: true, tool: name, value: await this.startRender(parsed) });
        }
        case "vexa.renders.get": {
          const parsed = parseJobInput(input);
          jobId = parsed.jobId;
          return Object.freeze({ ok: true, tool: name, value: await this.getRender(parsed) });
        }
        case "vexa.renders.cancel": {
          const parsed = parseJobInput(input);
          jobId = parsed.jobId;
          return Object.freeze({ ok: true, tool: name, value: await this.cancelRender(parsed) });
        }
      }
    } catch (error) {
      return toolFailure(name, error, {
        ...(compositionId ? { compositionId } : {}),
        ...(jobId ? { jobId } : {})
      });
    }
  }
}

export type VexaMcpRenderer = VexaCompositionRenderer;
export type VexaMcpHostedRenderer = HostedRenderer;

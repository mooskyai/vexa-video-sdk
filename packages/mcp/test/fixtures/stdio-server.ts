import type {
  HostedCompositionRenderPayload,
  HostedRenderJob,
  JsonObject,
  ProgrammableCompositionStaticMetadata,
  ResolvedProgrammableComposition
} from "@vexa-video/core";
import {
  VexaMcpCompositionTools,
  type VexaMcpCompositionRuntime,
  type VexaMcpHostedRenderRuntime
} from "../../src/index.js";
import { serveVexaMcpStdio } from "../../src/stdio.js";

const renderer: VexaMcpCompositionRuntime = {
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
  },
  async inspectComposition(id: string): Promise<ProgrammableCompositionStaticMetadata> {
    return Object.freeze({
      schemaVersion: 1,
      kind: "video" as const,
      id,
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 120,
      defaultProps: Object.freeze({})
    });
  },
  async resolveComposition(id: string, inputProps?: JsonObject): Promise<ResolvedProgrammableComposition> {
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
      props: Object.freeze({ ...(inputProps ?? {}) })
    });
  }
};

const hostedRenderer: VexaMcpHostedRenderRuntime = {
  async submitComposition<TResult = unknown>(
    payload: HostedCompositionRenderPayload
  ): Promise<HostedRenderJob<TResult>> {
    return {
      id: `job-${payload.output.artifactId}`,
      state: "queued"
    } as HostedRenderJob<TResult>;
  },
  async get<TResult = unknown>(jobId: string): Promise<HostedRenderJob<TResult>> {
    return {
      id: jobId,
      state: "running",
      progress: { percent: 50, phase: "render" }
    } as HostedRenderJob<TResult>;
  },
  async cancel<TResult = unknown>(jobId: string): Promise<HostedRenderJob<TResult>> {
    return { id: jobId, state: "cancelled" } as HostedRenderJob<TResult>;
  }
};

await serveVexaMcpStdio(
  new VexaMcpCompositionTools({ renderer, hostedRenderer }),
  { name: "vexa-stdio-fixture", version: "1.0.0" }
);

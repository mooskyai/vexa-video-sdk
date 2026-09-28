import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { ExportOptions, VideoOperation } from "@moosky-video/core";
import { JobQueue, Video, VideoSdkError } from "@moosky-video/sdk";

const host = process.env.VEXA_REST_HOST ?? "127.0.0.1";
const port = Number(process.env.VEXA_REST_PORT ?? "4190");
const concurrency = Number(process.env.VEXA_WORKER_CONCURRENCY ?? "2");
const workspace = resolve(process.env.VEXA_REST_WORKSPACE ?? ".tmp/rest-service");
const maxUploadBytes = Number(process.env.VEXA_MAX_UPLOAD_BYTES ?? String(2 * 1024 * 1024 * 1024));

interface MediaRecord {
  id: string;
  name: string;
  path: string;
  contentType?: string;
}

interface RenderPayload {
  mediaId: string;
  operations?: readonly VideoOperation[];
  outputFormat?: "mp4" | "webm";
  export?: Omit<ExportOptions, "signal" | "onProgress">;
}

const media = new Map<string, MediaRecord>();
const jobs = new JobQueue({ concurrency, workerId: `rest-service-${process.pid}` });

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-vexa-file-name,authorization,idempotency-key");
  res.setHeader("cache-control", "no-store");
}

function json(res: ServerResponse, status: number, value: unknown): void {
  cors(res);
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 1024 * 1024) throw new Error("JSON body exceeded 1 MiB.");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 180) || "media.bin";
}

function recordOf(id: string): MediaRecord {
  const value = media.get(id);
  if (!value) throw new Error(`Media asset was not found: ${id}`);
  return value;
}

async function upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await mkdir(workspace, { recursive: true });
  const id = randomUUID();
  const original = safeName(String(req.headers["x-vexa-file-name"] ?? "media.bin"));
  const extension = extname(original).slice(0, 12) || ".bin";
  const path = join(workspace, `${id}${extension}`);
  let bytes = 0;
  req.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxUploadBytes) req.destroy(new Error("Upload exceeded configured size limit."));
  });
  await pipeline(req, createWriteStream(path, { flags: "wx" }));
  const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined;
  const record: MediaRecord = { id, name: original, path, ...(contentType ? { contentType } : {}) };
  media.set(id, record);
  const info = await stat(path);
  const metadata = await Video.load(path).probe().catch(() => undefined);
  json(res, 201, {
    id,
    name: original,
    sizeBytes: info.size,
    url: `/v1/media/${encodeURIComponent(id)}/${encodeURIComponent(original)}`,
    ...(contentType ? { contentType } : {}),
    ...(metadata ? { metadata } : {})
  });
}

async function serveFile(res: ServerResponse, path: string, contentType = "application/octet-stream"): Promise<void> {
  const info = await stat(path);
  cors(res);
  res.writeHead(200, { "content-type": contentType, "content-length": info.size });
  await pipeline(createReadStream(path), res);
}

jobs.register<RenderPayload, { outputName: string; outputUrl: string; metadata: unknown }>(
  "video.render",
  async (payload, context) => {
    const source = recordOf(payload.mediaId);
    const extension = payload.outputFormat === "webm" ? ".webm" : ".mp4";
    const outputName = `render-${context.job.descriptor.id}${extension}`;
    const output = join(workspace, outputName);
    const video = Video.fromPipeline({
      schemaVersion: 1,
      source: source.path,
      operations: payload.operations ?? []
    });
    await video.export(output, {
      overwrite: true,
      ...(payload.export ?? {}),
      signal: context.signal,
      onProgress(progress) {
        void context.reportProgress({
          ...(progress.percent !== null ? { percent: progress.percent } : {}),
          phase: "render"
        });
      }
    });
    const metadata = await Video.load(output).probe();
    return {
      outputName,
      outputUrl: `/v1/outputs/${encodeURIComponent(outputName)}`,
      metadata
    };
  }
);

function errorStatus(error: unknown): number {
  if (error instanceof VideoSdkError) {
    if (error.code === "JOB_NOT_FOUND") return 404;
    if (error.code === "JOB_IDEMPOTENCY_CONFLICT") return 409;
    return 400;
  }
  return 400;
}

const server = createServer(async (req, res) => {
  try {
    cors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        name: "Vexa REST Service",
        status: "ok",
        endpoints: ["GET /health", "POST /v1/media", "POST /v1/jobs", "GET /v1/jobs/:id", "DELETE /v1/jobs/:id"]
      });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { status: "ok", service: "vexa-rest-service", version: 1, concurrency });
    }
    if (req.method === "POST" && url.pathname === "/v1/media") return await upload(req, res);

    const mediaMatch = /^\/v1\/media\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (req.method === "GET" && mediaMatch) {
      const record = recordOf(decodeURIComponent(mediaMatch[1]!));
      return await serveFile(res, record.path, record.contentType);
    }

    if (req.method === "POST" && url.pathname === "/v1/jobs") {
      const body = await readJson(req) as { type?: string; payload?: RenderPayload; retry?: { maxAttempts?: number }; idempotencyKey?: string };
      if (body.type !== "video.render" || !body.payload) throw new Error("This template currently accepts type=video.render.");
      const idempotencyKey = body.idempotencyKey ?? (typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined);
      const handle = jobs.submit("video.render", body.payload, {
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(body.retry ? { retry: body.retry } : {})
      });
      return json(res, 202, handle.snapshot());
    }

    const jobMatch = /^\/v1\/jobs\/([^/]+)$/u.exec(url.pathname);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]!);
      if (req.method === "GET") return json(res, 200, jobs.get(jobId));
      if (req.method === "DELETE") {
        jobs.cancel(jobId);
        return json(res, 202, jobs.get(jobId));
      }
    }

    const outputMatch = /^\/v1\/outputs\/([^/]+)$/u.exec(url.pathname);
    if (req.method === "GET" && outputMatch) {
      const name = safeName(decodeURIComponent(outputMatch[1]!));
      return await serveFile(res, join(workspace, name), name.endsWith(".webm") ? "video/webm" : "video/mp4");
    }

    return json(res, 404, { error: "Route not found." });
  } catch (error) {
    return json(res, errorStatus(error), {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof VideoSdkError ? { code: error.code } : {})
    });
  }
});

await mkdir(workspace, { recursive: true });
server.listen(port, host, () => {
  console.log(`[vexa-rest-service] http://${host}:${port}`);
  console.log(`[vexa-rest-service] worker concurrency ${concurrency}`);
});

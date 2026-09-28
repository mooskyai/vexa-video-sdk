import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { ExportOptions, ProjectRenderOptions, VideoOperation, VideoProjectAst } from "@vexa-video/core";
import { JobQueue, Video, VideoProject, VideoSdkError } from "@vexa-video/sdk";

const host = process.env.VEXA_ANGULAR_HOST ?? "127.0.0.1";
const port = Number(process.env.VEXA_ANGULAR_PORT ?? "4180");
const workspace = resolve(process.cwd(), ".tmp/angular-render-service");
const maxUploadBytes = 2 * 1024 * 1024 * 1024;

interface MediaRecord {
  id: string;
  name: string;
  path: string;
  contentType?: string;
}

interface BrowserExportOptions {
  videoCodec?: "h264" | "h265" | "av1" | "vp9" | "copy";
  audioCodec?: "aac" | "opus" | "mp3" | "copy" | "none";
  crf?: number;
  preset?: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow";
  pixelFormat?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  hardwareAcceleration?: "auto" | "cpu" | "nvidia" | "intel" | "amd" | "apple";
  hardwareFallback?: boolean;
}

interface VideoRenderPayload {
  mediaId: string;
  operations?: readonly VideoOperation[];
  outputFormat?: "mp4" | "webm";
  export?: BrowserExportOptions;
}

interface ProjectRenderPayload {
  project: VideoProjectAst;
  media: Readonly<Record<string, string>>;
  outputFormat?: "mp4" | "webm";
  export?: BrowserExportOptions;
}

const media = new Map<string, MediaRecord>();
const jobs = new JobQueue({ concurrency: 2, workerId: "angular-render-service" });

function safeName(value: string): string {
  const decoded = decodeURIComponent(value || "media.bin");
  const normalized = decoded.replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 180);
  return normalized || "media.bin";
}

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-vexa-file-name,authorization");
  res.setHeader("cache-control", "no-store");
}

function json(res: ServerResponse, status: number, value: unknown): void {
  cors(res);
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function html(res: ServerResponse, status: number, body: string): void {
  cors(res);
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function serviceLandingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vexa Angular Render Service</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #e7edf7; }
    main { max-width: 880px; margin: 0 auto; padding: 48px 24px 72px; }
    h1 { font-size: clamp(30px, 5vw, 48px); margin: 0 0 12px; }
    p { color: #aab8cf; line-height: 1.65; }
    .ok { display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 999px; background: #153824; color: #8ff0b4; font-weight: 700; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
    section { margin-top: 30px; padding: 20px; border: 1px solid #26344f; border-radius: 12px; background: #11192b; }
    code { color: #9fc3ff; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 9px 6px; border-bottom: 1px solid #23314a; vertical-align: top; }
    td:first-child { white-space: nowrap; width: 190px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: #9fc3ff; }
    a { color: #7db2ff; }
  </style>
</head>
<body>
<main>
  <div class="ok"><span class="dot"></span>Service running</div>
  <h1>Vexa Angular Render Service</h1>
  <p>This is the Node render API used by <code>@vexa-video/angular</code>. It is not the Angular application itself. Run the Angular client separately and configure its <code>baseUrl</code> to this service.</p>
  <section>
    <h2>API endpoints</h2>
    <table>
      <tr><td>GET /health</td><td>Service health and runtime information.</td></tr>
      <tr><td>POST /v1/media</td><td>Upload browser media using the raw request body and <code>x-vexa-file-name</code>.</td></tr>
      <tr><td>POST /v1/jobs</td><td>Submit <code>video.render</code> or <code>project.render</code> work.</td></tr>
      <tr><td>GET /v1/jobs/:id</td><td>Read a job snapshot and progress.</td></tr>
      <tr><td>DELETE /v1/jobs/:id</td><td>Request cancellation.</td></tr>
      <tr><td>GET /v1/media/:id/:name</td><td>Serve uploaded media.</td></tr>
      <tr><td>GET /v1/outputs/:name</td><td>Serve completed render output.</td></tr>
    </table>
  </section>
  <section>
    <h2>Quick check</h2>
    <p>Open <a href="/health"><code>/health</code></a> to verify the JSON API is responsive.</p>
  </section>
</main>
</body>
</html>`;
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.length;
    if (total > 1024 * 1024) throw new Error("JSON body is too large.");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function mediaUrl(id: string, name: string): string {
  return `/v1/media/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
}

function recordOf(id: string): MediaRecord {
  const record = media.get(id);
  if (!record) throw new Error(`Media asset was not found: ${id}`);
  return record;
}

function videoExportOptions(
  options: BrowserExportOptions | undefined,
  signal: AbortSignal,
  onProgress: (value: any) => void
): ExportOptions {
  return { overwrite: true, ...(options ?? {}), signal, onProgress };
}

function projectExportOptions(
  options: BrowserExportOptions | undefined,
  signal: AbortSignal,
  onProgress: (value: any) => void
): ProjectRenderOptions {
  const value: ProjectRenderOptions = { overwrite: true, signal, onProgress };
  if (options?.videoCodec && options.videoCodec !== "copy") value.videoCodec = options.videoCodec;
  if (options?.audioCodec && options.audioCodec !== "copy") value.audioCodec = options.audioCodec;
  if (options?.crf !== undefined) value.crf = options.crf;
  if (options?.preset) value.preset = options.preset;
  if (options?.pixelFormat) value.pixelFormat = options.pixelFormat;
  if (options?.videoBitrate) value.videoBitrate = options.videoBitrate;
  if (options?.audioBitrate) value.audioBitrate = options.audioBitrate;
  if (options?.hardwareAcceleration) value.hardwareAcceleration = options.hardwareAcceleration;
  if (options?.hardwareFallback !== undefined) value.hardwareFallback = options.hardwareFallback;
  return value;
}

function translatedProject(project: VideoProjectAst, sourceMap: Readonly<Record<string, string>>): VideoProjectAst {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (clip.kind === "text") return clip;
        const mediaId = sourceMap[clip.source];
        if (!mediaId) throw new Error(`No uploaded media mapping was provided for project source: ${clip.source}`);
        return { ...clip, source: recordOf(mediaId).path };
      })
    }))
  };
}

jobs.register<VideoRenderPayload, { outputName: string; outputUrl: string; metadata: unknown }>(
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
    await video.export(output, videoExportOptions(payload.export, context.signal, (progress) => {
      void context.reportProgress({
        ...(progress.percent != null ? { percent: progress.percent } : {}),
        phase: "render"
      });
    }));
    const metadata = await Video.load(output).probe();
    return { outputName, outputUrl: `/v1/outputs/${encodeURIComponent(outputName)}`, metadata };
  }
);

jobs.register<ProjectRenderPayload, { outputName: string; outputUrl: string; metadata: unknown }>(
  "project.render",
  async (payload, context) => {
    const extension = payload.outputFormat === "webm" ? ".webm" : ".mp4";
    const outputName = `project-${context.job.descriptor.id}${extension}`;
    const output = join(workspace, outputName);
    const project = VideoProject.fromAst(translatedProject(payload.project, payload.media));
    await project.render(output, projectExportOptions(payload.export, context.signal, (progress) => {
      void context.reportProgress({
        ...(progress.percent != null ? { percent: progress.percent } : {}),
        phase: "project-render"
      });
    }));
    const metadata = await Video.load(output).probe();
    return { outputName, outputUrl: `/v1/outputs/${encodeURIComponent(outputName)}`, metadata };
  }
);

async function upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const id = randomUUID();
  const name = safeName(String(req.headers["x-vexa-file-name"] ?? "media.bin"));
  const extension = extname(name).slice(0, 12);
  const path = join(workspace, `${id}${extension || ".bin"}`);
  await mkdir(workspace, { recursive: true });
  let bytes = 0;
  req.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxUploadBytes) req.destroy(new Error("Upload exceeded the 2 GiB example limit."));
  });
  await pipeline(req, createWriteStream(path, { flags: "wx" }));
  const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined;
  const record: MediaRecord = { id, name, path, ...(contentType ? { contentType } : {}) };
  media.set(id, record);
  const metadata = await Video.load(path).probe().catch(() => undefined);
  const file = await stat(path);
  json(res, 201, {
    id,
    name,
    sizeBytes: file.size,
    ...(contentType ? { contentType } : {}),
    url: mediaUrl(id, name),
    ...(metadata ? { metadata } : {})
  });
}

async function serveFile(res: ServerResponse, path: string, contentType = "application/octet-stream"): Promise<void> {
  const info = await stat(path);
  cors(res);
  res.writeHead(200, { "content-type": contentType, "content-length": info.size });
  await pipeline(createReadStream(path), res);
}

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
      return html(res, 200, serviceLandingPage());
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        status: "ok",
        service: "vexa-angular-render-service",
        version: 1,
        uptimeSeconds: Math.floor(process.uptime())
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/media") return await upload(req, res);

    const mediaMatch = /^\/v1\/media\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (req.method === "GET" && mediaMatch) {
      const record = recordOf(decodeURIComponent(mediaMatch[1]!));
      return await serveFile(res, record.path, record.contentType ?? "application/octet-stream");
    }

    const outputMatch = /^\/v1\/outputs\/([^/]+)$/u.exec(url.pathname);
    if (req.method === "GET" && outputMatch) {
      const name = safeName(outputMatch[1]!);
      const path = resolve(workspace, name);
      if (!path.startsWith(`${workspace}${sep}`)) throw new Error("Invalid output path.");
      return await serveFile(res, path, name.endsWith(".webm") ? "video/webm" : "video/mp4");
    }

    if (req.method === "POST" && url.pathname === "/v1/jobs") {
      const body = await readJson(req);
      const handle = jobs.submit(body.type, body.payload, body.options ?? {});
      return json(res, 202, { job: jobs.get(handle.id) });
    }

    const jobMatch = /^\/v1\/jobs\/([a-f0-9-]+)$/iu.exec(url.pathname);
    if (jobMatch && req.method === "GET") return json(res, 200, { job: jobs.get(jobMatch[1]!) });
    if (jobMatch && req.method === "DELETE") {
      jobs.cancel(jobMatch[1]!);
      return json(res, 200, { job: jobs.get(jobMatch[1]!) });
    }

    return json(res, 404, { error: "Route not found.", code: "NOT_FOUND" });
  } catch (error) {
    json(res, errorStatus(error), {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof VideoSdkError ? { code: error.code } : { code: "EXAMPLE_ERROR" })
    });
  }
});

await mkdir(workspace, { recursive: true });
server.listen(port, host, () => {
  console.log(`[angular-render-service] http://${host}:${port}`);
});

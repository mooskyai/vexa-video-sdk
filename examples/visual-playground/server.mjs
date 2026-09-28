import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Audio, Captions, Hardware, JobQueue, Storage, Streaming, Video, VideoProject, VideoSdkError } from "../../packages/sdk/dist/index.js";

const host = "127.0.0.1";
const port = Number(process.env.VEXA_PLAYGROUND_PORT ?? "4173");
const exampleDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(exampleDir, "public");
const workspaceRoot = resolve(exampleDir, "../../.tmp/visual-playground");
const maxUploadBytes = 2 * 1024 * 1024 * 1024;
const remoteStorage = new Storage({
  workspaceRoot,
  http: {
    maxBytes: maxUploadBytes,
    maxRedirects: 5,
    allowHttp: false,
    allowPrivateNetwork: false,
    timeoutMs: 60_000
  }
});

const playgroundJobs = new JobQueue({ concurrency: 2, workerId: "playground-local" });
playgroundJobs.register("video.render", executeQueuedVideoRender, {
  retryable(error) {
    if (!(error instanceof VideoSdkError)) return true;
    return ["PROCESS_FAILED", "PROCESS_TIMEOUT"].includes(error.code);
  }
});

function json(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorPayload(error) {
  if (error instanceof VideoSdkError) {
    return { error: error.message, code: error.code };
  }
  return { error: messageOf(error), code: "PLAYGROUND_ERROR" };
}

function errorStatus(error) {
  if (!(error instanceof VideoSdkError)) return 500;
  if (error.code === "REMOTE_MEDIA_REJECTED") return 403;
  if (error.code === "STORAGE_TRANSFER_FAILED") return 502;
  if (error.code === "JOB_NOT_FOUND") return 404;
  if (error.code === "JOB_QUEUE_CLOSED") return 503;
  if ([
    "INVALID_STORAGE",
    "STORAGE_ADAPTER_NOT_FOUND",
    "INVALID_MEDIA_SOURCE",
    "INVALID_OPERATION",
    "INVALID_PROJECT",
    "INVALID_STREAMING",
    "INVALID_CAPTION",
    "INCOMPATIBLE_OUTPUT",
    "HARDWARE_ACCELERATION_UNAVAILABLE",
    "INVALID_JOB",
    "JOB_IDEMPOTENCY_CONFLICT"
  ].includes(error.code)) return 400;
  return 500;
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new Error("JSON request is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeExtension(name) {
  const extension = extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/u.test(extension) ? extension : ".bin";
}

function mediaUrl(sessionId, name) {
  return `/media/${sessionId}/${encodeURIComponent(name)}`;
}

function packageUrl(sessionId, directoryName, relativePath) {
  const encoded = String(relativePath).split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/package/${sessionId}/${encodeURIComponent(directoryName)}/${encoded}`;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function getSession(id) {
  if (!id) throw new Error("sessionId is required.");
  if (!/^[a-f0-9-]{36}$/iu.test(id)) throw new Error("Invalid video session id.");

  const directory = resolve(workspaceRoot, id);
  if (!directory.startsWith(`${workspaceRoot}${sep}`)) throw new Error("Invalid video session path.");

  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    throw new Error("Video session was not found. Upload the video again.");
  }

  const inputName = entries.find((entry) => entry.startsWith("input."));
  if (!inputName) throw new Error("Video session source was not found. Upload the video again.");

  return { id, directory, input: join(directory, inputName), inputName };
}

function safeSessionFile(session, name) {
  if (!name || name !== basename(name)) throw new Error("Invalid media filename.");
  const path = resolve(session.directory, name);
  if (!path.startsWith(`${session.directory}${sep}`)) throw new Error("Invalid media path.");
  return path;
}

function detectAssetKind(name, metadata) {
  const extension = extname(name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extension)) return "image";
  if (metadata.video) return "video";
  if (metadata.audio) return "audio";
  return "unknown";
}

function isBrowserLikelyPlayable(name, metadata, kind = detectAssetKind(name, metadata)) {
  const extension = extname(name).toLowerCase();
  if (kind === "image") return true;
  if (kind === "audio") {
    return [".m4a", ".mp3", ".opus", ".ogg", ".wav", ".aac"].includes(extension);
  }
  const videoCodec = metadata.video?.codec?.toLowerCase() ?? null;
  const audioCodec = metadata.audio?.codec?.toLowerCase() ?? null;
  const audioOkayForMp4 = audioCodec === null || audioCodec === "aac" || audioCodec === "mp3";
  const audioOkayForWebm = audioCodec === null || audioCodec === "opus" || audioCodec === "vorbis";

  if ([".mp4", ".m4v"].includes(extension)) {
    return videoCodec === "h264" && audioOkayForMp4;
  }

  if (extension === ".webm") {
    return ["vp8", "vp9"].includes(videoCodec ?? "") && audioOkayForWebm;
  }

  return false;
}

async function createBrowserPreview(input, output) {
  if (await fileExists(output)) return;

  await Video.load(input).export(output, {
    overwrite: true,
    videoCodec: "h264",
    audioCodec: "aac",
    crf: 28,
    preset: "veryfast",
    pixelFormat: "yuv420p",
    timeoutMs: 30 * 60 * 1000
  });
}

async function ensureBrowserPreview(session, input, key) {
  const safeKey = key.replace(/[^a-z0-9_-]/giu, "-").slice(0, 80) || "media";
  const previewName = `${safeKey}-browser-preview.mp4`;
  const preview = join(session.directory, previewName);
  await createBrowserPreview(input, preview);
  return { name: previewName, url: mediaUrl(session.id, previewName) };
}


function buildExportOptions(payload, extra = {}) {
  return {
    overwrite: true,
    ...(payload.export?.videoCodec ? { videoCodec: payload.export.videoCodec } : {}),
    ...(payload.export?.audioCodec ? { audioCodec: payload.export.audioCodec } : {}),
    ...(payload.export?.crf !== undefined && payload.export.crf !== null ? { crf: payload.export.crf } : {}),
    ...(payload.export?.preset ? { preset: payload.export.preset } : {}),
    ...(payload.export?.pixelFormat ? { pixelFormat: payload.export.pixelFormat } : {}),
    ...(payload.export?.videoBitrate ? { videoBitrate: payload.export.videoBitrate } : {}),
    ...(payload.export?.audioBitrate ? { audioBitrate: payload.export.audioBitrate } : {}),
    ...(payload.export?.hardwareAcceleration ? { hardwareAcceleration: payload.export.hardwareAcceleration } : {}),
    ...(payload.export?.hardwareFallback !== undefined ? { hardwareFallback: payload.export.hardwareFallback } : {}),
    ...extra
  };
}

function buildVideo(session, payload) {
  let video = Video.load(session.input);

  if (payload.trim?.enabled) {
    video = video.trim({
      start: payload.trim.start ?? 0,
      ...(payload.trim.duration !== undefined && payload.trim.duration !== null
        ? { duration: payload.trim.duration }
        : {})
    });
  }

  if (payload.resize?.enabled) {
    video = video.resize({
      width: payload.resize.width ?? 1280,
      height: payload.resize.height ?? 720,
      ...(payload.resize.fit ? { fit: payload.resize.fit } : {})
    });
  }

  if (payload.crop?.enabled) {
    video = video.crop({
      width: payload.crop.width ?? 720,
      height: payload.crop.height ?? 720,
      ...(payload.crop.x !== undefined && payload.crop.x !== null ? { x: payload.crop.x } : {}),
      ...(payload.crop.y !== undefined && payload.crop.y !== null ? { y: payload.crop.y } : {})
    });
  }

  if (payload.rotate?.enabled) {
    video = video.rotate({ degrees: payload.rotate.degrees ?? 0 });
  }

  return video;
}

async function describeImportedSession(id, directory, input, inputName, originalName) {
  const metadata = await Video.load(input).probe({ timeoutMs: 20_000 });
  const session = { id, directory, input, inputName };
  const sourceUrl = mediaUrl(id, inputName);
  const assetKind = detectAssetKind(originalName, metadata);

  let playbackUrl = sourceUrl;
  let previewGenerated = false;
  if (assetKind === "video" && !isBrowserLikelyPlayable(originalName, metadata, assetKind)) {
    const preview = await ensureBrowserPreview(session, input, "source");
    playbackUrl = preview.url;
    previewGenerated = true;
  }

  return {
    sessionId: id,
    originalName,
    assetKind,
    sourceUrl,
    playbackUrl,
    previewGenerated,
    metadata
  };
}

async function handleUpload(req, res) {
  const originalName = decodeURIComponent(String(req.headers["x-vexa-filename"] ?? "input.bin"));
  const length = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(length) && length > maxUploadBytes) {
    json(res, 413, { error: "Upload exceeds the 2 GB local playground limit." });
    return;
  }

  const id = randomUUID();
  const directory = join(workspaceRoot, id);
  await mkdir(directory, { recursive: true });
  const inputName = `input${safeExtension(originalName)}`;
  const input = join(directory, inputName);
  let received = 0;

  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxUploadBytes) {
        callback(new Error("Upload exceeds the 2 GB local playground limit."));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(req, limiter, createWriteStream(input));
    json(res, 201, await describeImportedSession(id, directory, input, inputName, originalName));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function handleRemoteImport(req, res) {
  const payload = await readJson(req);
  const remoteUrl = String(payload.url ?? "").trim();
  if (!remoteUrl) throw new Error("Remote media URL is required.");

  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new Error("Remote media URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("The playground accepts public HTTPS media URLs only.");
  }

  const originalName = basename(decodeURIComponent(parsed.pathname)) || "remote-media.bin";
  const id = randomUUID();
  const directory = join(workspaceRoot, id);
  await mkdir(directory, { recursive: true });
  const inputName = `input${safeExtension(originalName)}`;
  const input = join(directory, inputName);

  try {
    await remoteStorage.download(remoteUrl, input, {
      overwrite: true,
      maxBytes: maxUploadBytes
    });
    json(res, 201, await describeImportedSession(id, directory, input, inputName, originalName));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function handlePreview(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const requestedName = payload.name ? String(payload.name) : session.inputName;
  const input = requestedName === session.inputName
    ? session.input
    : safeSessionFile(session, requestedName);

  if (!(await fileExists(input))) throw new Error("Media file for preview was not found.");

  const preview = await ensureBrowserPreview(
    session,
    input,
    requestedName === session.inputName ? "source" : `preview-${requestedName}`
  );

  json(res, 200, { playbackUrl: preview.url });
}

async function handlePlan(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
  const output = join(session.directory, `plan-preview.${outputFormat}`);
  const video = buildVideo(session, payload);
  const plan = await video.planExport(output, buildExportOptions(payload));
  json(res, 200, { plan });
}

async function executeQueuedVideoRender(payload, context) {
  const session = await getSession(payload.sessionId);
  const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
  const outputName = `job-render-${context.job.descriptor.id}.${outputFormat}`;
  const output = join(session.directory, outputName);

  try {
    const video = buildVideo(session, payload);
    await context.reportProgress({ percent: 0, phase: "render", message: "Starting FFmpeg render" });
    await video.export(
      output,
      buildExportOptions(payload, {
        signal: context.signal,
        onProgress(progress) {
          void context.reportProgress({
            ...(progress.percent != null ? { percent: progress.percent } : {}),
            phase: "render",
            message: `${progress.processedSeconds.toFixed(1)}s · ${progress.speed ?? "?"}x`,
            data: progress
          });
        }
      })
    );

    const metadata = await Video.load(output).probe({ timeoutMs: 20_000 });
    const url = mediaUrl(session.id, outputName);
    let playbackUrl = url;
    let previewGenerated = false;

    if (!isBrowserLikelyPlayable(outputName, metadata)) {
      const preview = await ensureBrowserPreview(session, output, `job-${context.job.descriptor.id}`);
      playbackUrl = preview.url;
      previewGenerated = true;
    }

    return {
      name: outputName,
      url,
      playbackUrl,
      previewGenerated,
      metadata
    };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

async function handleJobSubmit(req, res) {
  const body = await readJson(req);
  const render = body.render ?? body;
  if (!render?.sessionId) throw new Error("A render payload with sessionId is required.");
  const maxAttempts = Number(body.maxAttempts ?? 1);
  const handle = playgroundJobs.submit("video.render", render, {
    ...(String(body.idempotencyKey ?? "").trim() ? { idempotencyKey: String(body.idempotencyKey).trim() } : {}),
    retry: {
      maxAttempts: Number.isInteger(maxAttempts) ? maxAttempts : 1,
      backoffMs: 500,
      backoffMultiplier: 2,
      maxBackoffMs: 5_000
    },
    metadata: { source: "visual-playground" }
  });
  json(res, 202, { job: handle.snapshot() });
}

async function handleJobGet(_req, res, jobId) {
  json(res, 200, { job: playgroundJobs.get(jobId) });
}

async function handleJobCancel(_req, res, jobId) {
  playgroundJobs.cancel(jobId);
  json(res, 200, { job: playgroundJobs.get(jobId) });
}

async function handleJobList(_req, res) {
  const jobs = playgroundJobs.list().slice(-25).reverse();
  json(res, 200, { jobs });
}

async function handleRender(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
  const outputName = `render-${Date.now()}.${outputFormat}`;
  const output = join(session.directory, outputName);
  const controller = new AbortController();

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });

  const write = (value) => {
    if (!res.destroyed) res.write(`${JSON.stringify(value)}\n`);
  };

  const abortIfDisconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", abortIfDisconnected);

  try {
    const video = buildVideo(session, payload);
    write({ type: "start", output: outputName });

    await video.export(
      output,
      buildExportOptions(payload, {
        signal: controller.signal,
        onProgress(progress) {
          write({ type: "progress", progress });
        }
      })
    );

    const metadata = await Video.load(output).probe({ timeoutMs: 20_000 });
    const url = mediaUrl(session.id, outputName);
    let playbackUrl = url;
    let previewGenerated = false;

    if (!isBrowserLikelyPlayable(outputName, metadata)) {
      const preview = await ensureBrowserPreview(session, output, `render-${Date.now()}`);
      playbackUrl = preview.url;
      previewGenerated = true;
    }

    write({
      type: "complete",
      name: outputName,
      url,
      playbackUrl,
      previewGenerated,
      metadata
    });
  } catch (error) {
    await rm(output, { force: true });
    write({ type: "error", ...errorPayload(error) });
  } finally {
    res.off("close", abortIfDisconnected);
    if (!res.writableEnded) res.end();
  }
}

async function handleThumbnail(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const outputName = `thumbnail-${Date.now()}.jpg`;
  const output = join(session.directory, outputName);
  const video = buildVideo(session, payload);

  await video.thumbnail(output, {
    overwrite: true,
    ...(payload.at !== undefined ? { at: payload.at } : {}),
    ...(payload.quality !== undefined ? { quality: payload.quality } : {})
  });

  json(res, 200, { name: outputName, url: mediaUrl(session.id, outputName) });
}

async function handleAudio(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const codec = payload.codec ?? "aac";
  const extension = codec === "mp3" ? "mp3" : codec === "opus" ? "opus" : codec === "copy" ? "mka" : "m4a";
  const outputName = `audio-${Date.now()}.${extension}`;
  const output = join(session.directory, outputName);
  const video = buildVideo(session, payload);

  await video.extractAudio(output, {
    overwrite: true,
    codec,
    ...(payload.bitrate ? { bitrate: payload.bitrate } : {})
  });

  json(res, 200, { name: outputName, url: mediaUrl(session.id, outputName) });
}

function buildAudioPipeline(session, payload, sidechainSource = null) {
  let audio = Audio.load(session.input);
  if (payload.trim?.enabled) {
    audio = audio.trim({
      start: payload.trim.start ?? 0,
      ...(payload.trim.duration !== undefined && payload.trim.duration !== null
        ? { duration: payload.trim.duration }
        : {})
    });
  }
  if (payload.normalize?.enabled) {
    audio = audio.normalize({
      ...(payload.normalize.targetLufs !== undefined ? { targetLufs: payload.normalize.targetLufs } : {}),
      ...(payload.normalize.truePeakDb !== undefined ? { truePeakDb: payload.normalize.truePeakDb } : {}),
      ...(payload.normalize.loudnessRange !== undefined ? { loudnessRange: payload.normalize.loudnessRange } : {})
    });
  }
  if (payload.fadeIn > 0) audio = audio.fadeIn(payload.fadeIn);
  if (payload.fadeOut > 0) audio = audio.fadeOut(payload.fadeOut);
  if (payload.channels && payload.channels !== "source") audio = audio.channels(payload.channels);
  if (sidechainSource) {
    audio = audio.duckUnder({
      sidechain: sidechainSource,
      ...(payload.ducking?.threshold !== undefined ? { threshold: payload.ducking.threshold } : {}),
      ...(payload.ducking?.ratio !== undefined ? { ratio: payload.ducking.ratio } : {}),
      ...(payload.ducking?.attackMs !== undefined ? { attackMs: payload.ducking.attackMs } : {}),
      ...(payload.ducking?.releaseMs !== undefined ? { releaseMs: payload.ducking.releaseMs } : {}),
      ...(payload.ducking?.sidechainGain !== undefined ? { sidechainGain: payload.ducking.sidechainGain } : {}),
      mixSidechain: payload.ducking?.mixSidechain !== false
    });
  }
  return audio;
}

async function resolveSidechainSource(payload) {
  if (!payload.ducking?.enabled || !payload.ducking.sidechainSessionId) return null;
  const sidechainSession = await getSession(payload.ducking.sidechainSessionId);
  return sidechainSession.input;
}

async function handleAudioEnginePlan(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const sidechainSource = await resolveSidechainSource(payload);
  const codec = payload.codec ?? "aac";
  const extension = codec === "mp3" ? "mp3" : codec === "opus" ? "opus" : codec === "copy" ? "mka" : "m4a";
  const output = join(session.directory, `audio-engine-plan.${extension}`);
  const plan = await buildAudioPipeline(session, payload, sidechainSource).planExport(output, {
    overwrite: true,
    codec,
    ...(payload.bitrate ? { bitrate: payload.bitrate } : {})
  });
  json(res, 200, { plan });
}

async function handleAudioEngineProcess(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const sidechainSource = await resolveSidechainSource(payload);
  const codec = payload.codec ?? "aac";
  const extension = codec === "mp3" ? "mp3" : codec === "opus" ? "opus" : codec === "copy" ? "mka" : "m4a";
  const outputName = `audio-engine-${Date.now()}.${extension}`;
  const output = join(session.directory, outputName);
  const audio = buildAudioPipeline(session, payload, sidechainSource);
  const plan = await audio.planExport(output, {
    overwrite: true,
    codec,
    ...(payload.bitrate ? { bitrate: payload.bitrate } : {})
  });
  await audio.export(output, {
    overwrite: true,
    codec,
    ...(payload.bitrate ? { bitrate: payload.bitrate } : {})
  });
  const metadata = await Video.load(output).probe({ timeoutMs: 20_000 });
  json(res, 200, {
    name: outputName,
    url: mediaUrl(session.id, outputName),
    metadata,
    plan
  });
}

async function handleAudioSilence(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const result = await Audio.load(session.input).detectSilence({
    ...(payload.noiseDb !== undefined ? { noiseDb: payload.noiseDb } : {}),
    ...(payload.minDuration !== undefined ? { minDuration: payload.minDuration } : {})
  });
  json(res, 200, result);
}

async function handleAudioWaveform(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const outputName = `waveform-${Date.now()}.png`;
  const output = join(session.directory, outputName);
  await Audio.load(session.input).waveform(output, {
    overwrite: true,
    ...(payload.width !== undefined ? { width: payload.width } : {}),
    ...(payload.height !== undefined ? { height: payload.height } : {}),
    ...(payload.color ? { color: payload.color } : {}),
    ...(payload.background ? { background: payload.background } : {})
  });
  json(res, 200, { name: outputName, url: mediaUrl(session.id, outputName) });
}


async function createProjectSession() {
  const id = randomUUID();
  const directory = join(workspaceRoot, id);
  await mkdir(directory, { recursive: true });
  const inputName = "input.project";
  await writeFile(join(directory, inputName), "vexa-project");
  return { id, directory, input: join(directory, inputName), inputName };
}

async function resolveProjectAssetSource(source) {
  if (typeof source !== "string" || !source.startsWith("session:")) {
    throw new Error('Project media sources must use the local "session:<id>" asset reference format.');
  }
  const id = source.slice("session:".length);
  const session = await getSession(id);
  return session.input;
}

async function resolveProjectAstSources(project) {
  if (!project || project.schemaVersion !== 1 || !Array.isArray(project.tracks)) {
    throw new Error("A valid schemaVersion 1 project is required.");
  }

  const tracks = [];
  for (const track of project.tracks) {
    const clips = [];
    for (const clip of track.clips ?? []) {
      if (["video", "audio", "image"].includes(clip.kind)) {
        clips.push({ ...clip, source: await resolveProjectAssetSource(clip.source) });
      } else {
        clips.push({ ...clip });
      }
    }
    tracks.push({ ...track, clips });
  }
  return { ...project, tracks };
}

function projectRenderOptions(payload) {
  const value = payload.export ?? {};
  return {
    overwrite: true,
    ...(value.videoCodec ? { videoCodec: value.videoCodec } : {}),
    ...(value.audioCodec ? { audioCodec: value.audioCodec } : {}),
    ...(value.crf !== undefined ? { crf: value.crf } : {}),
    ...(value.preset ? { preset: value.preset } : {}),
    ...(value.pixelFormat ? { pixelFormat: value.pixelFormat } : {}),
    ...(value.videoBitrate ? { videoBitrate: value.videoBitrate } : {}),
    ...(value.audioBitrate ? { audioBitrate: value.audioBitrate } : {}),
    ...(value.hardwareAcceleration ? { hardwareAcceleration: value.hardwareAcceleration } : {}),
    ...(value.hardwareFallback !== undefined ? { hardwareFallback: value.hardwareFallback } : {})
  };
}

async function handleProjectPlan(req, res) {
  const payload = await readJson(req);
  const resolved = await resolveProjectAstSources(payload.project);
  const project = VideoProject.fromAst(resolved);
  const extension = payload.outputFormat === "webm" ? "webm" : "mp4";
  const output = join(workspaceRoot, `_project-plan.${extension}`);
  const plan = await project.planRender(output, projectRenderOptions(payload));
  json(res, 200, { plan });
}

async function handleProjectRender(req, res) {
  const payload = await readJson(req);
  const resolved = await resolveProjectAstSources(payload.project);
  const project = VideoProject.fromAst(resolved);
  const session = await createProjectSession();
  const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
  const outputName = `project-render-${Date.now()}.${outputFormat}`;
  const output = join(session.directory, outputName);
  const controller = new AbortController();

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });

  const write = (value) => {
    if (!res.destroyed) res.write(`${JSON.stringify(value)}\n`);
  };
  const abortIfDisconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", abortIfDisconnected);

  try {
    const options = {
      ...projectRenderOptions(payload),
      signal: controller.signal,
      onProgress(progress) {
        write({ type: "progress", progress });
      }
    };
    const plan = await project.planRender(output, options);
    write({ type: "start", output: outputName, plan });
    await project.render(output, options);

    const metadata = await Video.load(output).probe({ timeoutMs: 20_000 });
    const url = mediaUrl(session.id, outputName);
    let playbackUrl = url;
    let previewGenerated = false;
    if (!isBrowserLikelyPlayable(outputName, metadata)) {
      const preview = await ensureBrowserPreview(session, output, `project-render-${Date.now()}`);
      playbackUrl = preview.url;
      previewGenerated = true;
    }

    write({
      type: "complete",
      sessionId: session.id,
      name: outputName,
      url,
      playbackUrl,
      previewGenerated,
      metadata,
      project: project.ast
    });
  } catch (error) {
    await rm(session.directory, { recursive: true, force: true });
    write({ type: "error", ...errorPayload(error) });
  } finally {
    res.off("close", abortIfDisconnected);
    if (!res.writableEnded) res.end();
  }
}


async function handleHardwareDetect(_req, res) {
  const capabilities = await Hardware.detect();
  json(res, 200, { capabilities });
}

async function handleHardwareBenchmark(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const provider = String(payload.provider ?? "auto");
  const providers = provider === "auto"
    ? ["nvidia", "intel", "amd", "apple", "cpu"]
    : [provider];
  const results = await Hardware.benchmark(session.input, {
    codec: ["h264", "h265", "av1", "vp9"].includes(payload.codec) ? payload.codec : "h264",
    providers,
    durationSeconds: Number(payload.durationSeconds ?? 3),
    timeoutMs: 30_000
  });
  json(res, 200, { results });
}

function streamingOptions(payload, extra = {}) {
  return {
    protocol: payload.protocol === "dash" ? "dash" : "hls",
    preset: ["mobile", "balanced", "hd"].includes(payload.preset) ? payload.preset : "balanced",
    segmentDuration: Number(payload.segmentDuration ?? 4),
    ...(payload.hlsPlaylistType ? { hlsPlaylistType: payload.hlsPlaylistType } : {}),
    ...(Array.isArray(payload.renditions) && payload.renditions.length ? { renditions: payload.renditions } : {}),
    ...(payload.hardwareAcceleration ? { hardwareAcceleration: payload.hardwareAcceleration } : {}),
    ...(payload.hardwareFallback !== undefined ? { hardwareFallback: payload.hardwareFallback } : {}),
    overwrite: true,
    ...extra
  };
}

async function handleStreamingPlan(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const output = join(session.directory, "_stream-plan");
  const plan = await Streaming.load(session.input).planPackage(output, streamingOptions(payload));
  json(res, 200, { plan });
}

async function handleStreamingPackage(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const protocol = payload.protocol === "dash" ? "dash" : "hls";
  const directoryName = `stream-${protocol}-${Date.now()}`;
  const output = join(session.directory, directoryName);
  const streaming = Streaming.load(session.input);
  const controller = new AbortController();
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  const write = (value) => { if (!res.destroyed) res.write(`${JSON.stringify(value)}\n`); };
  const abortIfDisconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", abortIfDisconnected);
  try {
    const options = streamingOptions(payload, {
      signal: controller.signal,
      onProgress(progress) { write({ type: "progress", progress }); }
    });
    const plan = await streaming.planPackage(output, options);
    write({ type: "start", plan });
    const result = await streaming.package(output, options);
    const manifestText = await readFile(result.manifestPath, "utf8");
    const manifestRelative = result.manifestPath.slice(`${output}${sep}`.length).replaceAll("\\", "/");
    write({
      type: "complete",
      protocol: result.protocol,
      directoryName,
      manifestUrl: packageUrl(session.id, directoryName, manifestRelative),
      manifestText,
      files: result.files.map((file) => ({ name: file, url: packageUrl(session.id, directoryName, file) })),
      renditions: result.renditions
    });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    write({ type: "error", ...errorPayload(error) });
  } finally {
    res.off("close", abortIfDisconnected);
    if (!res.writableEnded) res.end();
  }
}

async function handleStreamingSprite(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const directoryName = `sprite-${Date.now()}`;
  const output = join(session.directory, directoryName);
  const streaming = Streaming.load(session.input);
  const result = await streaming.previewSprite(output, {
    overwrite: true,
    intervalSeconds: Number(payload.intervalSeconds ?? 5),
    tileWidth: Number(payload.tileWidth ?? 160),
    columns: Number(payload.columns ?? 5),
    ...(payload.quality !== undefined ? { quality: Number(payload.quality) } : {})
  });
  const vtt = await readFile(result.vttPath, "utf8");
  json(res, 200, {
    imageUrl: packageUrl(session.id, directoryName, "sprite.jpg"),
    vttUrl: packageUrl(session.id, directoryName, "sprite.vtt"),
    vtt,
    cues: result.cues
  });
}


function captionDocumentFromPayload(payload) {
  const format = ["srt", "vtt", "ass"].includes(payload.format) ? payload.format : "srt";
  const content = String(payload.content ?? "").trim();
  if (!content) throw new Error("Caption content is required.");
  let document = Captions.parse(content, format);
  const template = ["subtitle", "headline", "minimal"].includes(payload.template) ? payload.template : "subtitle";
  const overrides = {
    ...(payload.fontSize ? { fontSize: Number(payload.fontSize) } : {}),
    ...(payload.color ? { color: String(payload.color) } : {}),
    ...(payload.backgroundColor ? { backgroundColor: String(payload.backgroundColor) } : {}),
    ...(payload.position ? { position: payload.position } : {}),
    ...(payload.animation ? { animation: payload.animation } : {})
  };
  document = Captions.applyTemplate(document, template, overrides);
  return document;
}

async function handleCaptionParse(req, res) {
  const payload = await readJson(req);
  const document = captionDocumentFromPayload(payload);
  json(res, 200, { document, srt: Captions.stringify(document, "srt"), vtt: Captions.stringify(document, "vtt"), ass: Captions.stringify(document, "ass") });
}

async function handleCaptionPlan(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const document = captionDocumentFromPayload(payload);
  const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
  const output = join(session.directory, `caption-plan.${outputFormat}`);
  const plan = await buildVideo(session, payload).planCaptionBurn(document, output, buildExportOptions(payload));
  json(res, 200, { document, plan });
}

async function handleCaptionBurn(req, res) {
  const payload = await readJson(req);
  const session = await getSession(payload.sessionId);
  const document = captionDocumentFromPayload(payload);
  const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
  const outputName = `caption-burn-${Date.now()}.${outputFormat}`;
  const output = join(session.directory, outputName);
  const controller = new AbortController();
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  const write = (value) => { if (!res.destroyed) res.write(`${JSON.stringify(value)}\n`); };
  const abortIfDisconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", abortIfDisconnected);
  try {
    const video = buildVideo(session, payload);
    const plan = await video.planCaptionBurn(document, output, buildExportOptions(payload));
    write({ type: "start", output: outputName, document, plan });
    await video.burnCaptions(document, output, buildExportOptions(payload, {
      signal: controller.signal,
      onProgress(progress) { write({ type: "progress", progress }); }
    }));
    const metadata = await Video.load(output).probe({ timeoutMs: 20_000 });
    const url = mediaUrl(session.id, outputName);
    let playbackUrl = url;
    let previewGenerated = false;
    if (!isBrowserLikelyPlayable(outputName, metadata)) {
      const preview = await ensureBrowserPreview(session, output, `caption-${Date.now()}`);
      playbackUrl = preview.url;
      previewGenerated = true;
    }
    write({ type: "complete", name: outputName, url, playbackUrl, previewGenerated, metadata, document });
  } catch (error) {
    await rm(output, { force: true });
    write({ type: "error", ...errorPayload(error) });
  } finally {
    res.off("close", abortIfDisconnected);
    if (!res.writableEnded) res.end();
  }
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".mp4":
    case ".m4v": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".mkv": return "video/x-matroska";
    case ".avi": return "video/x-msvideo";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".wav": return "audio/wav";
    case ".ogg": return "audio/ogg";
    case ".aac": return "audio/aac";
    case ".m4a": return "audio/mp4";
    case ".mp3": return "audio/mpeg";
    case ".opus":
    case ".ogg": return "audio/ogg";
    case ".wav": return "audio/wav";
    case ".aac": return "audio/aac";
    case ".mka": return "audio/x-matroska";
    case ".m3u8": return "application/vnd.apple.mpegurl";
    case ".mpd": return "application/dash+xml";
    case ".ts": return "video/mp2t";
    case ".m4s": return "video/iso.segment";
    case ".vtt": return "text/vtt; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function parseByteRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

async function serveFile(res, path, range, method = "GET") {
  const info = await stat(path);
  const type = contentType(path);
  const commonHeaders = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-disposition": "inline"
  };

  if (range) {
    const parsed = parseByteRange(range, info.size);
    if (!parsed) {
      res.writeHead(416, { ...commonHeaders, "content-range": `bytes */${info.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...commonHeaders,
      "content-range": `bytes ${parsed.start}-${parsed.end}/${info.size}`,
      "content-length": parsed.end - parsed.start + 1
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(path, parsed).pipe(res);
    return;
  }

  res.writeHead(200, { ...commonHeaders, "content-length": info.size });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}

async function servePublic(res, requestPath, method) {
  const file = requestPath === "/" ? "index.html" : requestPath.slice(1);
  if (!/^[a-z0-9._/-]+$/iu.test(file) || file.includes("..")) {
    json(res, 400, { error: "Invalid public path." });
    return;
  }

  const path = resolve(publicDir, file);
  if (!path.startsWith(`${publicDir}${sep}`) && path !== join(publicDir, "index.html")) {
    json(res, 403, { error: "Path is outside the playground public directory." });
    return;
  }
  try {
    await serveFile(res, path, undefined, method);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    json(res, 404, { error: "Public file not found." });
  }
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);

  if (req.method === "POST" && url.pathname === "/api/jobs/render") {
    await handleJobSubmit(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/jobs") {
    await handleJobList(req, res);
    return;
  }
  const jobMatch = /^\/api\/jobs\/([a-f0-9-]{36})$/iu.exec(url.pathname);
  if (jobMatch && req.method === "GET") {
    await handleJobGet(req, res, jobMatch[1]);
    return;
  }
  const jobCancelMatch = /^\/api\/jobs\/([a-f0-9-]{36})\/cancel$/iu.exec(url.pathname);
  if (jobCancelMatch && req.method === "POST") {
    await handleJobCancel(req, res, jobCancelMatch[1]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    await handleUpload(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/remote-import") {
    await handleRemoteImport(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/preview") {
    await handlePreview(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/plan") {
    await handlePlan(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/render") {
    await handleRender(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/thumbnail") {
    await handleThumbnail(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/audio") {
    await handleAudio(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/audio-engine/plan") {
    await handleAudioEnginePlan(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/audio-engine/process") {
    await handleAudioEngineProcess(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/audio-engine/silence") {
    await handleAudioSilence(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/audio-engine/waveform") {
    await handleAudioWaveform(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/project/plan") {
    await handleProjectPlan(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/project/render") {
    await handleProjectRender(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/captions/parse") {
    await handleCaptionParse(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/captions/plan") {
    await handleCaptionPlan(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/captions/burn") {
    await handleCaptionBurn(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hardware/detect") {
    await handleHardwareDetect(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/hardware/benchmark") {
    await handleHardwareBenchmark(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/streaming/plan") {
    await handleStreamingPlan(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/streaming/package") {
    await handleStreamingPackage(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/streaming/sprite") {
    await handleStreamingSprite(req, res);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/package/")) {
    const parts = url.pathname.split("/").slice(2).map((part) => decodeURIComponent(part));
    const [id, directoryName, ...fileParts] = parts;
    const session = await getSession(id);
    if (!directoryName || !/^[a-z0-9._-]+$/iu.test(directoryName) || fileParts.length === 0 || fileParts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("Invalid streaming package path.");
    }
    const root = resolve(session.directory, directoryName);
    const path = resolve(root, ...fileParts);
    if (!root.startsWith(`${session.directory}${sep}`) || (!path.startsWith(`${root}${sep}`) && path !== root)) {
      throw new Error("Invalid streaming package path.");
    }
    await serveFile(res, path, req.headers.range, req.method);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/media/")) {
    const [, , id, encodedName] = url.pathname.split("/");
    const session = await getSession(id);
    const name = decodeURIComponent(encodedName ?? "");
    const path = safeSessionFile(session, name);
    await serveFile(res, path, req.headers.range, req.method);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await servePublic(res, url.pathname, req.method);
    return;
  }

  json(res, 404, { error: "Not found." });
}

await mkdir(workspaceRoot, { recursive: true });

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error("[playground]", error);
    if (!res.headersSent) json(res, errorStatus(error), errorPayload(error));
    else if (!res.writableEnded) res.end();
  });
});

server.listen(port, host, () => {
  console.log(`[playground] Vexa Video editor playground: http://${host}:${port}`);
  console.log("[playground] Browser-safe H.264/AAC previews are generated when source/output codecs cannot play directly in the browser.");
  console.log("[playground] Uploads and generated files are temporary and stay under .tmp/visual-playground.");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

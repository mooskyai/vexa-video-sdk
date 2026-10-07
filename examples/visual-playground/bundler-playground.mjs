import { rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  bundleCompositions,
  discoverBundleCompositions,
  VexaBundlerError
} from "../../packages/bundler/dist/index.js";
import { VexaCompositionRenderer, VexaRendererError } from "../../packages/renderer/dist/index.js";

const fixtureEntry = "examples/visual-playground/compositions/entry.tsx";
const fixturePublicDir = "examples/visual-playground/compositions/public";
const fixtureOutputDir = ".tmp/visual-playground/composition-bundle";
const fixtureEnvironment = Object.freeze({ VEXA_PLAYGROUND_LABEL: "Vexa Playground" });
const fixtureEnvironmentAllowlist = Object.freeze(["VEXA_PLAYGROUND_LABEL"]);

function json(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error("Composition request is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function errorPayload(error) {
  if (error instanceof VexaBundlerError) {
    return {
      error: error.message,
      code: error.code,
      diagnostics: error.diagnostics
    };
  }
  if (error instanceof VexaRendererError) {
    return {
      error: error.message,
      code: error.code,
      diagnostics: []
    };
  }
  return {
    error: error instanceof Error ? error.message : String(error),
    code: "PLAYGROUND_BUNDLER_ERROR",
    diagnostics: []
  };
}

function requestErrorStatus(error) {
  if (error instanceof VexaBundlerError) return 400;
  if (error instanceof VexaRendererError) {
    return error.code === "RENDER_EXECUTION_FAILED" ? 500 : 400;
  }
  return 500;
}

function bundleOptions(repositoryRoot, workspaceRoot, overrides = {}) {
  return {
    rootDir: repositoryRoot,
    entry: fixtureEntry,
    outDir: resolve(workspaceRoot, "composition-bundle"),
    publicDir: fixturePublicDir,
    environmentAllowlist: fixtureEnvironmentAllowlist,
    environment: fixtureEnvironment,
    ...overrides
  };
}


function renderOutputPath(compositionId, target, frame, format) {
  const safeId = compositionId.replace(/[^a-z0-9_-]/giu, "-");
  if (target === "video") return `renders/${safeId}.${format === "webm" ? "webm" : "mp4"}`;
  if (target === "frame-range") return `renders/${safeId}-frames`;
  if (target === "frame") return `renders/${safeId}-frame-${frame}.${format === "webp" ? "webp" : "png"}`;
  return `renders/${safeId}.${format === "webp" ? "webp" : "png"}`;
}

async function createRenderPlan(payload, context) {
  const manifestPath = resolve(context.workspaceRoot, "composition-bundle", "vexa.bundle.json");
  const runtime = rendererRuntimeOptions(payload);
  const renderer = await VexaCompositionRenderer.fromManifest(manifestPath, { timeoutMs: runtime.timeoutMs });
  const compositionId = String(payload.compositionId ?? "");
  const target = String(payload.target ?? "frame");
  const frame = Number(payload.frame ?? 0);
  const endFrameExclusive = Number(payload.endFrameExclusive ?? frame + 1);
  const format = target === "video" ? "mp4" : "png";
  const output = renderOutputPath(compositionId, target, frame, format);

  if (target === "still") return renderer.planStill({ compositionId, output, format: "png" });
  if (target === "frame") return renderer.planFrame({ compositionId, frame, output, format: "png" });
  if (target === "frame-range") {
    return renderer.planFrameRange({
      compositionId,
      startFrame: frame,
      endFrameExclusive,
      output,
      format: "png"
    });
  }
  if (target === "video") {
    return renderer.planVideo({
      compositionId,
      output,
      format: "mp4",
      startFrame: frame,
      endFrameExclusive
    });
  }
  throw new VexaRendererError(`Unsupported render target: ${target}.`, "INVALID_RENDERER_OPTIONS");
}

function rendererRuntimeOptions(payload, signal, onProgress) {
  const timeoutMs = Number(payload.timeoutMs ?? 120_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new VexaRendererError(
      "Render timeout must be a positive integer in milliseconds.",
      "INVALID_RENDERER_OPTIONS"
    );
  }

  const requestedHardware = String(payload.hardwareAcceleration ?? "cpu");
  const hardwareAcceleration = ["auto", "cpu", "nvidia", "intel", "amd", "apple"].includes(requestedHardware)
    ? requestedHardware
    : null;
  if (!hardwareAcceleration) {
    throw new VexaRendererError(
      `Unsupported hardware selection: ${requestedHardware}.`,
      "INVALID_RENDERER_OPTIONS"
    );
  }

  return {
    timeoutMs,
    hardwareAcceleration,
    hardwareFallback: payload.hardwareFallback !== false,
    signal,
    onProgress
  };
}

function summarizeRenderResult(result, output) {
  return {
    target: result.target,
    metadata: result.metadata,
    plan: { ...result.plan, output },
    ...(result.frame !== undefined ? { frame: result.frame } : {}),
    ...(result.executionPlan?.hardware ? { hardware: result.executionPlan.hardware } : {})
  };
}

async function executeRender(payload, context, execution = {}) {
  if (
    typeof context.createOutputSession !== "function" ||
    typeof context.mediaUrl !== "function" ||
    typeof context.packageUrl !== "function"
  ) {
    throw new Error("Composition output serving is not configured.");
  }

  const manifestPath = resolve(context.workspaceRoot, "composition-bundle", "vexa.bundle.json");
  const runtime = rendererRuntimeOptions(payload, execution.signal, execution.onProgress);
  const renderer = await VexaCompositionRenderer.fromManifest(manifestPath, { timeoutMs: runtime.timeoutMs });
  const compositionId = String(payload.compositionId ?? "");
  const target = String(payload.target ?? "frame");
  const frame = Number(payload.frame ?? 0);
  const endFrameExclusive = Number(payload.endFrameExclusive ?? frame + 1);
  const safeId = compositionId.replace(/[^a-z0-9_-]/giu, "-") || "composition";
  const session = await context.createOutputSession();

  try {
    if (target === "still") {
      const name = `${safeId}.png`;
      const result = await renderer.renderStill({
        compositionId,
        output: join(session.directory, name),
        format: "png",
        overwrite: true,
        ...runtime
      });
      return {
        target,
        result: summarizeRenderResult(result, renderOutputPath(compositionId, target, frame, "png")),
        output: { name, url: context.mediaUrl(session.id, name) }
      };
    }

    if (target === "frame") {
      const name = `${safeId}-frame-${frame}.png`;
      const result = await renderer.renderFrame({
        compositionId,
        frame,
        output: join(session.directory, name),
        format: "png",
        overwrite: true,
        ...runtime
      });
      return {
        target,
        result: summarizeRenderResult(result, renderOutputPath(compositionId, target, frame, "png")),
        output: { name, url: context.mediaUrl(session.id, name) }
      };
    }

    if (target === "frame-range") {
      const directoryName = `${safeId}-frames`;
      const result = await renderer.renderFrameRange({
        compositionId,
        startFrame: frame,
        endFrameExclusive,
        output: join(session.directory, directoryName),
        format: "png",
        concurrency: 2,
        overwrite: true,
        ...runtime
      });
      return {
        target,
        result: summarizeRenderResult(result, renderOutputPath(compositionId, target, frame, "png")),
        output: {
          directoryName,
          files: result.frames.map((item) => ({
            frame: item.frame,
            name: basename(item.output),
            url: context.packageUrl(session.id, directoryName, basename(item.output))
          }))
        }
      };
    }

    if (target === "video") {
      const name = `${safeId}.mp4`;
      const result = await renderer.renderVideo({
        compositionId,
        startFrame: frame,
        endFrameExclusive,
        output: join(session.directory, name),
        format: "mp4",
        overwrite: true,
        ...runtime
      });
      return {
        target,
        result: summarizeRenderResult(result, renderOutputPath(compositionId, target, frame, "mp4")),
        output: { name, url: context.mediaUrl(session.id, name) }
      };
    }

    throw new VexaRendererError(`Unsupported render target: ${target}.`, "INVALID_RENDERER_OPTIONS");
  } catch (error) {
    await rm(session.directory, { recursive: true, force: true });
    throw error;
  }
}

export async function handleBundlerPlaygroundRequest(req, res, context) {
  const pathname = context.url.pathname;
  if (pathname === "/api/compositions/discover" && req.method === "GET") {
    try {
      const compositions = await discoverBundleCompositions({
        rootDir: context.repositoryRoot,
        entry: fixtureEntry,
        environmentAllowlist: fixtureEnvironmentAllowlist,
        environment: fixtureEnvironment
      });
      json(res, 200, {
        entry: fixtureEntry,
        publicDir: fixturePublicDir,
        environment: fixtureEnvironmentAllowlist,
        compositions
      });
    } catch (error) {
      json(res, error instanceof VexaBundlerError ? 400 : 500, errorPayload(error));
    }
    return true;
  }

  if (pathname === "/api/compositions/build" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      const mode = payload.mode === "production" ? "production" : "development";
      const sourceMap = ["none", "external", "inline"].includes(payload.sourceMap)
        ? payload.sourceMap
        : "external";
      const options = bundleOptions(context.repositoryRoot, context.workspaceRoot, { mode, sourceMap });
      await rm(options.outDir, { recursive: true, force: true });
      const result = await bundleCompositions(options);
      json(res, 200, {
        entry: fixtureEntry,
        publicDir: fixturePublicDir,
        outputDir: fixtureOutputDir,
        manifest: result.manifest
      });
    } catch (error) {
      json(res, error instanceof VexaBundlerError ? 400 : 500, errorPayload(error));
    }
    return true;
  }


  if (pathname === "/api/compositions/render-plan" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      const plan = await createRenderPlan(payload, context);
      json(res, 200, { plan });
    } catch (error) {
      json(
        res,
        requestErrorStatus(error),
        errorPayload(error)
      );
    }
    return true;
  }

  if (pathname === "/api/compositions/render" && req.method === "POST") {
    let payload;
    try {
      payload = await readJson(req);
    } catch (error) {
      json(res, requestErrorStatus(error), errorPayload(error));
      return true;
    }

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
    req.once("aborted", abortIfDisconnected);
    res.once("close", abortIfDisconnected);

    try {
      write({ type: "start" });
      const result = await executeRender(payload, context, {
        signal: controller.signal,
        onProgress(progress) { write({ type: "progress", progress }); }
      });
      write({ type: "complete", result });
    } catch (error) {
      write({ type: "error", ...errorPayload(error) });
    } finally {
      req.off("aborted", abortIfDisconnected);
      res.off("close", abortIfDisconnected);
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  return false;
}

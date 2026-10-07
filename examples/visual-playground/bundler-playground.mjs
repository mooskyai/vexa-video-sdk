import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bundleCompositions,
  discoverBundleCompositions,
  VexaBundlerError
} from "../../packages/bundler/dist/index.js";

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
  return {
    error: error instanceof Error ? error.message : String(error),
    code: "PLAYGROUND_BUNDLER_ERROR",
    diagnostics: []
  };
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

  return false;
}

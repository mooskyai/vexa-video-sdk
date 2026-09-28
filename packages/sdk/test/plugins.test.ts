import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { runProcess } from "@moosky-video/ffmpeg";
import {
  InvalidPluginError,
  PluginDependencyError
} from "@moosky-video/core";
import { JobQueue } from "../src/jobs.js";
import { PluginRegistry, definePlugin } from "../src/plugins.js";
import { Storage } from "../src/storage.js";
import { Video } from "../src/video.js";

const baseMetadata = {
  schemaVersion: 1 as const,
  id: "example.base",
  name: "Example base",
  version: "1.0.0",
  capabilities: [] as const
};

test("plugin lifecycle and catalog are deterministic and serializable", async () => {
  const events: string[] = [];
  const registry = new PluginRegistry();
  await registry.register(definePlugin({
    metadata: baseMetadata,
    setup() { events.push("setup"); },
    start() { events.push("start"); },
    stop() { events.push("stop"); },
    dispose() { events.push("dispose"); }
  }));

  assert.equal(registry.get("example.base").state, "registered");
  await registry.startAll();
  assert.equal(registry.get("example.base").state, "started");
  await registry.stopAll();
  assert.equal(registry.get("example.base").state, "stopped");
  assert.deepEqual(events, ["setup", "start", "stop"]);
  assert.doesNotThrow(() => JSON.stringify(registry.catalog()));

  await registry.unregister("example.base");
  assert.deepEqual(events, ["setup", "start", "stop", "dispose"]);
  assert.equal(registry.catalog().length, 0);
});

test("plugin dependencies and declared capabilities are enforced", async () => {
  const registry = new PluginRegistry();
  await assert.rejects(
    registry.register({
      metadata: {
        schemaVersion: 1,
        id: "example.dependent",
        name: "Dependent",
        version: "1.0.0",
        capabilities: [],
        requires: [{ id: "example.missing" }]
      }
    }),
    PluginDependencyError
  );

  await assert.rejects(
    registry.register({
      metadata: {
        schemaVersion: 1,
        id: "example.badcap",
        name: "Bad capability",
        version: "1.0.0",
        capabilities: []
      },
      setup(context) {
        context.registerVideoOperation({
          name: "resize",
          transform: () => ({ type: "resize", options: { width: 64, height: 64, fit: "contain" } })
        });
      }
    }),
    (error) => error instanceof Error && error.message.includes("video-operation")
  );
});

test("custom video operation expands into the normal immutable Video pipeline", async () => {
  const registry = new PluginRegistry();
  await registry.register({
    metadata: {
      schemaVersion: 1,
      id: "example.video",
      name: "Video operations",
      version: "1.0.0",
      capabilities: ["video-operation"]
    },
    setup(context) {
      context.registerVideoOperation<{ width: number; height: number }>({
        name: "fit",
        validate(payload) {
          if (payload.width <= 0 || payload.height <= 0) throw new Error("invalid size");
        },
        transform(payload) {
          return { type: "resize", options: { width: payload.width, height: payload.height, fit: "contain" } };
        }
      });
    }
  });

  const source = Video.load("input.mp4").trim({ start: 1, duration: 2 });
  const result = registry.applyVideoOperation(source, "example.video:fit", { width: 320, height: 180 });
  assert.notEqual(result, source);
  assert.equal(source.operations.length, 1);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(result.operations[1], {
    type: "resize",
    options: { width: 320, height: 180, fit: "contain" }
  });
});

test("plugin video operation renders through the existing FFmpeg backend", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-plugin-video-"));
  const input = join(workspace, "input.mp4");
  const output = join(workspace, "output.mp4");
  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=160x120:rate=24",
      "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input
    ]);

    const registry = new PluginRegistry();
    await registry.register({
      metadata: {
        schemaVersion: 1,
        id: "example.square",
        name: "Square output",
        version: "1.0.0",
        capabilities: ["video-operation"]
      },
      setup(context) {
        context.registerVideoOperation({
          name: "square",
          transform: () => ({ type: "crop", options: { width: 96, height: 96 } })
        });
      }
    });

    const video = registry.applyVideoOperation(Video.load(input), "example.square:square", {});
    await video.export(output, { crf: 30 });
    const info = await Video.load(output).probe();
    assert.equal(info.video?.width, 96);
    assert.equal(info.video?.height, 96);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("storage and job contributions install into existing SDK abstractions", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-plugin-storage-"));
  try {
    const registry = new PluginRegistry();
    await registry.register({
      metadata: {
        schemaVersion: 1,
        id: "example.integration",
        name: "SDK integrations",
        version: "1.0.0",
        capabilities: ["storage-adapter", "job-handler"]
      },
      setup(context) {
        context.registerStorageAdapter(Storage.adapter("custom", {
          async download(reference, destination) {
            await writeFile(destination, `plugin:${reference.key}`, "utf8");
          }
        }));
        context.registerJobHandler<{ value: number }, number>({
          name: "double",
          handler: async (payload) => payload.value * 2
        });
      }
    });

    const storage = registry.createStorage({ workspaceRoot: workspace });
    const resolved = await storage.resolve({ kind: "object", provider: "custom", key: "asset.txt" });
    assert.equal(await readFile(resolved.path, "utf8"), "plugin:asset.txt");
    await resolved.cleanup();

    const queue = new JobQueue();
    assert.deepEqual(registry.installJobHandlers(queue), ["example.integration:double"]);
    const job = queue.submit<{ value: number }, number>("example.integration:double", { value: 21 });
    assert.equal(await job.result(), 42);
    await queue.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("render backend and encoder provider contributions are explicit and inspectable", async () => {
  const registry = new PluginRegistry();
  const progress: number[] = [];
  await registry.register({
    metadata: {
      schemaVersion: 1,
      id: "example.backend",
      name: "Backend plugin",
      version: "1.0.0",
      capabilities: ["render-backend", "encoder-provider"]
    },
    setup(context) {
      context.registerRenderBackend<{ name: string }, { output: string }>({
        name: "cloud",
        async execute(request, backendContext) {
          await backendContext.reportProgress({ percent: 50, phase: "upload" });
          await backendContext.reportProgress({ percent: 100, phase: "done" });
          return { output: `cloud://${request.name}` };
        }
      });
      context.registerEncoderProvider({
        name: "h264-cloud",
        codecs: ["h264"],
        resolve(request) {
          return {
            codec: request.codec,
            backend: "cloud",
            encoder: "acme-h264",
            options: { profile: "main" }
          };
        }
      });
    }
  });

  const rendered = await registry.executeBackend<{ name: string }, { output: string }>(
    "example.backend:cloud",
    { name: "result.mp4" },
    { onProgress: (value) => { if (value.percent != null) progress.push(value.percent); } }
  );
  assert.deepEqual(rendered, { output: "cloud://result.mp4" });
  assert.deepEqual(progress, [50, 100]);

  const encoder = await registry.resolveEncoder("example.backend:h264-cloud", { codec: "h264", container: "mp4" });
  assert.equal(encoder?.pluginId, "example.backend");
  assert.equal(encoder?.encoder, "acme-h264");
  assert.equal(await registry.resolveEncoder("example.backend:h264-cloud", { codec: "vp9", container: "webm" }), null);
});

test("plugin modules follow the vexaPlugin package export convention", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "vexa-plugin-load-"));
  try {
    const modulePath = join(workspace, "plugin.mjs");
    await writeFile(modulePath, `
      export const vexaPluginMetadata = {
        schemaVersion: 1,
        id: "example.loaded",
        name: "Loaded plugin",
        version: "1.2.3",
        capabilities: []
      };
      export const vexaPlugin = { metadata: vexaPluginMetadata };
    `, "utf8");

    const registry = new PluginRegistry();
    const metadata = await registry.load(pathToFileURL(modulePath).href);
    assert.equal(metadata.id, "example.loaded");
    assert.equal(registry.catalog()[0]?.metadata.version, "1.2.3");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("definePlugin rejects malformed metadata before registration", () => {
  assert.throws(() => definePlugin({
    metadata: {
      schemaVersion: 1,
      id: "Bad Plugin ID",
      name: "Bad",
      version: "not-semver",
      capabilities: []
    }
  }), InvalidPluginError);
});

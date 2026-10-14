import assert from "node:assert/strict";
import test from "node:test";

import { detectWebRenderCapabilities, planWebRender } from "../src/index.js";

function runtime(video: readonly string[], audio: readonly string[] = []) {
  return {
    hasVideoEncoder: video.length > 0,
    hasAudioEncoder: audio.length > 0,
    async supportsVideo(config: { readonly codec: string }) { return video.includes(config.codec); },
    async supportsAudio(config: { readonly codec: string }) { return audio.includes(config.codec); }
  };
}

test("reports unavailable WebCodecs as a typed backend fallback", async () => {
  const capabilities = await detectWebRenderCapabilities(runtime([]));
  assert.equal(capabilities.webCodecs, false);
  assert.deepEqual(capabilities.supportedVideoCodecs, []);
  const plan = planWebRender({}, capabilities);
  assert.equal(plan.kind, "backend-fallback");
  if (plan.kind === "backend-fallback") assert.equal(plan.code, "WEBCODECS_UNAVAILABLE");
});

test("normalizes H.264/AAC support and chooses deterministic MP4 plan", async () => {
  const capabilities = await detectWebRenderCapabilities(runtime(["avc1.42E01E"], ["mp4a.40.2"]));
  assert.deepEqual(capabilities.supportedVideoCodecs, ["h264"]);
  assert.deepEqual(capabilities.supportedAudioCodecs, ["aac"]);
  assert.deepEqual(planWebRender({ container: "mp4", audio: true }, capabilities), {
    kind: "browser", container: "mp4", videoCodec: "h264", audioCodec: "aac"
  });
});

test("prefers VP9 for WebM and falls back to AV1 when VP9 is unavailable", async () => {
  const both = await detectWebRenderCapabilities(runtime(["vp09.00.10.08", "av01.0.04M.08"], ["opus"]));
  assert.deepEqual(planWebRender({ container: "webm", audio: true }, both), {
    kind: "browser", container: "webm", videoCodec: "vp9", audioCodec: "opus"
  });
  const av1 = await detectWebRenderCapabilities(runtime(["av01.0.04M.08"]));
  assert.deepEqual(planWebRender({ container: "webm" }, av1), { kind: "browser", container: "webm", videoCodec: "av1" });
});

test("returns typed codec and container fallback reasons", async () => {
  const capabilities = await detectWebRenderCapabilities(runtime(["avc1.42E01E", "vp09.00.10.08"], []));
  const audio = planWebRender({ container: "mp4", audio: true }, capabilities);
  assert.equal(audio.kind, "backend-fallback");
  if (audio.kind === "backend-fallback") assert.equal(audio.code, "AUDIO_CODEC_UNSUPPORTED");
  const mismatch = planWebRender({ container: "mp4", videoCodec: "vp9" }, capabilities);
  assert.equal(mismatch.kind, "backend-fallback");
  if (mismatch.kind === "backend-fallback") assert.equal(mismatch.code, "CONTAINER_CODEC_UNSUPPORTED");
});

test("package dependency boundary stays browser-safe", async () => {
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.dependencies, { "@vexa-video/core": "1.0.0" });
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.equal(/from ["'](?:node:|@vexa-video\/(?:sdk|ffmpeg|renderer))/.test(source), false);
});

test("encodes deterministic video chunks with frame timing, keyframes, progress, and cleanup", async () => {
  const { encodeWebVideoFrames } = await import("../src/index.js");
  const encoded: Array<{ readonly timestamp: number; readonly keyFrame: boolean }> = [];
  const closedFrames: number[] = [];
  const progress: Array<{ readonly phase: string; readonly completedFrames: number }> = [];
  let encoderClosed = false;
  let configured: unknown;
  const runtime = {
    createVideoFrame(source: unknown, init: { readonly timestamp: number; readonly duration: number }) {
      const frame = Number(String(source).split("-")[1]);
      return { close() { closedFrames.push(frame); }, timestamp: init.timestamp };
    },
    createVideoEncoder(callbacks: {
      readonly output: (chunk: {
        readonly type: "key" | "delta";
        readonly timestamp: number;
        readonly duration: number;
        readonly byteLength: number;
        copyTo(destination: AllowSharedBufferSource): void;
      }) => void;
      readonly error: (error: Error) => void;
    }) {
      let queue = 0;
      return {
        get encodeQueueSize() { return queue; },
        configure(config: unknown) { configured = config; },
        encode(frame: { readonly timestamp?: number }, options?: { readonly keyFrame?: boolean }) {
          queue += 1;
          const timestamp = frame.timestamp ?? 0;
          const keyFrame = options?.keyFrame === true;
          encoded.push({ timestamp, keyFrame });
          const bytes = new Uint8Array([encoded.length, keyFrame ? 1 : 0]);
          callbacks.output({
            type: keyFrame ? "key" : "delta",
            timestamp,
            duration: 100_000,
            byteLength: bytes.length,
            copyTo(destination) {
              const view = ArrayBuffer.isView(destination)
                ? new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength)
                : new Uint8Array(destination);
              view.set(bytes);
            }
          });
          queue -= 1;
        },
        async flush() {},
        reset() {},
        close() { encoderClosed = true; }
      };
    }
  };
  const result = await encodeWebVideoFrames({
    plan: { kind: "browser", container: "webm", videoCodec: "vp9" },
    width: 320,
    height: 180,
    fps: 10,
    frameCount: 3,
    keyFrameInterval: 2,
    runtime,
    renderFrame(context) { return `frame-${context.frame}`; },
    onProgress(value) { progress.push({ phase: value.phase, completedFrames: value.completedFrames }); }
  });

  assert.deepEqual(configured, {
    codec: "vp09.00.10.08",
    width: 320,
    height: 180,
    bitrate: 500_000,
    framerate: 10
  });
  assert.deepEqual(encoded, [
    { timestamp: 0, keyFrame: true },
    { timestamp: 100_000, keyFrame: false },
    { timestamp: 200_000, keyFrame: true }
  ]);
  assert.deepEqual(closedFrames, [0, 1, 2]);
  assert.equal(encoderClosed, true);
  assert.deepEqual(result.chunks.map((chunk) => [chunk.type, chunk.timestampUs, [...chunk.data]]), [
    ["key", 0, [1, 1]],
    ["delta", 100_000, [2, 0]],
    ["key", 200_000, [3, 1]]
  ]);
  assert.deepEqual(progress, [
    { phase: "encoding", completedFrames: 1 },
    { phase: "encoding", completedFrames: 2 },
    { phase: "encoding", completedFrames: 3 },
    { phase: "complete", completedFrames: 3 }
  ]);
});

test("cancellation resets the browser encoder and returns a typed error", async () => {
  const { encodeWebVideoFrames, VexaWebVideoEncodeError } = await import("../src/index.js");
  const controller = new AbortController();
  let reset = false;
  let closed = false;
  const runtime = {
    createVideoFrame() { return { close() {} }; },
    createVideoEncoder() {
      return {
        encodeQueueSize: 0,
        configure() {},
        encode() {},
        async flush() {},
        reset() { reset = true; },
        close() { closed = true; }
      };
    }
  };

  await assert.rejects(
    encodeWebVideoFrames({
      plan: { kind: "browser", container: "mp4", videoCodec: "h264" },
      width: 16,
      height: 16,
      fps: 30,
      frameCount: 2,
      signal: controller.signal,
      runtime,
      renderFrame(context) {
        if (context.frame === 0) controller.abort();
        return {};
      }
    }),
    (error: unknown) => error instanceof VexaWebVideoEncodeError && error.code === "CANCELLED"
  );
  assert.equal(reset, true);
  assert.equal(closed, true);
});

test("video execution fails closed for audio plans and frame-render failures", async () => {
  const { encodeWebVideoFrames, VexaWebVideoEncodeError } = await import("../src/index.js");
  const runtime = {
    createVideoFrame() { return { close() {} }; },
    createVideoEncoder() {
      return {
        encodeQueueSize: 0,
        configure() {},
        encode() {},
        async flush() {},
        reset() {},
        close() {}
      };
    }
  };
  await assert.rejects(
    encodeWebVideoFrames({
      plan: { kind: "browser", container: "mp4", videoCodec: "h264", audioCodec: "aac" },
      width: 16,
      height: 16,
      fps: 30,
      frameCount: 1,
      runtime,
      renderFrame() { return {}; }
    }),
    (error: unknown) => error instanceof VexaWebVideoEncodeError && error.code === "AUDIO_EXECUTION_UNAVAILABLE"
  );
  await assert.rejects(
    encodeWebVideoFrames({
      plan: { kind: "browser", container: "mp4", videoCodec: "h264" },
      width: 16,
      height: 16,
      fps: 30,
      frameCount: 1,
      runtime,
      renderFrame() { throw new Error("capture failed"); }
    }),
    (error: unknown) => error instanceof VexaWebVideoEncodeError && error.code === "FRAME_RENDER_FAILED"
  );
});

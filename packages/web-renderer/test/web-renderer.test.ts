import assert from "node:assert/strict";
import test from "node:test";

import {
  createWebVideoFile,
  detectWebRenderCapabilities,
  muxWebMedia,
  muxWebVideo,
  planWebRender,
  VexaWebMediaMuxError,
  VexaWebMuxError,
  type VexaWebAudioEncodeResult,
  type VexaWebVideoEncodeResult
} from "../src/index.js";

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

test("video execution can encode the video portion of audio plans while frame failures stay typed", async () => {
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
  const withAudio = await encodeWebVideoFrames({
    plan: { kind: "browser", container: "mp4", videoCodec: "h264", audioCodec: "aac" },
    width: 16,
    height: 16,
    fps: 30,
    frameCount: 1,
    runtime,
    renderFrame() { return {}; }
  });
  assert.equal(withAudio.targetContainer, "mp4");
  assert.equal(withAudio.chunks.length, 0);
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


function encodedWebm(videoCodec: "vp9" | "av1" = "vp9"): VexaWebVideoEncodeResult {
  return {
    kind: "encoded-video-chunks",
    targetContainer: "webm",
    videoCodec,
    codec: videoCodec === "vp9" ? "vp09.00.10.08" : "av01.0.04M.08",
    width: 16,
    height: 16,
    fps: 30,
    frameCount: 3,
    durationSeconds: 0.1,
    chunks: [
      { type: "key", timestampUs: 0, durationUs: 33_333, data: new Uint8Array([1, 2, 3]) },
      { type: "delta", timestampUs: 33_333, durationUs: 33_333, data: new Uint8Array([4, 5]) },
      { type: "delta", timestampUs: 66_667, durationUs: 33_333, data: new Uint8Array([6]) }
    ]
  };
}

function containsAscii(data: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let offset = 0; offset <= data.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (data[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

test("muxes deterministic VP9 WebM bytes and Blob metadata", () => {
  const muxed = muxWebVideo(encodedWebm("vp9"));
  assert.equal(muxed.kind, "muxed-video");
  assert.equal(muxed.container, "webm");
  assert.equal(muxed.mimeType, "video/webm");
  assert.equal(muxed.blob.type, "video/webm");
  assert.equal(muxed.blob.size, muxed.data.byteLength);
  assert.deepEqual([...muxed.data.slice(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.equal(containsAscii(muxed.data, "webm"), true);
  assert.equal(containsAscii(muxed.data, "V_VP9"), true);
});

test("muxes AV1 with the WebM codec identity", () => {
  const muxed = muxWebVideo(encodedWebm("av1"));
  assert.equal(muxed.videoCodec, "av1");
  assert.equal(containsAscii(muxed.data, "V_AV1"), true);
});

test("muxing fails closed for missing H.264 metadata and invalid packet order", () => {
  assert.throws(
    () => muxWebVideo({ ...encodedWebm(), targetContainer: "mp4", videoCodec: "h264", codec: "avc1.42E01E" }),
    (error: unknown) => error instanceof VexaWebMuxError && error.code === "INVALID_MUX_INPUT"
  );
  const noKey = encodedWebm();
  assert.throws(
    () => muxWebVideo({ ...noKey, chunks: [{ ...noKey.chunks[0]!, type: "delta" }, ...noKey.chunks.slice(1)] }),
    (error: unknown) => error instanceof VexaWebMuxError && error.code === "INVALID_MUX_INPUT"
  );
  const reversed = encodedWebm();
  assert.throws(
    () => muxWebVideo({ ...reversed, chunks: [reversed.chunks[0]!, reversed.chunks[2]!, reversed.chunks[1]!] }),
    (error: unknown) => error instanceof VexaWebMuxError && error.code === "INVALID_MUX_INPUT"
  );
});

test("creates File output through the browser file boundary", () => {
  const muxed = muxWebVideo(encodedWebm());
  const expected = { name: "render.webm", type: "video/webm" } as unknown as File;
  let receivedName = "";
  let receivedType = "";
  const file = createWebVideoFile(muxed, "render.webm", {
    createFile(parts, fileName, options) {
      assert.equal(parts.length, 1);
      receivedName = fileName;
      receivedType = options.type ?? "";
      return expected;
    }
  });
  assert.equal(file, expected);
  assert.equal(receivedName, "render.webm");
  assert.equal(receivedType, "video/webm");
});

function encodedMp4(): VexaWebVideoEncodeResult {
  return {
    kind: "encoded-video-chunks",
    targetContainer: "mp4",
    videoCodec: "h264",
    codec: "avc1.42E01E",
    width: 16,
    height: 16,
    fps: 30,
    frameCount: 2,
    durationSeconds: 2 / 30,
    decoderConfig: {
      codec: "avc1.42E01E",
      codedWidth: 16,
      codedHeight: 16,
      description: new Uint8Array([
        1, 0x42, 0xe0, 0x1e, 0xff, 0xe1, 0x00, 0x04,
        0x67, 0x42, 0xe0, 0x1e, 0x01, 0x00, 0x02, 0x68, 0xce
      ])
    },
    chunks: [
      { type: "key", timestampUs: 0, durationUs: 33_333, data: new Uint8Array([0, 0, 0, 2, 0x65, 0x88]) },
      { type: "delta", timestampUs: 33_333, durationUs: 33_333, data: new Uint8Array([0, 0, 0, 2, 0x41, 0x9a]) }
    ]
  };
}

test("muxes H.264 MP4 with preserved AVC decoder configuration", () => {
  const muxed = muxWebVideo(encodedMp4());
  assert.equal(muxed.container, "mp4");
  assert.equal(muxed.mimeType, "video/mp4");
  assert.equal(muxed.blob.type, "video/mp4");
  assert.equal(muxed.blob.size, muxed.data.byteLength);
  for (const boxType of ["ftyp", "moov", "avc1", "avcC", "moof", "mdat"]) {
    assert.equal(containsAscii(muxed.data, boxType), true, `missing MP4 box ${boxType}`);
  }
});

test("H.264 encoding preserves decoder metadata and requests AVC output", async () => {
  const { encodeWebVideoFrames } = await import("../src/index.js");
  const description = new Uint8Array([
    1, 0x42, 0xe0, 0x1e, 0xff, 0xe1, 0x00, 0x04,
    0x67, 0x42, 0xe0, 0x1e, 0x01, 0x00, 0x02, 0x68, 0xce
  ]);
  let configured: unknown;
  const runtime = {
    createVideoFrame(_source: unknown, init: { readonly timestamp: number }) {
      return { timestamp: init.timestamp, close() {} };
    },
    createVideoEncoder(callbacks: {
      readonly output: (chunk: {
        readonly type: "key" | "delta";
        readonly timestamp: number;
        readonly duration: number;
        readonly byteLength: number;
        copyTo(destination: AllowSharedBufferSource): void;
      }, metadata?: { readonly decoderConfig?: { readonly codec: string; readonly codedWidth?: number; readonly codedHeight?: number; readonly description?: AllowSharedBufferSource } }) => void;
      readonly error: (error: Error) => void;
    }) {
      return {
        encodeQueueSize: 0,
        configure(config: unknown) { configured = config; },
        encode(frame: { readonly timestamp?: number }) {
          const bytes = new Uint8Array([0, 0, 0, 2, 0x65, 0x88]);
          callbacks.output({
            type: "key",
            timestamp: frame.timestamp ?? 0,
            duration: 33_333,
            byteLength: bytes.length,
            copyTo(destination) {
              const view = ArrayBuffer.isView(destination)
                ? new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength)
                : new Uint8Array(destination);
              view.set(bytes);
            }
          }, { decoderConfig: { codec: "avc1.42E01E", codedWidth: 16, codedHeight: 16, description } });
        },
        async flush() {},
        reset() {},
        close() {}
      };
    }
  };

  const encoded = await encodeWebVideoFrames({
    plan: { kind: "browser", container: "mp4", videoCodec: "h264" },
    width: 16, height: 16, fps: 30, frameCount: 1, runtime, renderFrame() { return {}; }
  });
  description[1] = 0;
  assert.deepEqual(configured, {
    codec: "avc1.42E01E", width: 16, height: 16, bitrate: 500_000, framerate: 30,
    latencyMode: "realtime", avc: { format: "avc" }
  });
  assert.equal(encoded.decoderConfig?.description?.[1], 0x42);
  assert.equal(muxWebVideo(encoded).mimeType, "video/mp4");
});


test("encodes deterministic AAC chunks with owned decoder metadata and progress", async () => {
  const { encodeWebAudioData } = await import("../src/index.js");
  const description = new Uint8Array([0x11, 0x90]);
  const contexts: Array<{ readonly sampleOffset: number; readonly numberOfFrames: number; readonly timestampUs: number }> = [];
  const closed: number[] = [];
  const progress: Array<{ readonly phase: string; readonly completedChunks: number }> = [];
  let configured: unknown;
  const runtime = {
    createAudioEncoder(callbacks: {
      readonly output: (chunk: {
        readonly type: "key" | "delta";
        readonly timestamp: number;
        readonly duration: number;
        readonly byteLength: number;
        copyTo(destination: AllowSharedBufferSource): void;
      }, metadata?: { readonly decoderConfig?: { readonly codec: string; readonly sampleRate: number; readonly numberOfChannels: number; readonly description?: AllowSharedBufferSource } }) => void;
      readonly error: (error: Error) => void;
    }) {
      let emitted = 0;
      return {
        encodeQueueSize: 0,
        configure(config: unknown) { configured = config; },
        encode(data: { readonly timestamp: number }) {
          emitted += 1;
          const bytes = new Uint8Array([emitted, 0xaa]);
          callbacks.output({
            type: "key",
            timestamp: data.timestamp,
            duration: 21_333,
            byteLength: bytes.length,
            copyTo(destination) {
              const view = ArrayBuffer.isView(destination)
                ? new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength)
                : new Uint8Array(destination);
              view.set(bytes);
            }
          }, emitted === 1 ? { decoderConfig: { codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, description } } : undefined);
        },
        async flush() {},
        reset() {},
        close() {}
      };
    }
  };

  const encoded = await encodeWebAudioData({
    audioCodec: "aac",
    durationSeconds: 2048 / 48_000,
    sampleRate: 48_000,
    numberOfChannels: 2,
    framesPerChunk: 1_024,
    runtime,
    renderAudio(context) {
      contexts.push({ sampleOffset: context.sampleOffset, numberOfFrames: context.numberOfFrames, timestampUs: context.timestampUs });
      return { timestamp: context.timestampUs, close() { closed.push(context.chunk); } };
    },
    onProgress(value) { progress.push({ phase: value.phase, completedChunks: value.completedChunks }); }
  });
  description[0] = 0;
  assert.deepEqual(configured, {
    codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000, aac: { format: "aac" }
  });
  assert.deepEqual(contexts, [
    { sampleOffset: 0, numberOfFrames: 1_024, timestampUs: 0 },
    { sampleOffset: 1_024, numberOfFrames: 1_024, timestampUs: 21_333 }
  ]);
  assert.deepEqual(closed, [0, 1]);
  assert.equal(encoded.decoderConfig?.description?.[0], 0x11);
  assert.deepEqual(encoded.chunks.map((chunk) => [chunk.timestampUs, [...chunk.data]]), [
    [0, [1, 0xaa]],
    [21_333, [2, 0xaa]]
  ]);
  assert.deepEqual(progress, [
    { phase: "encoding", completedChunks: 1 },
    { phase: "encoding", completedChunks: 2 },
    { phase: "complete", completedChunks: 2 }
  ]);
});

test("configures raw Opus chunks with deterministic 20ms audio windows", async () => {
  const { encodeWebAudioData } = await import("../src/index.js");
  let configured: unknown;
  const rendered: number[] = [];
  const runtime = {
    createAudioEncoder() {
      return {
        encodeQueueSize: 0,
        configure(config: unknown) { configured = config; },
        encode() {},
        async flush() {},
        reset() {},
        close() {}
      };
    }
  };
  const encoded = await encodeWebAudioData({
    audioCodec: "opus", durationSeconds: 0.04, runtime,
    renderAudio(context) { rendered.push(context.numberOfFrames); return { close() {} }; }
  });
  assert.deepEqual(configured, {
    codec: "opus", sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000,
    opus: { format: "opus", frameDuration: 20_000 }
  });
  assert.deepEqual(rendered, [960, 960]);
  assert.equal(encoded.audioCodec, "opus");
});

test("audio cancellation resets the encoder and closes rendered AudioData", async () => {
  const { encodeWebAudioData, VexaWebAudioEncodeError } = await import("../src/index.js");
  const controller = new AbortController();
  let reset = false;
  let closed = false;
  const runtime = {
    createAudioEncoder() {
      return {
        encodeQueueSize: 0, configure() {}, encode() {}, async flush() {},
        reset() { reset = true; }, close() {}
      };
    }
  };
  await assert.rejects(
    encodeWebAudioData({
      audioCodec: "opus", durationSeconds: 0.02, signal: controller.signal, runtime,
      renderAudio() { controller.abort(); return { close() { closed = true; } }; }
    }),
    (error: unknown) => error instanceof VexaWebAudioEncodeError && error.code === "CANCELLED"
  );
  assert.equal(reset, true);
  assert.equal(closed, true);
});

function encodedAacAudio(): VexaWebAudioEncodeResult {
  return {
    kind: "encoded-audio-chunks",
    audioCodec: "aac",
    codec: "mp4a.40.2",
    sampleRate: 48_000,
    numberOfChannels: 2,
    durationSeconds: 3_072 / 48_000,
    decoderConfig: {
      codec: "mp4a.40.2",
      sampleRate: 48_000,
      numberOfChannels: 2,
      description: new Uint8Array([0x11, 0x90])
    },
    chunks: [
      { type: "key", timestampUs: 0, durationUs: 21_333, data: new Uint8Array([0x21, 0x10]) },
      { type: "key", timestampUs: 21_333, durationUs: 21_333, data: new Uint8Array([0x22, 0x10]) },
      { type: "key", timestampUs: 42_667, durationUs: 21_333, data: new Uint8Array([0x23, 0x10]) }
    ]
  };
}

function encodedOpusAudio(): VexaWebAudioEncodeResult {
  return {
    kind: "encoded-audio-chunks",
    audioCodec: "opus",
    codec: "opus",
    sampleRate: 48_000,
    numberOfChannels: 2,
    durationSeconds: 0.1,
    chunks: [0, 20_000, 40_000, 60_000, 80_000].map((timestampUs, index) => ({
      type: "key" as const,
      timestampUs,
      durationUs: 20_000,
      data: new Uint8Array([0xf8, index])
    }))
  };
}

test("muxes H.264 and AAC into one fragmented MP4", () => {
  const muxed = muxWebMedia(encodedMp4(), encodedAacAudio());
  assert.equal(muxed.container, "mp4");
  assert.equal(muxed.audioCodec, "aac");
  assert.equal(muxed.blob.type, "video/mp4");
  for (const marker of ["avc1", "avcC", "mp4a", "esds", "vide", "soun", "moof", "mdat"]) {
    assert.equal(containsAscii(muxed.data, marker), true, `missing MP4 A/V marker ${marker}`);
  }
});

test("muxes VP9 and Opus into one WebM with codec-private audio metadata", () => {
  const muxed = muxWebMedia(encodedWebm("vp9"), encodedOpusAudio());
  assert.equal(muxed.container, "webm");
  assert.equal(muxed.audioCodec, "opus");
  assert.equal(muxed.blob.type, "video/webm");
  assert.equal(containsAscii(muxed.data, "V_VP9"), true);
  assert.equal(containsAscii(muxed.data, "A_OPUS"), true);
  assert.equal(containsAscii(muxed.data, "OpusHead"), true);
});

test("A/V muxing rejects codec/container mismatches and excessive duration skew", () => {
  assert.throws(
    () => muxWebMedia(encodedMp4(), encodedOpusAudio()),
    (error: unknown) => error instanceof VexaWebMediaMuxError && error.code === "CONTAINER_MUX_UNSUPPORTED"
  );
  assert.throws(
    () => muxWebMedia(encodedWebm(), { ...encodedOpusAudio(), durationSeconds: 1 }),
    (error: unknown) => error instanceof VexaWebMediaMuxError && error.code === "INVALID_MUX_INPUT"
  );
});

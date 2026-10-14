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

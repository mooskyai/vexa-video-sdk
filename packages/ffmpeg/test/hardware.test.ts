import assert from "node:assert/strict";
import test from "node:test";
import { HardwareAccelerationUnavailableError } from "@vexa-video/core";
import {
  appendVideoEncoderOptions,
  parseHardwareAccelerationCapabilities,
  resolveHardwareAcceleration
} from "../src/hardware.js";

const encoders = `
Encoders:
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V..... hevc_qsv             HEVC (Intel Quick Sync Video acceleration) (codec hevc)
 V..... vp9_qsv              VP9 video (Intel Quick Sync Video acceleration) (codec vp9)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`;

const hwaccels = `
Hardware acceleration methods:
cuda
qsv
d3d11va
`;

test("hardware capability parser identifies NVIDIA and Intel encoders", () => {
  const capabilities = parseHardwareAccelerationCapabilities(encoders, hwaccels, "win32");
  assert.deepEqual(capabilities.hwaccels, ["cuda", "d3d11va", "qsv"]);
  assert.equal(capabilities.providers.find((item) => item.provider === "nvidia")?.available, true);
  assert.equal(capabilities.providers.find((item) => item.provider === "intel")?.available, true);
  assert.equal(capabilities.providers.find((item) => item.provider === "amd")?.available, false);
});

test("auto hardware selection prefers NVIDIA when runtime capability is verified", () => {
  const parsed = parseHardwareAccelerationCapabilities(encoders, hwaccels, "win32");
  const capabilities = {
    ...parsed,
    providers: parsed.providers.map((item) => ({ ...item, runtimeAvailable: item.provider === "nvidia" }))
  };
  const decision = resolveHardwareAcceleration("h264", "auto", capabilities);
  assert.equal(decision.selected, "nvidia");
  assert.equal(decision.encoder, "h264_nvenc");
  assert.equal(decision.hardware, true);
});

test("explicit unavailable hardware falls back to CPU by default", () => {
  const parsed = parseHardwareAccelerationCapabilities(encoders, hwaccels, "win32");
  const capabilities = {
    ...parsed,
    providers: parsed.providers.map((item) => ({ ...item, runtimeAvailable: false }))
  };
  const decision = resolveHardwareAcceleration("h264", "nvidia", capabilities);
  assert.equal(decision.selected, "cpu");
  assert.equal(decision.encoder, "libx264");
  assert.equal(decision.fallback, true);
});

test("explicit unavailable hardware can disable CPU fallback", () => {
  const parsed = parseHardwareAccelerationCapabilities(encoders, hwaccels, "win32");
  const capabilities = {
    ...parsed,
    providers: parsed.providers.map((item) => ({ ...item, runtimeAvailable: false }))
  };
  assert.throws(
    () => resolveHardwareAcceleration("h264", "nvidia", capabilities, false),
    HardwareAccelerationUnavailableError
  );
});

test("NVENC quality and preset options are translated from backend-neutral settings", () => {
  const parsed = parseHardwareAccelerationCapabilities(encoders, hwaccels, "win32");
  const capabilities = {
    ...parsed,
    providers: parsed.providers.map((item) => ({ ...item, runtimeAvailable: item.provider === "nvidia" }))
  };
  const decision = resolveHardwareAcceleration("h264", "nvidia", capabilities, false);
  const args: string[] = [];
  appendVideoEncoderOptions(args, decision, {
    crf: 22,
    preset: "fast",
    pixelFormat: "yuv420p",
    videoBitrate: "4M"
  });
  assert.deepEqual(args, [
    "-c:v", "h264_nvenc",
    "-cq", "22",
    "-preset", "p4",
    "-pix_fmt", "yuv420p",
    "-b:v", "4M"
  ]);
});

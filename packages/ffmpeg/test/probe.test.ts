import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProbeResult, parseFrameRate } from "../src/probe.js";

test("parseFrameRate parses common fractional frame rates", () => {
  assert.equal(parseFrameRate("30000/1001")?.toFixed(3), "29.970");
  assert.equal(parseFrameRate("24/1"), 24);
  assert.equal(parseFrameRate("0/0"), null);
});

test("normalizeProbeResult returns backend-neutral media metadata", () => {
  const result = normalizeProbeResult("sample.mp4", {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "12.5",
      size: "1000000",
      bit_rate: "640000"
    },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30000/1001",
        pix_fmt: "yuv420p",
        bit_rate: "500000",
        side_data_list: [{ rotation: 90 }]
      },
      {
        index: 1,
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        bit_rate: "128000"
      }
    ]
  });

  assert.equal(result.durationSeconds, 12.5);
  assert.equal(result.video?.codec, "h264");
  assert.equal(result.video?.width, 1920);
  assert.equal(result.video?.rotation, 90);
  assert.equal(result.audio?.codec, "aac");
  assert.equal(result.audio?.sampleRate, 48000);
});

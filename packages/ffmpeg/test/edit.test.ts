import assert from "node:assert/strict";
import test from "node:test";
import { InvalidOperationError } from "@moosky-video/core";
import {
  compileExportArgs,
  compileExtractAudioArgs,
  compileThumbnailArgs
} from "../src/edit.js";

const operations = [
  { type: "trim", options: { start: 5, duration: 20 } },
  { type: "resize", options: { width: 1280, height: 720, fit: "contain" } },
  { type: "crop", options: { width: 1000, height: 600 } },
  { type: "rotate", options: { degrees: 90 } }
] as const;

test("compileExportArgs compiles chained operations into one ffmpeg invocation", () => {
  assert.deepEqual(
    compileExportArgs("input.mp4", operations, "output.mp4", {
      crf: 20,
      preset: "fast",
      audioBitrate: "192k"
    }),
    [
      "-y",
      "-i",
      "input.mp4",
      "-ss",
      "5",
      "-t",
      "20",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,crop=1000:600:(iw-ow)/2:(ih-oh)/2,transpose=clock",
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "fast",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "output.mp4"
    ]
  );
});

test("compileExportArgs rejects stream copy when video filters require encoding", () => {
  assert.throws(
    () =>
      compileExportArgs(
        "input.mp4",
        [{ type: "resize", options: { width: 1280, height: 720 } }],
        "output.mp4",
        { videoCodec: "copy" }
      ),
    InvalidOperationError
  );
});

test("compileThumbnailArgs uses trim start as the thumbnail timeline origin", () => {
  assert.deepEqual(
    compileThumbnailArgs(
      "input.mp4",
      [{ type: "trim", options: { start: 10, duration: 15 } }],
      "thumb.jpg",
      { at: 3, quality: 2 }
    ),
    ["-y", "-ss", "13", "-i", "input.mp4", "-frames:v", "1", "-q:v", "2", "thumb.jpg"]
  );
});

test("compileExtractAudioArgs applies trim and selected codec", () => {
  assert.deepEqual(
    compileExtractAudioArgs(
      "input.mp4",
      [{ type: "trim", options: { start: 2, duration: 8 } }],
      "audio.opus",
      { codec: "opus", bitrate: "160k" }
    ),
    [
      "-y",
      "-i",
      "input.mp4",
      "-ss",
      "2",
      "-t",
      "8",
      "-vn",
      "-c:a",
      "libopus",
      "-b:a",
      "160k",
      "audio.opus"
    ]
  );
});

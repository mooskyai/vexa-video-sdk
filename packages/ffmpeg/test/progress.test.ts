import assert from "node:assert/strict";
import test from "node:test";
import { FfmpegProgressParser } from "../src/progress.js";

test("FfmpegProgressParser handles chunked progress output and calculates percent", () => {
  const updates = [] as Array<{ percent: number | null; status: string; processedSeconds: number }>;
  const parser = new FfmpegProgressParser(20);

  parser.push("frame=120\nfps=60.0\nout_time_us=5000000\nspeed=2.0x\npro", (progress) => {
    updates.push(progress);
  });
  parser.push("gress=continue\nframe=480\nout_time_us=20000000\nprogress=end\n", (progress) => {
    updates.push(progress);
  });

  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.processedSeconds, 5);
  assert.equal(updates[0]?.percent, 25);
  assert.equal(updates[0]?.status, "continue");
  assert.equal(updates[1]?.percent, 100);
  assert.equal(updates[1]?.status, "end");
});

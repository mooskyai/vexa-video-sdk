import assert from "node:assert/strict";
import test from "node:test";
import { InvalidOperationError, normalizeVideoOperations } from "../src/index.js";

test("normalizeVideoOperations makes the pipeline deterministic", () => {
  const operations = normalizeVideoOperations([
    { type: "trim", options: { start: 0 } },
    { type: "resize", options: { width: 1280, height: 720 } },
    { type: "rotate", options: { degrees: -90 } },
    { type: "rotate", options: { degrees: 360 } }
  ]);

  assert.deepEqual(operations, [
    { type: "resize", options: { width: 1280, height: 720, fit: "contain" } },
    { type: "rotate", options: { degrees: 270 } }
  ]);
});

test("normalizeVideoOperations rejects multiple effective trim operations", () => {
  assert.throws(
    () => normalizeVideoOperations([
      { type: "trim", options: { start: 1, duration: 5 } },
      { type: "trim", options: { start: 2, duration: 3 } }
    ]),
    InvalidOperationError
  );
});

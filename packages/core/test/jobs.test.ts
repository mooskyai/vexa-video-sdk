import assert from "node:assert/strict";
import test from "node:test";
import { jobRetryDelay, normalizeJobRetryPolicy } from "../src/jobs.js";

test("job retry policy normalizes deterministic defaults", () => {
  assert.deepEqual(normalizeJobRetryPolicy(), {
    maxAttempts: 1,
    backoffMs: 1_000,
    backoffMultiplier: 2,
    maxBackoffMs: 30_000
  });
});

test("job retry delay uses capped exponential backoff", () => {
  const policy = normalizeJobRetryPolicy({
    maxAttempts: 5,
    backoffMs: 100,
    backoffMultiplier: 3,
    maxBackoffMs: 700
  });
  assert.equal(jobRetryDelay(policy, 1), 100);
  assert.equal(jobRetryDelay(policy, 2), 300);
  assert.equal(jobRetryDelay(policy, 3), 700);
  assert.equal(jobRetryDelay(policy, 4), 700);
});

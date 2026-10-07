import assert from "node:assert/strict";
import test from "node:test";
import { renameDirectoryWithRetry } from "../src/fs-retry.js";

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`rename failed: ${code}`), { code });
}

test("Windows directory promotion retries transient rename failures", async () => {
  let calls = 0;
  const delays: number[] = [];

  await renameDirectoryWithRetry("stage", "output", {
    platform: "win32",
    attempts: 4,
    baseDelayMs: 5,
    renameImpl: async () => {
      calls += 1;
      if (calls < 3) throw codedError("EPERM");
    },
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    }
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
});

test("non-Windows rename failures are not retried", async () => {
  let calls = 0;

  await assert.rejects(
    () => renameDirectoryWithRetry("stage", "output", {
      platform: "linux",
      attempts: 4,
      renameImpl: async () => {
        calls += 1;
        throw codedError("EPERM");
      },
      sleepImpl: async () => {
        throw new Error("sleep should not run");
      }
    }),
    /rename failed: EPERM/
  );

  assert.equal(calls, 1);
});

test("Windows rename retries are bounded and preserve the terminal error", async () => {
  let calls = 0;
  const delays: number[] = [];

  await assert.rejects(
    () => renameDirectoryWithRetry("stage", "output", {
      platform: "win32",
      attempts: 3,
      baseDelayMs: 2,
      renameImpl: async () => {
        calls += 1;
        throw codedError("EBUSY");
      },
      sleepImpl: async (delayMs) => {
        delays.push(delayMs);
      }
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EBUSY"
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [2, 4]);
});

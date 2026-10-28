import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { MediaWorkspace } from "../src/storage.ts";

const root = await mkdtemp(join(tmpdir(), "vexa-workspace-crash-"));
const prefix = `vexa-workspace-${randomUUID().replaceAll("-", "").slice(0,12)}-`;
const fixture = fileURLToPath(new URL("./fixtures/workspace-crash-worker.mjs", import.meta.url));
const children = new Set();
const age = new Date(Date.now() - 5 * 60_000);

function startWorker() {
  return new Promise((resolve, reject) => {
    const child = fork(fixture, [root, prefix], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    children.add(child);
    let detail = "";
    child.stderr?.on("data", chunk => { detail = (detail + chunk.toString()).slice(-2_000); });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Workspace worker readiness timed out."));
    }, 15_000);
    const settle = (action, value) => {
      clearTimeout(timeout);
      child.off("exit", exitBeforeReady);
      child.off("error", fail);
      child.off("message", onMessage);
      action(value);
    };
    const fail = error => settle(reject, error);
    const exitBeforeReady = (code, signal) => settle(reject,
      new Error(`Workspace worker exited before readiness (${code ?? signal}): ${detail}`));
    const onMessage = message => {
      if (message?.kind === "ready") settle(resolve, { child, ...message });
    };
    child.once("error", fail);
    child.once("exit", exitBeforeReady);
    child.on("message", onMessage);
  });
}

function stopWorker(worker, mode = "kill") {
  const { child } = worker;
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Workspace worker exit timed out."));
    }, 10_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      children.delete(child);
      if (mode === "cancel" && code !== 0) reject(new Error(`Cleanup exit was ${code ?? signal}.`));
      else resolve();
    });
    if (mode === "cancel") child.send("cancel");
    else child.kill("SIGKILL");
  });
}

async function missing(path) {
  await assert.rejects(access(path), { code: "ENOENT" });
}

after(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(root, { recursive: true, force: true });
});

test("V3.1q worker death leaves real media for guarded dry-run then explicit recovery", { timeout: 30_000 }, async () => {
  const worker = await startWorker();
  assert.ok((await stat(worker.artifact)).size > 0);
  await stopWorker(worker);
  assert.ok((await readFile(worker.artifact)).length > 0);
  await utimes(worker.workspace, age, age);
  const options = { root, prefix, minAgeMs: 60_000,
    confirmAbandoned: async (path) => path === worker.workspace };
  const preview = await MediaWorkspace.reclaimAbandoned(options);
  assert.deepEqual(preview.eligiblePaths, [worker.workspace]);
  assert.deepEqual(preview.removedPaths, []);
  assert.ok((await stat(worker.workspace)).isDirectory());
  const removed = await MediaWorkspace.reclaimAbandoned({ ...options, dryRun: false });
  assert.deepEqual(removed.removedPaths, [worker.workspace]);
  await missing(worker.workspace);
  assert.deepEqual((await MediaWorkspace.reclaimAbandoned(options)).eligiblePaths, []);
});

test("V3.1q restart keeps an active but artificially old workspace protected", { timeout: 40_000 }, async () => {
  const previous = await startWorker();
  await stopWorker(previous);
  const replacement = await startWorker();
  try {
    await utimes(previous.workspace, age, age);
    await utimes(replacement.workspace, age, age);
    const options = { root, prefix, minAgeMs: 60_000,
      confirmAbandoned: path => path === previous.workspace };
    const preview = await MediaWorkspace.reclaimAbandoned(options);
    assert.deepEqual(preview.eligiblePaths, [previous.workspace]);
    const result = await MediaWorkspace.reclaimAbandoned({ ...options, dryRun: false });
    assert.deepEqual(result.removedPaths, [previous.workspace]);
    assert.ok((await stat(replacement.workspace)).isDirectory());
    assert.ok((await stat(replacement.artifact)).size > 0);
  } finally {
    await stopWorker(replacement, "cancel");
    await missing(replacement.workspace);
  }
});

test("V3.1q live cancellation performs normal workspace cleanup", { timeout: 30_000 }, async () => {
  const running = await startWorker();
  await stopWorker(running, "cancel");
  await missing(running.workspace);
});

test("V3.1q abandoned-workspace authority failure does not permit cleanup", { timeout: 30_000 }, async () => {
  const crashed = await startWorker();
  await stopWorker(crashed);
  await utimes(crashed.workspace, age, age);
  const options = { root, prefix, minAgeMs: 60_000, dryRun: false };
  const denied = await MediaWorkspace.reclaimAbandoned({
    ...options, confirmAbandoned: () => false
  });
  assert.deepEqual(denied.removedPaths, []);
  await assert.rejects(() => MediaWorkspace.reclaimAbandoned({
    ...options, confirmAbandoned: () => { throw new Error("lease service unavailable"); }
  }), /lease service unavailable/);
  assert.ok((await stat(crashed.workspace)).isDirectory());
  const cleanup = await MediaWorkspace.reclaimAbandoned({
    ...options, confirmAbandoned: () => true
  });
  assert.deepEqual(cleanup.removedPaths, [crashed.workspace]);
});

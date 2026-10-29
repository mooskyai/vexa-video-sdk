import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MediaWorkspace, RedisWorkspaceQuiescence } from "../src/index.js";
import { LiveRedisClient, liveRedisAddress, removeTestKeys } from "./live-redis-client.js";

liveRedisAddress();
const prefix = `vexa:workspace:acceptance:${randomUUID().replaceAll("-", "")}`;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function withWorkspace(run: (path: string, root: string, authority: RedisWorkspaceQuiescence,
  client: LiveRedisClient) => Promise<void>): Promise<void> {
  const client = await LiveRedisClient.open();
  const root = await mkdtemp(join(tmpdir(), "vexa-workspace-redis-"));
  const authority = new RedisWorkspaceQuiescence(client, { prefix });
  try {
    const workspace = await MediaWorkspace.create({ root, prefix: "vexa-owned-" });
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(workspace.path, old, old);
    await run(workspace.path, root, authority, client);
  } finally {
    client.close();
    const cleanupClient = await LiveRedisClient.open();
    try { await removeTestKeys(cleanupClient, prefix); } finally { cleanupClient.close(); }
    await rm(root, { recursive: true, force: true });
  }
}

const cleanup = (root: string, authority: RedisWorkspaceQuiescence, confirmAbandoned = async () => true) =>
  ({ root, prefix: "vexa-owned-", minAgeMs: 60_000, dryRun: false,
     quiescence: authority, confirmAbandoned });

test("V3.1t live Redis fences active producer and consumer ownership", { concurrency: false }, async () => {
  await withWorkspace(async (path, root, authority) => {
    const producer = await authority.acquire(path, 3_000);
    const consumer = await authority.acquire(path, 3_000);
    assert.equal(await authority.inspect(path), false);
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned(cleanup(root, authority))).removedPaths, []);
    assert.equal(await authority.renew(path, producer, 3_000), true);
    await authority.release(path, producer);
    assert.equal(await authority.inspect(path), false);
    await authority.release(path, consumer);
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned(cleanup(root, authority))).removedPaths, [path]);
    await assert.rejects(() => authority.acquire(path, 3_000), /admission denied/);
  });
});

test("V3.1t live Redis expired owner is fenced and replacement worker keeps workspace", { concurrency: false }, async () => {
  await withWorkspace(async (path, root, authority) => {
    const oldToken = await authority.acquire(path, 1_000);
    await sleep(1_100);
    assert.equal(await authority.renew(path, oldToken, 2_000), false);
    const replacement = await authority.acquire(path, 3_000);
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned(cleanup(root, authority))).removedPaths, []);
    await authority.release(path, replacement);
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned(cleanup(root, authority))).removedPaths, [path]);
  });
});

test("V3.1t live Redis closes admission atomically during cleanup", { concurrency: false }, async () => {
  await withWorkspace(async (path, root, authority) => {
    let attempts = 0;
    const opts = cleanup(root, authority, async () => {
      if (++attempts === 2) await assert.rejects(() => authority.acquire(path, 2_000), /admission denied/);
      return true;
    });
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned(opts)).removedPaths, [path]);
    assert.equal(attempts, 2);
    await assert.rejects(() => authority.acquire(path, 2_000), /admission denied/);
  });
});

test("V3.1t live Redis reopens admission only for a clean, denied pre-delete reservation", { concurrency: false }, async () => {
  await withWorkspace(async (path, root, authority) => {
    let attempts = 0;
    const denied = await MediaWorkspace.reclaimAbandoned(cleanup(root, authority,
      async () => ++attempts === 1));
    assert.deepEqual(denied.removedPaths, []);
    assert.ok((await stat(path)).isDirectory());
    const token = await authority.acquire(path, 2_000);
    await authority.release(path, token);
  });
});

test("V3.1t live Redis ownership service outage fails closed", { concurrency: false }, async () => {
  await withWorkspace(async (path, root, authority, client) => {
    client.close();
    await assert.rejects(() => MediaWorkspace.reclaimAbandoned(cleanup(root, authority)),
      /ownership check failed closed/);
    assert.ok((await stat(path)).isDirectory());
  });
});


test("V3.1t live Redis + FFmpeg: killed enrolled producer leaves artifact and expires before guarded reclamation",
  { concurrency: false, timeout: 30_000 }, async () => {
    const client = await LiveRedisClient.open();
    const root = await mkdtemp(join(tmpdir(), "vexa-workspace-live-crash-"));
    const authority = new RedisWorkspaceQuiescence(client, { prefix });
    const fixture = fileURLToPath(new URL("./fixtures/workspace-quiescence-crash-worker.mjs", import.meta.url));
    const child = fork(fixture, [root, "vexa-owned-", prefix], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    let stderr = "";
    child.stderr?.on("data", data => { stderr = (stderr + String(data)).slice(-2_000); });
    try {
      const { workspace, artifact } = await new Promise<{ workspace: string; artifact: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Enrolled crash worker timed out: ${stderr}`)), 15_000);
        const fail = (error: Error) => { clearTimeout(timer); reject(error); };
        child.once("error", fail);
        child.once("exit", (code) => fail(new Error(`Enrolled worker exited early (${code}): ${stderr}`)));
        child.on("message", (message: unknown) => {
          if (!message || typeof message !== "object" || !("kind" in message) || message.kind !== "ready") return;
          if (!("workspace" in message) || typeof message.workspace !== "string"
            || !("artifact" in message) || typeof message.artifact !== "string") return;
          clearTimeout(timer);
          resolve({ workspace: message.workspace, artifact: message.artifact });
        });
      });
      assert.ok((await stat(artifact)).size > 0);
      const old = new Date(Date.now() - 5 * 60_000);
      await utimes(workspace, old, old);
      assert.deepEqual((await MediaWorkspace.reclaimAbandoned(cleanup(root, authority))).removedPaths, []);
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
      assert.ok((await stat(artifact)).size > 0);
      // Do not treat an expired token alone as authority: the child has exited,
      // and only this isolated test workspace exists in the test root.
      await sleep(1_700);
      const result = await MediaWorkspace.reclaimAbandoned(cleanup(root, authority,
        async path => path === workspace && (child.exitCode !== null || child.signalCode !== null)));
      assert.deepEqual(result.removedPaths, [workspace]);
      await assert.rejects(() => stat(workspace), { code: "ENOENT" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await removeTestKeys(client, prefix);
      client.close();
      await rm(root, { recursive: true, force: true });
    }
  });


test("V3.1t live Redis loss after external confirmation blocks filesystem deletion",
  { concurrency: false }, async () => {
    await withWorkspace(async (path, root, authority, client) => {
      let checks = 0;
      await assert.rejects(() => MediaWorkspace.reclaimAbandoned(cleanup(root, authority, async () => {
        if (++checks === 2) client.close(); // after exclusive seal, before final CAS check
        return true;
      })), /ownership check failed closed/);
      assert.equal(checks, 2);
      assert.ok((await stat(path)).isDirectory());
    });
  });

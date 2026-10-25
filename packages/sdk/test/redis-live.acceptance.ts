import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DistributedJobQueue, RedisJobTransport } from "../src/index.js";
import { LiveRedisClient, liveRedisAddress, removeTestKeys } from "./live-redis-client.js";

// No silent skip: this explicit suite must run against a real, dedicated Redis server.
liveRedisAddress();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const prefix = `vexa:acceptance:${randomUUID().replaceAll("-", "")}`;
const queueName = "real-redis";

async function withRedis<T>(run: (client: LiveRedisClient, transport: RedisJobTransport) => Promise<T>): Promise<T> {
  const client = await LiveRedisClient.open();
  try {
    return await run(client, new RedisJobTransport(client, {
      prefix, queue: queueName, recoveryIntervalMs: 100, recoveryBatchSize: 100
    }));
  } finally {
    client.close();
  }
}

async function claimInTerminatedProcess(jobId: string): Promise<string> {
  const workerScript = fileURLToPath(new URL("./fixtures/live-redis-claim-worker.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", workerScript, prefix, queueName, jobId], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: process.env
  });
  let stderr = "";
  child.stderr!.on("data", (data: Buffer) => { stderr += data.toString(); });
  let captured = "";
  const claimed = new Promise<string>((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`Crash worker did not claim within 10 seconds: ${stderr}`)), 10_000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Crash worker exited before claim: ${code}; ${stderr}`)));
    child.stdout!.on("data", (data: Buffer) => {
      stdout += data.toString();
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      try {
        const record = JSON.parse(stdout.slice(0, newline)) as { id: string; claimId: string };
        assert.equal(record.id, jobId);
        assert.ok(record.claimId);
        captured = record.claimId;
        clearTimeout(timer);
        resolve(captured);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  try {
    return await claimed;
  } finally {
    await killChild(child);
  }
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

// These four tests share the unique prefix and intentionally run serially in this file.
test("live Redis: concurrent claims have one owner and stale tokens cannot commit", { concurrency: false, timeout: 15_000 }, async () => {
  await withRedis(async (client, transport) => {
    const second = await LiveRedisClient.open();
    try {
      const rival = new RedisJobTransport(second, { prefix, queue: queueName });
      const submitted = await new DistributedJobQueue(transport).submit("live.dual", {});
      const [a, b] = await Promise.all([transport.claim("worker-a", 20, 600), rival.claim("worker-b", 20, 600)]);
      assert.equal(Number(Boolean(a)) + Number(Boolean(b)), 1);
      const owner = a ?? b;
      assert.ok(owner?.lease);
      const ownerTransport = a ? transport : rival;
      const replacementTransport = a ? rival : transport;
      const token = owner.lease.claimId;
      await ownerTransport.heartbeat(submitted.descriptor.id, token, owner.lease.workerId, 600);
      await sleep(700);
      assert.equal((await replacementTransport.recoverStaleClaims()).requeued, 1);
      await assert.rejects(() => ownerTransport.save(owner, token), /lease is no longer valid/i);
      const replacement = await replacementTransport.claim("replacement", 30, 600);
      assert.equal(replacement?.descriptor.id, submitted.descriptor.id);
      assert.notEqual(replacement?.lease?.claimId, token);
      replacement!.state = "succeeded";
      replacement!.result = { ok: true };
      await replacementTransport.finish(replacement!, replacement!.lease!.claimId);
      assert.equal((await transport.get(submitted.descriptor.id))?.state, "succeeded");
      assert.equal((await client.sendCommand(["LLEN", `${prefix}:${queueName}:queue`])), 0);
    } finally { second.close(); }
  });
});

test("live Redis: terminated worker claim is recovered and fenced", { concurrency: false, timeout: 20_000 }, async () => {
  await withRedis(async (_client, transport) => {
    const job = await new DistributedJobQueue(transport).submit("live.crash", {}, { retry: { maxAttempts: 2 } });
    const staleToken = await claimInTerminatedProcess(job.descriptor.id);
    await sleep(450);
    assert.equal((await transport.recoverStaleClaims()).requeued, 1);
    const current = await transport.claim("replacement", 30, 600);
    assert.equal(current?.descriptor.id, job.descriptor.id);
    assert.notEqual(current?.lease?.claimId, staleToken);
    await assert.rejects(() => transport.finish(current!, staleToken), /lease is no longer valid/i);
    current!.state = "succeeded";
    await transport.finish(current!, current!.lease!.claimId);
    assert.equal((await transport.get(job.descriptor.id))?.state, "succeeded");
  });
});

test("live Redis: cancellation after worker death cannot resurrect a claim", { concurrency: false, timeout: 20_000 }, async () => {
  await withRedis(async (_client, transport) => {
    const job = await new DistributedJobQueue(transport).submit("live.cancel", {});
    await claimInTerminatedProcess(job.descriptor.id);
    const requested = await transport.cancel(job.descriptor.id);
    assert.equal(requested?.cancellationRequested, true);
    await sleep(450);
    assert.equal((await transport.recoverStaleClaims()).cancelled, 1);
    assert.equal((await transport.get(job.descriptor.id))?.state, "cancelled");
    assert.equal(await transport.claim("replacement", 20, 600), null);
  });
});

test("live Redis: concurrent due-retry reconciliation promotes a job once", { concurrency: false, timeout: 15_000 }, async () => {
  await withRedis(async (client, transport) => {
    const other = await LiveRedisClient.open();
    try {
      const rival = new RedisJobTransport(other, { prefix, queue: queueName });
      const job = await new DistributedJobQueue(transport).submit("live.retry", {}, { retry: { maxAttempts: 2 } });
      const owner = await transport.claim("retry-initial", 20, 600);
      assert.equal(owner?.descriptor.id, job.descriptor.id);
      owner!.state = "retrying";
      owner!.attempt = 1;
      await transport.scheduleRetry(owner!, Date.now() - 1, owner!.lease!.claimId);
      const results = await Promise.all([transport.reconcileDueRetries(), rival.reconcileDueRetries()]);
      assert.equal(results.reduce((sum, item) => sum + item.promoted, 0), 1);
      assert.equal((await client.sendCommand(["LLEN", `${prefix}:${queueName}:queue`])), 1);
      const next = await rival.claim("retry-replacement", 20, 600);
      assert.equal(next?.descriptor.id, job.descriptor.id);
      assert.equal(next?.attempt, 1);
      next!.state = "succeeded";
      await rival.finish(next!, next!.lease!.claimId);
      assert.equal((await transport.get(job.descriptor.id))?.state, "succeeded");
    } finally { other.close(); }
  });
});

test.after(async () => {
  const client = await LiveRedisClient.open();
  try { await removeTestKeys(client, prefix); }
  finally { client.close(); }
});

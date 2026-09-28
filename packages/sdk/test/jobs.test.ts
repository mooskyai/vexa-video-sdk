import assert from "node:assert/strict";
import test from "node:test";
import type { JobSnapshot } from "@moosky-video/core";
import { JobIdempotencyConflictError, isTerminalJobState } from "@moosky-video/core";
import {
  DistributedJobQueue,
  DistributedJobWorker,
  JobQueue,
  RedisJobTransport,
  type DistributedJobTransport,
  type RedisCommandClient
} from "../src/index.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("local job queue executes work and publishes progress", async () => {
  const queue = new JobQueue({ concurrency: 1, workerId: "test-worker" });
  const events: string[] = [];
  queue.onEvent((event) => events.push(event.type));
  queue.register<{ value: number }, { doubled: number }>("math.double", async (payload, context) => {
    await context.reportProgress({ percent: 50, phase: "compute" });
    return { doubled: payload.value * 2 };
  });

  const handle = queue.submit<{ value: number }, { doubled: number }>("math.double", { value: 21 });
  assert.deepEqual(await handle.result(), { doubled: 42 });
  const snapshot = handle.snapshot();
  assert.equal(snapshot.state, "succeeded");
  assert.equal(snapshot.attempt, 1);
  assert.equal(snapshot.workerId, "test-worker");
  assert.equal(snapshot.progress?.percent, 100);
  assert.ok(events.includes("submitted"));
  assert.ok(events.includes("progress"));
  assert.ok(events.includes("succeeded"));
});

test("local job idempotency reuses identical work and rejects conflicts", async () => {
  const queue = new JobQueue();
  let executions = 0;
  queue.register<{ value: number }, number>("idempotent.work", async ({ value }) => {
    executions += 1;
    return value;
  });

  const first = queue.submit("idempotent.work", { value: 7 }, { idempotencyKey: "order-7" });
  const second = queue.submit("idempotent.work", { value: 7 }, { idempotencyKey: "order-7" });
  assert.equal(second.id, first.id);
  assert.equal(await first.result(), 7);
  assert.equal(await second.result(), 7);
  assert.equal(executions, 1);

  assert.throws(
    () => queue.submit("idempotent.work", { value: 8 }, { idempotencyKey: "order-7" }),
    JobIdempotencyConflictError
  );
});

test("local job retries with bounded attempts", async () => {
  const queue = new JobQueue();
  let attempts = 0;
  queue.register("unstable.work", async () => {
    attempts += 1;
    if (attempts < 2) throw new Error("temporary");
    return { attempts };
  });

  const handle = queue.submit("unstable.work", {}, {
    retry: { maxAttempts: 3, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 }
  });
  assert.deepEqual(await handle.result(), { attempts: 2 });
  assert.equal(handle.snapshot().attempt, 2);
});

test("local running jobs can be cancelled through AbortSignal", async () => {
  const queue = new JobQueue();
  queue.register("slow.work", async (_payload, context) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1_000);
      context.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    return "done";
  });

  const handle = queue.submit("slow.work", {});
  while (handle.snapshot().state !== "running") await sleep(1);
  assert.equal(handle.cancel(), true);
  const terminal = await handle.wait();
  assert.equal(terminal.state, "cancelled");
  assert.equal(terminal.cancellationRequested, true);
});

test("local worker pool respects configured concurrency", async () => {
  const queue = new JobQueue({ concurrency: 2 });
  let active = 0;
  let maximum = 0;
  queue.register<{ delay: number }, number>("pool.work", async ({ delay }) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await sleep(delay);
    active -= 1;
    return delay;
  });

  const jobs = [
    queue.submit("pool.work", { delay: 25 }),
    queue.submit("pool.work", { delay: 25 }),
    queue.submit("pool.work", { delay: 25 })
  ];
  await Promise.all(jobs.map((job) => job.result()));
  assert.equal(maximum, 2);
});

class MemoryTransport implements DistributedJobTransport {
  readonly jobs = new Map<string, JobSnapshot>();
  readonly queue: string[] = [];
  readonly cancellation = new Set<string>();
  readonly idempotency = new Map<string, { fingerprint: string; jobId: string }>();

  async submit(snapshot: JobSnapshot, fingerprint: string): Promise<JobSnapshot> {
    const key = snapshot.descriptor.idempotencyKey;
    if (key) {
      const existing = this.idempotency.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new JobIdempotencyConflictError(key);
        return structuredClone(this.jobs.get(existing.jobId)!);
      }
      this.idempotency.set(key, { fingerprint, jobId: snapshot.descriptor.id });
    }
    this.jobs.set(snapshot.descriptor.id, structuredClone(snapshot));
    this.queue.push(snapshot.descriptor.id);
    return structuredClone(snapshot);
  }

  async get(jobId: string): Promise<JobSnapshot | null> {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async claim(_workerId: string, waitMs: number): Promise<JobSnapshot | null> {
    const id = this.queue.shift();
    if (!id) {
      await sleep(Math.min(waitMs, 5));
      return null;
    }
    return await this.get(id);
  }

  async save(snapshot: JobSnapshot): Promise<void> {
    this.jobs.set(snapshot.descriptor.id, structuredClone(snapshot));
  }

  async finish(snapshot: JobSnapshot): Promise<void> {
    this.jobs.set(snapshot.descriptor.id, structuredClone(snapshot));
    this.cancellation.delete(snapshot.descriptor.id);
  }

  async scheduleRetry(snapshot: JobSnapshot, availableAtMs: number): Promise<void> {
    this.jobs.set(snapshot.descriptor.id, structuredClone(snapshot));
    const delay = Math.max(0, availableAtMs - Date.now());
    setTimeout(() => this.queue.push(snapshot.descriptor.id), delay);
  }

  async cancel(jobId: string): Promise<JobSnapshot | null> {
    const snapshot = this.jobs.get(jobId);
    if (!snapshot || isTerminalJobState(snapshot.state)) return snapshot ? structuredClone(snapshot) : null;
    const queuedIndex = this.queue.indexOf(jobId);
    snapshot.cancellationRequested = true;
    snapshot.updatedAt = new Date().toISOString();
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      snapshot.state = "cancelled";
      snapshot.completedAt = new Date().toISOString();
    } else {
      this.cancellation.add(jobId);
    }
    this.jobs.set(jobId, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    return this.cancellation.has(jobId);
  }
}

test("distributed queue and worker share the same serializable job contract", async () => {
  const transport = new MemoryTransport();
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    workerId: "distributed-test",
    claimWaitMs: 10,
    cancellationPollMs: 10
  });
  worker.register<{ value: number }, { value: number }>("distributed.echo", async (payload, context) => {
    await context.reportProgress({ percent: 80, phase: "echo" });
    return payload;
  });
  worker.start();

  const submitted = await queue.submit<{ value: number }, { value: number }>(
    "distributed.echo",
    { value: 12 },
    { idempotencyKey: "echo-12" }
  );
  const reused = await queue.submit("distributed.echo", { value: 12 }, { idempotencyKey: "echo-12" });
  assert.equal(reused.descriptor.id, submitted.descriptor.id);

  const terminal = await queue.wait<{ value: number }, { value: number }>(submitted.descriptor.id, {
    pollIntervalMs: 10,
    timeoutMs: 1_000
  });
  assert.equal(terminal.state, "succeeded");
  assert.deepEqual(terminal.result, { value: 12 });
  assert.equal(terminal.workerId, "distributed-test");
  await worker.stop();
});

class FakeRedis implements RedisCommandClient {
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly sorted = new Map<string, Map<string, number>>();

  async sendCommand(args: readonly string[]): Promise<unknown> {
    const command = args[0]?.toUpperCase();
    if (command === "GET") return this.strings.get(args[1]!) ?? null;
    if (command === "SET") {
      this.strings.set(args[1]!, args[2]!);
      return "OK";
    }
    if (command === "DEL") return this.strings.delete(args[1]!) ? 1 : 0;
    if (command === "LPUSH") {
      const list = this.lists.get(args[1]!) ?? [];
      list.unshift(...args.slice(2));
      this.lists.set(args[1]!, list);
      return list.length;
    }
    if (command === "LREM") {
      const key = args[1]!;
      const value = args[3]!;
      const list = this.lists.get(key) ?? [];
      const kept = list.filter((item) => item !== value);
      this.lists.set(key, kept);
      return list.length - kept.length;
    }
    if (command === "ZREM") {
      return this.sorted.get(args[1]!)?.delete(args[2]!) ? 1 : 0;
    }
    if (command === "BRPOPLPUSH") {
      const source = this.lists.get(args[1]!) ?? [];
      const value = source.pop();
      this.lists.set(args[1]!, source);
      if (!value) {
        await sleep(5);
        return null;
      }
      const destination = this.lists.get(args[2]!) ?? [];
      destination.unshift(value);
      this.lists.set(args[2]!, destination);
      return value;
    }
    if (command === "EVAL") return this.eval(args);
    throw new Error(`Unsupported fake Redis command: ${command}`);
  }

  private eval(args: readonly string[]): unknown {
    const script = args[1]!;
    const keyCount = Number(args[2]);
    const keys = args.slice(3, 3 + keyCount);
    const argv = args.slice(3 + keyCount);

    if (script.includes("local existing = redis.call('GET', KEYS[3])")) {
      const existing = this.strings.get(keys[2]!);
      if (existing) return existing;
      this.strings.set(keys[0]!, argv[0]!);
      this.strings.set(keys[2]!, `${argv[1]}|${argv[2]}`);
      const list = this.lists.get(keys[1]!) ?? [];
      list.unshift(argv[2]!);
      this.lists.set(keys[1]!, list);
      return `CREATED|${argv[2]}`;
    }
    if (script.includes("redis.call('LPUSH', KEYS[2], ARGV[2])")) {
      this.strings.set(keys[0]!, argv[0]!);
      const list = this.lists.get(keys[1]!) ?? [];
      list.unshift(argv[1]!);
      this.lists.set(keys[1]!, list);
      return argv[1]!;
    }
    if (script.includes("ZRANGEBYSCORE")) return 0;
    if (script.includes("redis.call('ZADD'")) {
      this.strings.set(keys[0]!, argv[0]!);
      const processing = this.lists.get(keys[1]!) ?? [];
      this.lists.set(keys[1]!, processing.filter((item) => item !== argv[1]!));
      const set = this.sorted.get(keys[2]!) ?? new Map<string, number>();
      set.set(argv[1]!, Number(argv[2]));
      this.sorted.set(keys[2]!, set);
      this.strings.delete(keys[3]!);
      return 1;
    }
    if (script.includes("redis.call('LREM', KEYS[2], 0, ARGV[2])")) {
      this.strings.set(keys[0]!, argv[0]!);
      const processing = this.lists.get(keys[1]!) ?? [];
      this.lists.set(keys[1]!, processing.filter((item) => item !== argv[1]!));
      this.strings.delete(keys[2]!);
      return 1;
    }
    throw new Error("Unsupported fake Redis Lua script.");
  }
}

test("Redis job transport provides durable idempotent submission and queued cancellation", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "renders" });
  const queue = new DistributedJobQueue(transport);

  const first = await queue.submit("redis.render", { source: "input.mp4" }, { idempotencyKey: "render-1" });
  const second = await queue.submit("redis.render", { source: "input.mp4" }, { idempotencyKey: "render-1" });
  assert.equal(second.descriptor.id, first.descriptor.id);

  await assert.rejects(
    () => queue.submit("redis.render", { source: "other.mp4" }, { idempotencyKey: "render-1" }),
    JobIdempotencyConflictError
  );

  const cancelled = await queue.cancel(first.descriptor.id);
  assert.equal(cancelled.state, "cancelled");
  assert.equal((await queue.get(first.descriptor.id)).state, "cancelled");
});

test("Redis transport can drive a distributed worker through claim and completion", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "worker" });
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    workerId: "redis-worker",
    claimWaitMs: 10,
    cancellationPollMs: 10
  });
  worker.register<{ value: number }, number>("redis.double", async ({ value }, context) => {
    await context.reportProgress({ percent: 50, phase: "compute" });
    return value * 2;
  });
  worker.start();

  const submitted = await queue.submit<{ value: number }, number>("redis.double", { value: 9 });
  const terminal = await queue.wait<{ value: number }, number>(submitted.descriptor.id, {
    pollIntervalMs: 10,
    timeoutMs: 1_000
  });
  assert.equal(terminal.state, "succeeded");
  assert.equal(terminal.result, 18);
  assert.equal(terminal.workerId, "redis-worker");
  assert.equal(terminal.progress?.percent, 100);
  await worker.stop();
});

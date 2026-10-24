import assert from "node:assert/strict";
import test from "node:test";
import type { JobLease, JobSnapshot } from "@vexa-video/core";
import { JobIdempotencyConflictError, isTerminalJobState } from "@vexa-video/core";
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
  heartbeatCount = 0;
  private claimSequence = 0;

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

  async claim(workerId: string, waitMs: number, leaseDurationMs: number): Promise<JobSnapshot | null> {
    const id = this.queue.shift();
    if (!id) {
      await sleep(Math.min(waitMs, 5));
      return null;
    }
    const snapshot = await this.get(id);
    if (!snapshot) return null;
    const acquiredAt = new Date();
    snapshot.workerId = workerId;
    snapshot.lease = {
      claimId: `memory-claim-${++this.claimSequence}`,
      workerId,
      acquiredAt: acquiredAt.toISOString(),
      heartbeatAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + leaseDurationMs).toISOString()
    };
    snapshot.updatedAt = acquiredAt.toISOString();
    this.jobs.set(id, structuredClone(snapshot));
    return snapshot;
  }

  async heartbeat(
    jobId: string,
    claimId: string,
    workerId: string,
    leaseDurationMs: number
  ): Promise<JobLease> {
    const snapshot = this.requireLease(jobId, claimId);
    if (snapshot.lease!.workerId !== workerId) throw new Error(`Worker lease mismatch: ${jobId}`);
    const heartbeatAt = new Date();
    snapshot.lease = {
      ...snapshot.lease!,
      heartbeatAt: heartbeatAt.toISOString(),
      expiresAt: new Date(heartbeatAt.getTime() + leaseDurationMs).toISOString()
    };
    snapshot.updatedAt = heartbeatAt.toISOString();
    this.jobs.set(jobId, structuredClone(snapshot));
    this.heartbeatCount += 1;
    return structuredClone(snapshot.lease!);
  }

  async save(snapshot: JobSnapshot, claimId: string): Promise<void> {
    const current = this.requireLease(snapshot.descriptor.id, claimId);
    const next = structuredClone(snapshot);
    next.lease = structuredClone(current.lease!);
    if (current.updatedAt > next.updatedAt) next.updatedAt = current.updatedAt;
    if (current.cancellationRequested) next.cancellationRequested = true;
    this.jobs.set(snapshot.descriptor.id, next);
  }

  async finish(snapshot: JobSnapshot, claimId: string): Promise<void> {
    const current = this.requireLease(snapshot.descriptor.id, claimId);
    const next = structuredClone(snapshot);
    delete next.lease;
    if (current.cancellationRequested && next.state !== "cancelled") {
      next.state = "cancelled";
      next.cancellationRequested = true;
      delete next.result;
    }
    this.jobs.set(snapshot.descriptor.id, next);
    this.cancellation.delete(snapshot.descriptor.id);
  }

  async scheduleRetry(snapshot: JobSnapshot, availableAtMs: number, claimId: string): Promise<void> {
    const current = this.requireLease(snapshot.descriptor.id, claimId);
    const next = structuredClone(snapshot);
    delete next.lease;
    if (current.cancellationRequested) {
      next.state = "cancelled";
      next.cancellationRequested = true;
      next.completedAt = new Date().toISOString();
      next.updatedAt = next.completedAt;
      delete next.nextAttemptAt;
      this.jobs.set(snapshot.descriptor.id, next);
      this.cancellation.delete(snapshot.descriptor.id);
      return;
    }
    this.jobs.set(snapshot.descriptor.id, next);
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
      delete snapshot.lease;
    } else {
      this.cancellation.add(jobId);
    }
    this.jobs.set(jobId, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    return this.cancellation.has(jobId);
  }

  private requireLease(jobId: string, claimId: string): JobSnapshot {
    const snapshot = this.jobs.get(jobId);
    const lease = snapshot?.lease;
    if (!snapshot || !lease || lease.claimId !== claimId || lease.expiresAt <= new Date().toISOString()) {
      throw new Error(`Worker lease is no longer valid: ${jobId}`);
    }
    return snapshot;
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
  assert.equal(terminal.lease, undefined);
  await worker.stop();
});

test("distributed worker renews its lease while work is running", async () => {
  const transport = new MemoryTransport();
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    workerId: "heartbeat-worker",
    claimWaitMs: 10,
    cancellationPollMs: 10,
    leaseDurationMs: 120,
    heartbeatIntervalMs: 20
  });
  worker.register("lease.work", async () => {
    await sleep(85);
    return "done";
  });
  worker.start();

  const submitted = await queue.submit("lease.work", {});
  while ((await queue.get(submitted.descriptor.id)).state !== "running") await sleep(1);
  const running = await queue.get(submitted.descriptor.id);
  assert.equal(running.lease?.workerId, "heartbeat-worker");
  const initialHeartbeat = running.lease?.heartbeatAt;

  for (let attempt = 0; attempt < 20 && transport.heartbeatCount === 0; attempt += 1) {
    await sleep(5);
  }
  const renewed = await queue.get(submitted.descriptor.id);
  assert.ok(initialHeartbeat);
  assert.ok(renewed.lease);
  assert.ok(renewed.lease.heartbeatAt > initialHeartbeat);
  assert.ok(transport.heartbeatCount >= 1);

  const terminal = await queue.wait(submitted.descriptor.id, { pollIntervalMs: 10, timeoutMs: 1_000 });
  assert.equal(terminal.state, "succeeded");
  assert.equal(terminal.lease, undefined);
  await worker.stop();
});

test("distributed cancellation completes under an active lease", async () => {
  const transport = new MemoryTransport();
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    workerId: "cancel-worker",
    claimWaitMs: 10,
    cancellationPollMs: 10,
    leaseDurationMs: 120,
    heartbeatIntervalMs: 20
  });
  worker.register("lease.cancel", async (_payload, context) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      context.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    return "late";
  });
  worker.start();

  const submitted = await queue.submit("lease.cancel", {});
  while ((await queue.get(submitted.descriptor.id)).state !== "running") await sleep(1);
  const cancelled = await queue.cancel(submitted.descriptor.id);
  assert.equal(cancelled.cancellationRequested, true);

  const terminal = await queue.wait(submitted.descriptor.id, { pollIntervalMs: 10, timeoutMs: 1_000 });
  assert.equal(terminal.state, "cancelled");
  assert.equal(terminal.lease, undefined);
  await worker.stop();
});

test("distributed transport rejects mutations from a stale claim", async () => {
  const transport = new MemoryTransport();
  const queue = new DistributedJobQueue(transport);
  const submitted = await queue.submit("lease.guard", {});
  const claimed = await transport.claim("lease-owner", 10, 1_000);
  assert.equal(claimed?.descriptor.id, submitted.descriptor.id);
  assert.ok(claimed?.lease);

  await assert.rejects(
    () => transport.save(claimed!, "stale-claim"),
    /lease is no longer valid/i
  );
});

class FakeRedis implements RedisCommandClient {
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly sorted = new Map<string, Map<string, number>>();
  heartbeatCount = 0;

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
    if (command === "ZREVRANGE") {
      const entries = [...(this.sorted.get(args[1]!) ?? new Map<string, number>())];
      entries.sort(([leftId, leftScore], [rightId, rightScore]) => rightScore - leftScore || rightId.localeCompare(leftId));
      return entries.slice(Number(args[2]), Number(args[3]) + 1).map(([id]) => id);
    }
    if (command === "LRANGE") {
      const list = this.lists.get(args[1]!) ?? [];
      const start = Number(args[2]);
      const end = Number(args[3]);
      return list.slice(start, end < 0 ? undefined : end + 1);
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
    if (script.includes("redis.call('RPOP', KEYS[1])")) {
      const queue = this.lists.get(keys[0]!) ?? [];
      for (let index = 0; index < 100; index += 1) {
        const id = queue.pop();
        if (!id) return null;
        const key = `${keys[2]!}${id}`;
        const raw = this.strings.get(key);
        if (!raw) continue;
        const job = JSON.parse(raw) as JobSnapshot;
        if ((job.state !== "queued" && job.state !== "retrying") || job.lease) continue;
        job.workerId = argv[0]!;
        job.lease = {
          claimId: argv[1]!, workerId: argv[0]!, acquiredAt: argv[2]!,
          heartbeatAt: argv[2]!, expiresAt: argv[3]!
        };
        job.updatedAt = argv[2]!;
        this.strings.set(key, JSON.stringify(job));
        const processing = this.lists.get(keys[1]!) ?? [];
        processing.unshift(id);
        this.lists.set(keys[1]!, processing);
        return JSON.stringify(job);
      }
      return null;
    }
    if (script.includes("JOB_STALE_LEASE_EXHAUSTED")) {
      const id = argv[0]!;
      const raw = this.strings.get(keys[0]!);
      const processing = this.lists.get(keys[1]!) ?? [];
      const cleanup = (status: string) => {
        this.lists.set(keys[1]!, processing.filter((item) => item !== id));
        this.strings.delete(keys[3]!);
        return status;
      };
      if (!raw) return cleanup("cleaned");
      const job = JSON.parse(raw) as JobSnapshot;
      if (isTerminalJobState(job.state)) return cleanup("cleaned");
      if (job.lease?.expiresAt && job.lease.expiresAt > argv[1]!) return "active";
      delete job.lease;
      delete job.workerId;
      job.updatedAt = argv[1]!;
      delete job.nextAttemptAt;
      let status = "requeued";
      if (job.cancellationRequested || this.strings.get(keys[3]!) === "1") {
        job.state = "cancelled";
        job.cancellationRequested = true;
        job.completedAt = argv[1]!;
        status = "cancelled";
      } else if (job.attempt >= job.descriptor.retry.maxAttempts) {
        job.state = "failed";
        job.completedAt = argv[1]!;
        job.error = {
          name: "JobExecutionError", code: "JOB_STALE_LEASE_EXHAUSTED",
          message: "Worker lease expired after the configured maximum attempts.",
          attempt: job.attempt, at: argv[1]!
        };
        status = "exhausted";
      } else {
        job.state = "queued";
      }
      this.strings.set(keys[0]!, JSON.stringify(job));
      cleanup(status);
      if (status === "exhausted" && !this.strings.has(keys[5]!)) {
        this.strings.set(keys[5]!, JSON.stringify({
          jobId: id, recordedAt: argv[1], reason: "stale-lease-exhausted", snapshot: job
        }));
        const index = this.sorted.get(keys[4]!) ?? new Map<string, number>();
        index.set(id, Number(argv[2]));
        this.sorted.set(keys[4]!, index);
      }
      if (status === "requeued") {
        const queue = this.lists.get(keys[2]!) ?? [];
        queue.unshift(id);
        this.lists.set(keys[2]!, queue);
      }
      return status;
    }
    if (script.includes("job.lease = {")) {
      const raw = this.strings.get(keys[0]!);
      if (!raw) return null;
      const job = JSON.parse(raw) as JobSnapshot;
      if (isTerminalJobState(job.state)) return null;
      if (job.lease?.expiresAt && job.lease.expiresAt > argv[3]!) return null;
      job.workerId = argv[1]!;
      job.lease = {
        claimId: argv[2]!,
        workerId: argv[1]!,
        acquiredAt: argv[3]!,
        heartbeatAt: argv[3]!,
        expiresAt: argv[4]!
      };
      job.updatedAt = argv[3]!;
      const encoded = JSON.stringify(job);
      this.strings.set(keys[0]!, encoded);
      return encoded;
    }
    if (script.includes("job.lease.heartbeatAt = ARGV[3]")) {
      const raw = this.strings.get(keys[0]!);
      if (!raw) return null;
      const job = JSON.parse(raw) as JobSnapshot;
      if (
        !job.lease
        || job.lease.claimId !== argv[0]
        || job.lease.workerId !== argv[1]
        || job.lease.expiresAt <= argv[2]!
      ) return null;
      job.lease.heartbeatAt = argv[2]!;
      job.lease.expiresAt = argv[3]!;
      job.updatedAt = argv[2]!;
      this.heartbeatCount += 1;
      const encoded = JSON.stringify(job);
      this.strings.set(keys[0]!, encoded);
      return encoded;
    }
    if (script.includes("candidate.lease = current.lease")) {
      const raw = this.strings.get(keys[0]!);
      if (!raw) return 0;
      const current = JSON.parse(raw) as JobSnapshot;
      if (!current.lease || current.lease.claimId !== argv[1] || current.lease.expiresAt <= argv[2]!) return 0;
      const candidate = JSON.parse(argv[0]!) as JobSnapshot;
      candidate.lease = current.lease;
      candidate.workerId = current.workerId;
      if (current.updatedAt > candidate.updatedAt) candidate.updatedAt = current.updatedAt;
      if (current.cancellationRequested) candidate.cancellationRequested = true;
      this.strings.set(keys[0]!, JSON.stringify(candidate));
      return 1;
    }
    if (script.includes("job.cancellationRequested = true")) {
      const raw = this.strings.get(keys[0]!);
      if (!raw) return null;
      const job = JSON.parse(raw) as JobSnapshot;
      if (isTerminalJobState(job.state)) return raw;
      job.cancellationRequested = true;
      job.updatedAt = argv[0]!;
      const encoded = JSON.stringify(job);
      this.strings.set(keys[0]!, encoded);
      this.strings.set(keys[1]!, "1");
      return encoded;
    }
    if (script.includes("redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])")) {
      const raw = this.strings.get(keys[0]!);
      if (!raw) return 0;
      const current = JSON.parse(raw) as JobSnapshot;
      if (!current.lease || current.lease.claimId !== argv[3] || current.lease.expiresAt <= argv[4]!) return 0;
      const candidate = JSON.parse(argv[0]!) as JobSnapshot;
      delete candidate.lease;
      candidate.workerId = current.workerId;
      const processing = this.lists.get(keys[1]!) ?? [];
      this.lists.set(keys[1]!, processing.filter((item) => item !== argv[1]!));
      this.strings.delete(keys[3]!);
      if (current.cancellationRequested) {
        candidate.state = "cancelled";
        candidate.cancellationRequested = true;
        candidate.completedAt = argv[4]!;
        candidate.updatedAt = argv[4]!;
        delete candidate.nextAttemptAt;
        this.strings.set(keys[0]!, JSON.stringify(candidate));
        return 1;
      }
      this.strings.set(keys[0]!, JSON.stringify(candidate));
      const set = this.sorted.get(keys[2]!) ?? new Map<string, number>();
      set.set(argv[1]!, Number(argv[2]));
      this.sorted.set(keys[2]!, set);
      return 1;
    }
    if (script.includes("candidate.lease = nil")) {
      const raw = this.strings.get(keys[0]!);
      if (!raw) return 0;
      const current = JSON.parse(raw) as JobSnapshot;
      if (!current.lease || current.lease.claimId !== argv[2] || current.lease.expiresAt <= argv[3]!) return 0;
      const candidate = JSON.parse(argv[0]!) as JobSnapshot;
      delete candidate.lease;
      candidate.workerId = current.workerId;
      if (current.cancellationRequested && candidate.state !== "cancelled") {
        candidate.state = "cancelled";
        candidate.cancellationRequested = true;
        delete candidate.result;
      }
      this.strings.set(keys[0]!, JSON.stringify(candidate));
      const processing = this.lists.get(keys[1]!) ?? [];
      this.lists.set(keys[1]!, processing.filter((item) => item !== argv[1]!));
      this.strings.delete(keys[2]!);
      if (candidate.state === "failed" && !this.strings.has(keys[4]!)) {
        const reason = candidate.attempt >= candidate.descriptor.retry.maxAttempts
          ? "retry-exhausted" : "non-retryable";
        this.strings.set(keys[4]!, JSON.stringify({
          jobId: argv[1], recordedAt: argv[3], reason, snapshot: candidate
        }));
        const index = this.sorted.get(keys[3]!) ?? new Map<string, number>();
        index.set(argv[1]!, Number(argv[4]));
        this.sorted.set(keys[3]!, index);
      }
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

test("Redis transport can drive a distributed worker through claim, heartbeat, and completion", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "worker" });
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    workerId: "redis-worker",
    claimWaitMs: 10,
    cancellationPollMs: 10,
    leaseDurationMs: 120,
    heartbeatIntervalMs: 20
  });
  worker.register<{ value: number }, number>("redis.double", async ({ value }, context) => {
    await sleep(45);
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
  assert.equal(terminal.lease, undefined);
  assert.ok(redis.heartbeatCount >= 1);
  await worker.stop();
});

test("Redis recovery ignores active leases and atomically fences expired claims", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "reclaim" });
  const queue = new DistributedJobQueue(transport);
  const submitted = await queue.submit("recovery.work", {}, {
    retry: { maxAttempts: 2, backoffMs: 0, maxBackoffMs: 0 }
  });
  const claimed = await transport.claim("crashed-worker", 10, 100);
  assert.ok(claimed?.lease);
  assert.equal(redis.lists.get("test:vexa:reclaim:queue")?.length, 0);
  assert.deepEqual(redis.lists.get("test:vexa:reclaim:processing"), [submitted.descriptor.id]);
  claimed!.state = "running";
  claimed!.attempt = 1;
  await transport.save(claimed!, claimed!.lease!.claimId);
  assert.equal((await transport.recoverStaleClaims()).active, 1);
  await sleep(115);
  const recovered = await transport.recoverStaleClaims();
  assert.equal(recovered.requeued, 1);
  assert.equal((await queue.get(submitted.descriptor.id)).state, "queued");
  await assert.rejects(
    () => transport.save(claimed!, claimed!.lease!.claimId),
    /lease is no longer valid/i
  );
  await assert.rejects(
    () => transport.finish(claimed!, claimed!.lease!.claimId),
    /lease is no longer valid/i
  );
  await assert.rejects(
    () => transport.scheduleRetry(claimed!, Date.now(), claimed!.lease!.claimId),
    /lease is no longer valid/i
  );
  const newClaim = await transport.claim("replacement-worker", 10, 100);
  assert.ok(newClaim?.lease);
  assert.notEqual(newClaim?.lease?.claimId, claimed!.lease!.claimId);
  assert.equal(newClaim?.attempt, 1);
  assert.equal((await transport.recoverStaleClaims()).active, 1);
});

test("Redis recovery finishes expired cancellation instead of requeueing", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "cancel-crash" });
  const queue = new DistributedJobQueue(transport);
  const submitted = await queue.submit("recovery.cancel", {});
  const claim = await transport.claim("crashed", 10, 100);
  assert.ok(claim?.lease);
  await queue.cancel(submitted.descriptor.id);
  await sleep(115);
  const outcome = await transport.recoverStaleClaims();
  assert.equal(outcome.cancelled, 1);
  const final = await queue.get(submitted.descriptor.id);
  assert.equal(final.state, "cancelled");
  assert.equal(final.lease, undefined);
  assert.equal((redis.lists.get("test:vexa:cancel-crash:queue") ?? []).length, 0);
});

test("Redis recovery exhausts a crashed last attempt with useful failure context", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "exhaust" });
  const queue = new DistributedJobQueue(transport);
  const submitted = await queue.submit("recovery.exhaust", {});
  const claim = await transport.claim("crashed", 10, 100);
  assert.ok(claim?.lease);
  claim!.state = "running";
  claim!.attempt = 1;
  await transport.save(claim!, claim!.lease!.claimId);
  await sleep(115);
  assert.equal((await transport.recoverStaleClaims()).exhausted, 1);
  const failed = await queue.get(submitted.descriptor.id);
  assert.equal(failed.state, "failed");
  assert.equal(failed.error?.code, "JOB_STALE_LEASE_EXHAUSTED");
  assert.equal(failed.attempt, 1);
  assert.equal(failed.lease, undefined);
});

test("Redis replacement worker autonomously recovers a crashed worker claim", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, {
    prefix: "test:vexa", queue: "restart", recoveryIntervalMs: 10
  });
  const queue = new DistributedJobQueue(transport);
  const submitted = await queue.submit("recovery.restart", { value: 7 }, {
    retry: { maxAttempts: 2, backoffMs: 0, maxBackoffMs: 0 }
  });
  const abandoned = await transport.claim("dead", 10, 100);
  assert.ok(abandoned?.lease);
  abandoned!.state = "running";
  abandoned!.attempt = 1;
  await transport.save(abandoned!, abandoned!.lease!.claimId);
  await sleep(115);
  const worker = new DistributedJobWorker(transport, {
    workerId: "replacement", claimWaitMs: 10, cancellationPollMs: 10,
    leaseDurationMs: 200, heartbeatIntervalMs: 40
  });
  worker.register<{ value: number }, number>("recovery.restart", async ({ value }) => value * 2);
  worker.start();
  try {
    const result = await queue.wait(submitted.descriptor.id, { pollIntervalMs: 10, timeoutMs: 2_000 });
    assert.equal(result.state, "succeeded");
    assert.equal(result.result, 14);
    assert.equal(result.attempt, 2);
    assert.equal(result.lease, undefined);
  } finally {
    await worker.stop();
  }
});

test("Redis failed worker completion writes one durable dead letter", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "dead-worker" });
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    workerId: "dead-worker", claimWaitMs: 10, cancellationPollMs: 10,
    leaseDurationMs: 500, heartbeatIntervalMs: 40
  });
  worker.register("dead.worker", async () => { throw new Error("render failed"); });
  worker.start();
  try {
    const job = await queue.submit("dead.worker", {});
    const done = await queue.wait(job.descriptor.id, { pollIntervalMs: 10, timeoutMs: 1_000 });
    assert.equal(done.state, "failed");
    const dead = await transport.getDeadLetter(job.descriptor.id);
    assert.equal(dead?.jobId, job.descriptor.id);
    assert.equal(dead?.reason, "retry-exhausted");
    assert.equal(dead?.snapshot.state, "failed");
    assert.match(dead!.snapshot.error!.message, /render failed/);
    assert.equal(dead?.snapshot.attempt, 1);
    assert.equal(dead?.snapshot.lease, undefined);
    assert.equal((await transport.listDeadLetters()).length, 1);
  } finally {
    await worker.stop();
  }
});

test("Redis non-retryable worker failure is archived before max attempts", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "dead-no-retry" });
  const queue = new DistributedJobQueue(transport);
  const worker = new DistributedJobWorker(transport, {
    claimWaitMs: 10, cancellationPollMs: 10, leaseDurationMs: 500, heartbeatIntervalMs: 40
  });
  worker.register("dead.nonretryable", async () => { throw new Error("invalid media"); }, {
    retryable: () => false
  });
  worker.start();
  try {
    const job = await queue.submit("dead.nonretryable", {}, { retry: { maxAttempts: 3 } });
    const done = await queue.wait(job.descriptor.id, { pollIntervalMs: 10, timeoutMs: 1_000 });
    assert.equal(done.state, "failed");
    assert.equal(done.attempt, 1);
    assert.equal((await transport.getDeadLetter(job.descriptor.id))?.reason, "non-retryable");
  } finally {
    await worker.stop();
  }
});

test("Redis stale-lease exhaustion archives a single durable failure", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "dead-stale" });
  const queue = new DistributedJobQueue(transport);
  const job = await queue.submit("dead.stale", {});
  const claim = await transport.claim("crashed", 10, 100);
  assert.ok(claim?.lease);
  claim!.state = "running";
  claim!.attempt = 1;
  await transport.save(claim!, claim!.lease!.claimId);
  await sleep(125);
  assert.equal((await transport.recoverStaleClaims()).exhausted, 1);
  const dead = await transport.getDeadLetter(job.descriptor.id);
  assert.equal(dead?.reason, "stale-lease-exhausted");
  assert.equal(dead?.snapshot.error?.code, "JOB_STALE_LEASE_EXHAUSTED");
  assert.equal((await transport.recoverStaleClaims()).exhausted, 0);
  assert.equal((await transport.listDeadLetters()).length, 1);
  await assert.rejects(() => transport.finish(claim!, claim!.lease!.claimId), /lease is no longer valid/i);
});

test("Redis dead-letter reads validate paging and never include cancellations", async () => {
  const redis = new FakeRedis();
  const transport = new RedisJobTransport(redis, { prefix: "test:vexa", queue: "dead-page" });
  const queue = new DistributedJobQueue(transport);
  const cancelled = await queue.submit("dead.cancel", {});
  await queue.cancel(cancelled.descriptor.id);
  assert.equal(await transport.getDeadLetter(cancelled.descriptor.id), null);
  assert.deepEqual(await transport.listDeadLetters(), []);
  await assert.rejects(() => transport.listDeadLetters(-1, 10), /Dead-letter offset/);
  await assert.rejects(() => transport.listDeadLetters(0, 0), /Dead-letter offset/);
  await assert.rejects(() => transport.listDeadLetters(0, 1001), /Dead-letter offset/);
});

import { createHash } from "node:crypto";
import type { JobSnapshot } from "@vexa-video/core";
import {
  JobIdempotencyConflictError,
  JobTransportError,
  isTerminalJobState
} from "@vexa-video/core";
import type { DistributedJobTransport } from "./jobs.js";

export interface RedisCommandClient {
  /**
   * Execute a raw Redis command. A small wrapper can adapt node-redis, ioredis,
   * or another Redis client without making it a Vexa runtime dependency.
   */
  sendCommand(args: readonly string[]): Promise<unknown>;
}

export interface RedisJobTransportOptions {
  prefix?: string;
  queue?: string;
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function integer(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = Number(scalar(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSnapshot(value: unknown): JobSnapshot | null {
  const text = scalar(value);
  if (!text) return null;
  try {
    return JSON.parse(text) as JobSnapshot;
  } catch (error) {
    throw new JobTransportError("Redis job record contains invalid JSON.", { cause: error });
  }
}

const IDEMPOTENT_SUBMIT_SCRIPT = `
local existing = redis.call('GET', KEYS[3])
if existing then
  return existing
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[3], ARGV[2] .. '|' .. ARGV[3])
redis.call('LPUSH', KEYS[2], ARGV[3])
return 'CREATED|' .. ARGV[3]
`;

const SUBMIT_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
redis.call('LPUSH', KEYS[2], ARGV[2])
return ARGV[2]
`;

const PROMOTE_DUE_SCRIPT = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, id in ipairs(ids) do
  if redis.call('ZREM', KEYS[1], id) == 1 then
    redis.call('LPUSH', KEYS[2], id)
  end
end
return #ids
`;

const FINISH_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
redis.call('LREM', KEYS[2], 0, ARGV[2])
redis.call('DEL', KEYS[3])
return 1
`;

const RETRY_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
redis.call('LREM', KEYS[2], 0, ARGV[2])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
redis.call('DEL', KEYS[4])
return 1
`;

export class RedisJobTransport implements DistributedJobTransport {
  private readonly prefix: string;
  private readonly queueKey: string;
  private readonly processingKey: string;
  private readonly delayedKey: string;

  constructor(
    private readonly client: RedisCommandClient,
    options: RedisJobTransportOptions = {}
  ) {
    const prefix = (options.prefix ?? "vexa:jobs").trim().replace(/:+$/u, "");
    const queue = (options.queue ?? "default").trim();
    if (!prefix || !queue || !/^[a-z0-9._-]+$/iu.test(queue)) {
      throw new JobTransportError("Redis job prefix and queue name must be non-empty; queue may contain letters, numbers, dot, underscore, and hyphen.");
    }
    this.prefix = `${prefix}:${queue}`;
    this.queueKey = `${this.prefix}:queue`;
    this.processingKey = `${this.prefix}:processing`;
    this.delayedKey = `${this.prefix}:delayed`;
  }

  async submit(snapshot: JobSnapshot, fingerprint: string): Promise<JobSnapshot> {
    const jobId = snapshot.descriptor.id;
    const json = JSON.stringify(snapshot);
    if (snapshot.descriptor.idempotencyKey) {
      const idemHash = createHash("sha256").update(snapshot.descriptor.idempotencyKey).digest("hex");
      const result = scalar(await this.send([
        "EVAL",
        IDEMPOTENT_SUBMIT_SCRIPT,
        "3",
        this.jobKey(jobId),
        this.queueKey,
        `${this.prefix}:idem:${idemHash}`,
        json,
        fingerprint,
        jobId
      ]));
      if (!result) throw new JobTransportError("Redis idempotent submit returned no result.");
      if (result.startsWith("CREATED|")) return snapshot;
      const separator = result.indexOf("|");
      if (separator <= 0) throw new JobTransportError("Redis idempotency record is malformed.");
      const existingFingerprint = result.slice(0, separator);
      const existingJobId = result.slice(separator + 1);
      if (existingFingerprint !== fingerprint) {
        throw new JobIdempotencyConflictError(snapshot.descriptor.idempotencyKey);
      }
      const existing = await this.get(existingJobId);
      if (!existing) throw new JobTransportError(`Redis idempotency record points to missing job: ${existingJobId}`);
      return existing;
    }

    await this.send([
      "EVAL",
      SUBMIT_SCRIPT,
      "2",
      this.jobKey(jobId),
      this.queueKey,
      json,
      jobId
    ]);
    return snapshot;
  }

  async get(jobId: string): Promise<JobSnapshot | null> {
    return parseSnapshot(await this.send(["GET", this.jobKey(jobId)]));
  }

  async claim(_workerId: string, waitMs: number): Promise<JobSnapshot | null> {
    await this.promoteDue();
    const timeoutSeconds = Math.max(1, Math.ceil(Math.max(1, waitMs) / 1_000));
    const raw = await this.send([
      "BRPOPLPUSH",
      this.queueKey,
      this.processingKey,
      String(timeoutSeconds)
    ]);
    const jobId = scalar(raw);
    if (!jobId) return null;
    const snapshot = await this.get(jobId);
    if (!snapshot) {
      await this.send(["LREM", this.processingKey, "0", jobId]);
      return null;
    }
    if (isTerminalJobState(snapshot.state)) {
      await this.send(["LREM", this.processingKey, "0", jobId]);
      return null;
    }
    return snapshot;
  }

  async save(snapshot: JobSnapshot): Promise<void> {
    await this.send(["SET", this.jobKey(snapshot.descriptor.id), JSON.stringify(snapshot)]);
  }

  async finish(snapshot: JobSnapshot): Promise<void> {
    const id = snapshot.descriptor.id;
    await this.send([
      "EVAL",
      FINISH_SCRIPT,
      "3",
      this.jobKey(id),
      this.processingKey,
      this.cancelKey(id),
      JSON.stringify(snapshot),
      id
    ]);
  }

  async scheduleRetry(snapshot: JobSnapshot, availableAtMs: number): Promise<void> {
    const id = snapshot.descriptor.id;
    await this.send([
      "EVAL",
      RETRY_SCRIPT,
      "4",
      this.jobKey(id),
      this.processingKey,
      this.delayedKey,
      this.cancelKey(id),
      JSON.stringify(snapshot),
      id,
      String(Math.max(0, Math.floor(availableAtMs)))
    ]);
  }

  async cancel(jobId: string): Promise<JobSnapshot | null> {
    const snapshot = await this.get(jobId);
    if (!snapshot || isTerminalJobState(snapshot.state)) return snapshot;

    snapshot.cancellationRequested = true;
    snapshot.updatedAt = new Date().toISOString();

    if (snapshot.state === "queued") {
      const removed = integer(await this.send(["LREM", this.queueKey, "0", jobId]));
      if (removed > 0) return await this.finishCancelledOutsideProcessing(snapshot);
    }

    if (snapshot.state === "retrying") {
      const removed = integer(await this.send(["ZREM", this.delayedKey, jobId]));
      if (removed > 0) return await this.finishCancelledOutsideProcessing(snapshot);
    }

    await this.send(["SET", this.cancelKey(jobId), "1"]);
    await this.save(snapshot);
    return snapshot;
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    return scalar(await this.send(["GET", this.cancelKey(jobId)])) === "1";
  }

  private async promoteDue(): Promise<void> {
    await this.send([
      "EVAL",
      PROMOTE_DUE_SCRIPT,
      "2",
      this.delayedKey,
      this.queueKey,
      String(Date.now())
    ]);
  }

  private async finishCancelledOutsideProcessing(snapshot: JobSnapshot): Promise<JobSnapshot> {
    snapshot.state = "cancelled";
    snapshot.completedAt = new Date().toISOString();
    snapshot.updatedAt = snapshot.completedAt;
    delete snapshot.nextAttemptAt;
    await this.save(snapshot);
    await this.send(["DEL", this.cancelKey(snapshot.descriptor.id)]);
    return snapshot;
  }

  private jobKey(jobId: string): string {
    return `${this.prefix}:job:${jobId}`;
  }

  private cancelKey(jobId: string): string {
    return `${this.prefix}:cancel:${jobId}`;
  }

  private async send(args: readonly string[]): Promise<unknown> {
    try {
      return await this.client.sendCommand(args);
    } catch (error) {
      throw new JobTransportError(`Redis job transport command failed: ${args[0] ?? "unknown"}`, { cause: error });
    }
  }
}

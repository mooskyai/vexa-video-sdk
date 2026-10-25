import { createHash, randomUUID } from "node:crypto";
import type { JobLease, JobSnapshot } from "@vexa-video/core";
import {
  JobIdempotencyConflictError,
  JobTransportError
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
  /** Maximum delay between bounded processing-list recovery scans. Defaults to 1 second. */
  recoveryIntervalMs?: number;
  /** Maximum processing entries inspected per sweep. Defaults to 100. */
  recoveryBatchSize?: number;
  /** Optional, non-blocking operational events. Listener failures never affect Redis jobs. */
  onDiagnostic?: (event: RedisJobDiagnosticEvent) => void;
}

/** Outcome counters from a bounded, ownership-fenced recovery sweep. */
export interface RedisJobRecoveryResult {
  scanned: number;
  requeued: number;
  cancelled: number;
  exhausted: number;
  cleaned: number;
  active: number;
}

export interface RedisRetryReconciliationResult {
  scanned: number;
  promoted: number;
  discarded: number;
}

export interface RedisJobQueueDiagnostics {
  capturedAt: string;
  queued: number;
  processing: number;
  delayed: number;
  deadLetters: number;
}

/** Explicit single-job orphan correction is never a background key scan. */
export type RedisJobOrphanResult =
  | "requeued" | "indexed" | "missing" | "terminal" | "leased" | "ineligible";

export type RedisJobDiagnosticEvent =
  | { operation: "retry-reconciliation"; at: string; result: RedisRetryReconciliationResult }
  | { operation: "stale-recovery"; at: string; result: RedisJobRecoveryResult }
  | { operation: "orphan-reconciliation"; at: string; jobId: string; result: RedisJobOrphanResult };

/** Persistent failure record; V3.1c does not automatically replay failed jobs. */
export interface RedisJobDeadLetter {
  jobId: string;
  recordedAt: string;
  reason: "retry-exhausted" | "non-retryable" | "stale-lease-exhausted";
  snapshot: JobSnapshot;
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

// A delayed index alone cannot resurrect a cancelled, terminal or missing job.
// The validation, index removal and queue transition share one Redis transaction.
const PROMOTE_DUE_SCRIPT = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
local promoted = 0
local discarded = 0
for _, id in ipairs(ids) do
  if redis.call('ZREM', KEYS[1], id) == 1 then
    local key = KEYS[3] .. id
    local raw = redis.call('GET', key)
    local ready = false
    if raw then
      local job = cjson.decode(raw)
      if job.state == 'retrying' and not job.lease and not job.cancellationRequested then
        job.state = 'queued'
        job.nextAttemptAt = nil
        job.updatedAt = ARGV[3]
        redis.call('SET', key, cjson.encode(job))
        redis.call('LPUSH', KEYS[2], id)
        ready = true
      end
    end
    if ready then promoted = promoted + 1 else discarded = discarded + 1 end
  end
end
return {#ids, promoted, discarded}
`;

// Claiming and registering the lease happen in a single Redis command. A process
// crash can no longer strand a newly moved ID without an ownership record.
const CLAIM_NEXT_SCRIPT = `
for _ = 1, 100 do
  local id = redis.call('RPOP', KEYS[1])
  if not id then return nil end
  local key = KEYS[3] .. id
  local raw = redis.call('GET', key)
  if raw then
    local job = cjson.decode(raw)
    if (job.state == 'queued' or job.state == 'retrying') and not job.lease then
      job.workerId = ARGV[1]
      job.lease = {
        claimId = ARGV[2],
        workerId = ARGV[1],
        acquiredAt = ARGV[3],
        heartbeatAt = ARGV[3],
        expiresAt = ARGV[4]
      }
      job.updatedAt = ARGV[3]
      local encoded = cjson.encode(job)
      redis.call('SET', key, encoded)
      redis.call('LPUSH', KEYS[2], id)
      return encoded
    end
  end
end
return nil
`;

const HEARTBEAT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end
local job = cjson.decode(raw)
if not job.lease or job.lease.claimId ~= ARGV[1] or job.lease.workerId ~= ARGV[2] then
  return nil
end
if not job.lease.expiresAt or job.lease.expiresAt <= ARGV[3] then
  return nil
end
job.lease.heartbeatAt = ARGV[3]
job.lease.expiresAt = ARGV[4]
job.updatedAt = ARGV[3]
local encoded = cjson.encode(job)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

const SAVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local current = cjson.decode(raw)
if not current.lease or current.lease.claimId ~= ARGV[2] then
  return 0
end
if not current.lease.expiresAt or current.lease.expiresAt <= ARGV[3] then
  return 0
end
local candidate = cjson.decode(ARGV[1])
candidate.lease = current.lease
candidate.workerId = current.workerId
if current.updatedAt and candidate.updatedAt and current.updatedAt > candidate.updatedAt then
  candidate.updatedAt = current.updatedAt
end
if current.cancellationRequested then
  candidate.cancellationRequested = true
end
redis.call('SET', KEYS[1], cjson.encode(candidate))
return 1
`;

const FINISH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local current = cjson.decode(raw)
if not current.lease or current.lease.claimId ~= ARGV[3] then
  return 0
end
if not current.lease.expiresAt or current.lease.expiresAt <= ARGV[4] then
  return 0
end
local candidate = cjson.decode(ARGV[1])
candidate.lease = nil
candidate.workerId = current.workerId
if current.cancellationRequested and candidate.state ~= 'cancelled' then
  candidate.state = 'cancelled'
  candidate.cancellationRequested = true
  candidate.result = nil
end
redis.call('SET', KEYS[1], cjson.encode(candidate))
redis.call('LREM', KEYS[2], 0, ARGV[2])
redis.call('DEL', KEYS[3])
if candidate.state == 'failed' and redis.call('EXISTS', KEYS[5]) == 0 then
  local reason = 'non-retryable'
  if candidate.attempt >= candidate.descriptor.retry.maxAttempts then
    reason = 'retry-exhausted'
  end
  redis.call('SET', KEYS[5], cjson.encode({
    jobId = ARGV[2], recordedAt = ARGV[4], reason = reason, snapshot = candidate
  }))
  redis.call('ZADD', KEYS[4], ARGV[5], ARGV[2])
end
return 1
`;

const RETRY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local current = cjson.decode(raw)
if not current.lease or current.lease.claimId ~= ARGV[4] then
  return 0
end
if not current.lease.expiresAt or current.lease.expiresAt <= ARGV[5] then
  return 0
end
local candidate = cjson.decode(ARGV[1])
candidate.lease = nil
candidate.workerId = current.workerId
if current.cancellationRequested then
  candidate.state = 'cancelled'
  candidate.cancellationRequested = true
  candidate.completedAt = ARGV[5]
  candidate.updatedAt = ARGV[5]
  candidate.nextAttemptAt = nil
  redis.call('SET', KEYS[1], cjson.encode(candidate))
  redis.call('LREM', KEYS[2], 0, ARGV[2])
  redis.call('DEL', KEYS[4])
  return 1
end
redis.call('SET', KEYS[1], cjson.encode(candidate))
redis.call('LREM', KEYS[2], 0, ARGV[2])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
redis.call('DEL', KEYS[4])
return 1
`;

// Queue/index removal and cancellation are atomic with the ownership test.
// A worker that already owns a lease receives a cancellation request instead.
const CANCEL_SCRIPT = `
-- ATOMIC_CANCEL
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local job = cjson.decode(raw)
if job.state == 'succeeded' or job.state == 'failed' or job.state == 'cancelled' then
  return raw
end
job.cancellationRequested = true
job.updatedAt = ARGV[2]
if not job.lease and (job.state == 'queued' or job.state == 'retrying') then
  redis.call('LREM', KEYS[2], 0, ARGV[1])
  redis.call('ZREM', KEYS[3], ARGV[1])
  job.state = 'cancelled'
  job.completedAt = ARGV[2]
  job.nextAttemptAt = nil
  redis.call('DEL', KEYS[4])
else
  redis.call('SET', KEYS[4], '1')
end
local encoded = cjson.encode(job)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

// The claim token and expiration check are performed in the same Redis script as
// requeue/terminal cleanup. Only a truly expired (or legacy orphan) claim moves.
const RECOVER_EXPIRED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('LREM', KEYS[2], 0, ARGV[1])
  redis.call('DEL', KEYS[4])
  return 'cleaned'
end
local job = cjson.decode(raw)
if job.state == 'succeeded' or job.state == 'failed' or job.state == 'cancelled' then
  redis.call('LREM', KEYS[2], 0, ARGV[1])
  redis.call('DEL', KEYS[4])
  return 'cleaned'
end
if job.lease and job.lease.expiresAt and job.lease.expiresAt > ARGV[2] then
  return 'active'
end
job.lease = nil
job.workerId = nil
job.updatedAt = ARGV[2]
local status = 'requeued'
if job.cancellationRequested or redis.call('GET', KEYS[4]) == '1' then
  job.state = 'cancelled'
  job.cancellationRequested = true
  job.completedAt = ARGV[2]
  job.nextAttemptAt = nil
  status = 'cancelled'
elseif job.attempt >= job.descriptor.retry.maxAttempts then
  job.state = 'failed'
  job.completedAt = ARGV[2]
  job.nextAttemptAt = nil
  job.error = {
    name = 'JobExecutionError',
    code = 'JOB_STALE_LEASE_EXHAUSTED',
    message = 'Worker lease expired after the configured maximum attempts.',
    attempt = job.attempt,
    at = ARGV[2]
  }
  status = 'exhausted'
else
  job.state = 'queued'
  job.nextAttemptAt = nil
end
redis.call('SET', KEYS[1], cjson.encode(job))
redis.call('LREM', KEYS[2], 0, ARGV[1])
redis.call('DEL', KEYS[4])
if status == 'exhausted' and redis.call('EXISTS', KEYS[6]) == 0 then
  redis.call('SET', KEYS[6], cjson.encode({
    jobId = ARGV[1], recordedAt = ARGV[2], reason = 'stale-lease-exhausted', snapshot = job
  }))
  redis.call('ZADD', KEYS[5], ARGV[3], ARGV[1])
end
if status == 'requeued' then redis.call('LPUSH', KEYS[3], ARGV[1]) end
return status
`;

// Opt-in per-ID repair only. LPOS requires Redis 6.0.6+; no unbounded scans,
// unknown work execution, early retry promotion or dead-letter replays.
const RECONCILE_QUEUED_ORPHAN_SCRIPT = `
-- V3_1F_RECONCILE_QUEUED_ORPHAN
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local job = cjson.decode(raw)
if job.state == 'succeeded' or job.state == 'failed' or job.state == 'cancelled' then
  return 'terminal'
end
if job.lease then return 'leased' end
if job.state ~= 'queued' or job.cancellationRequested then return 'ineligible' end
if redis.call('LPOS', KEYS[2], ARGV[1])
  or redis.call('LPOS', KEYS[3], ARGV[1])
  or redis.call('ZSCORE', KEYS[4], ARGV[1]) then
  return 'indexed'
end
redis.call('LPUSH', KEYS[2], ARGV[1])
return 'requeued'
`;

export class RedisJobTransport implements DistributedJobTransport {
  private readonly prefix: string;
  private readonly queueKey: string;
  private readonly processingKey: string;
  private readonly delayedKey: string;
  private readonly deadIndexKey: string;
  private readonly onDiagnostic: RedisJobTransportOptions["onDiagnostic"];
  private readonly recoveryIntervalMs: number;
  private readonly recoveryBatchSize: number;
  private recoveryCursor = 0;
  private lastRecoveryAt = 0;
  private recoveryInFlight: Promise<void> | undefined;

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
    this.deadIndexKey = `${this.prefix}:dead:index`;
    this.onDiagnostic = options.onDiagnostic;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? 1_000;
    this.recoveryBatchSize = options.recoveryBatchSize ?? 100;
    if (!Number.isInteger(this.recoveryIntervalMs) || this.recoveryIntervalMs < 10) {
      throw new JobTransportError("Redis recoveryIntervalMs must be an integer of at least 10ms.");
    }
    if (!Number.isInteger(this.recoveryBatchSize) || this.recoveryBatchSize < 1 || this.recoveryBatchSize > 1_000) {
      throw new JobTransportError("Redis recoveryBatchSize must be between 1 and 1,000.");
    }
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

  async claim(workerId: string, waitMs: number, leaseDurationMs: number): Promise<JobSnapshot | null> {
    await this.promoteDue();
    await this.maybeRecover();
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      const acquiredAt = new Date();
      const expiresAt = new Date(acquiredAt.getTime() + leaseDurationMs);
      const snapshot = parseSnapshot(await this.send([
        "EVAL", CLAIM_NEXT_SCRIPT, "3",
        this.queueKey, this.processingKey, `${this.prefix}:job:`,
        workerId, randomUUID(), acquiredAt.toISOString(), expiresAt.toISOString()
      ]));
      if (snapshot) return snapshot;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, remaining)));
    } while (true);
    return null;
  }

  async heartbeat(
    jobId: string,
    claimId: string,
    workerId: string,
    leaseDurationMs: number
  ): Promise<JobLease> {
    const heartbeatAt = new Date();
    const expiresAt = new Date(heartbeatAt.getTime() + leaseDurationMs);
    const snapshot = parseSnapshot(await this.send([
      "EVAL",
      HEARTBEAT_SCRIPT,
      "1",
      this.jobKey(jobId),
      claimId,
      workerId,
      heartbeatAt.toISOString(),
      expiresAt.toISOString()
    ]));
    if (!snapshot?.lease) {
      throw new JobTransportError(`Job lease is no longer owned by worker ${workerId}: ${jobId}`);
    }
    return snapshot.lease;
  }

  async save(snapshot: JobSnapshot, claimId: string): Promise<void> {
    const saved = integer(await this.send([
      "EVAL",
      SAVE_SCRIPT,
      "1",
      this.jobKey(snapshot.descriptor.id),
      JSON.stringify(snapshot),
      claimId,
      new Date().toISOString()
    ]));
    this.assertLeaseMutation(saved, snapshot.descriptor.id);
  }

  async finish(snapshot: JobSnapshot, claimId: string): Promise<void> {
    const id = snapshot.descriptor.id;
    const finished = integer(await this.send([
      "EVAL",
      FINISH_SCRIPT,
      "5",
      this.jobKey(id),
      this.processingKey,
      this.cancelKey(id),
      this.deadIndexKey,
      this.deadEntryKey(id),
      JSON.stringify(snapshot),
      id,
      claimId,
      new Date().toISOString(),
      String(Date.now())
    ]));
    this.assertLeaseMutation(finished, id);
  }

  async scheduleRetry(snapshot: JobSnapshot, availableAtMs: number, claimId: string): Promise<void> {
    const id = snapshot.descriptor.id;
    const scheduled = integer(await this.send([
      "EVAL",
      RETRY_SCRIPT,
      "4",
      this.jobKey(id),
      this.processingKey,
      this.delayedKey,
      this.cancelKey(id),
      JSON.stringify(snapshot),
      id,
      String(Math.max(0, Math.floor(availableAtMs))),
      claimId,
      new Date().toISOString()
    ]));
    this.assertLeaseMutation(scheduled, id);
  }

  async cancel(jobId: string): Promise<JobSnapshot | null> {
    return parseSnapshot(await this.send([
      "EVAL", CANCEL_SCRIPT, "4",
      this.jobKey(jobId), this.queueKey, this.delayedKey, this.cancelKey(jobId),
      jobId, new Date().toISOString()
    ]));
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    return scalar(await this.send(["GET", this.cancelKey(jobId)])) === "1";
  }

  /** Repair one explicitly supplied orphaned queued job, without touching leases or retries. */
  async reconcileQueuedOrphan(jobId: string): Promise<RedisJobOrphanResult> {
    if (!jobId.trim()) throw new JobTransportError("Orphan reconciliation requires a job ID.");
    const result = scalar(await this.send([
      "EVAL", RECONCILE_QUEUED_ORPHAN_SCRIPT, "4",
      this.jobKey(jobId), this.queueKey, this.processingKey, this.delayedKey, jobId
    ]));
    if (result !== "requeued" && result !== "indexed" && result !== "missing"
      && result !== "terminal" && result !== "leased" && result !== "ineligible") {
      throw new JobTransportError(`Invalid orphan-reconciliation status: ${result ?? "null"}`);
    }
    this.emitDiagnostic({
      operation: "orphan-reconciliation", at: new Date().toISOString(), jobId, result
    });
    return result;
  }

  /** An atomic bounded sweep of due retries, pruning invalid delayed entries. */
  async reconcileDueRetries(batchSize = 100): Promise<RedisRetryReconciliationResult> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new JobTransportError("Redis retry reconciliation batch size must be between 1 and 1,000.");
    }
    const timestamp = new Date();
    const raw = await this.send([
      "EVAL", PROMOTE_DUE_SCRIPT, "3",
      this.delayedKey, this.queueKey, `${this.prefix}:job:`,
      String(timestamp.getTime()), String(batchSize), timestamp.toISOString()
    ]);
    if (!Array.isArray(raw) || raw.length !== 3) {
      throw new JobTransportError("Redis retry reconciliation returned invalid counters.");
    }
    const counts = raw.map((value) => integer(value));
    if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)
      || counts[1]! + counts[2]! > counts[0]!) {
      throw new JobTransportError("Redis retry reconciliation returned inconsistent counters.");
    }
    const result: RedisRetryReconciliationResult = {
      scanned: counts[0]!, promoted: counts[1]!, discarded: counts[2]!
    };
    this.emitDiagnostic({ operation: "retry-reconciliation", at: timestamp.toISOString(), result });
    return result;
  }

  /** Read-only approximate queue state at the time of four independent Redis reads. */
  async getQueueDiagnostics(): Promise<RedisJobQueueDiagnostics> {
    const raw = await Promise.all([
      this.send(["LLEN", this.queueKey]),
      this.send(["LLEN", this.processingKey]),
      this.send(["ZCARD", this.delayedKey]),
      this.send(["ZCARD", this.deadIndexKey])
    ]);
    const counts = raw.map((value) => integer(value));
    if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new JobTransportError("Redis queue diagnostics returned an invalid count.");
    }
    return {
      capturedAt: new Date().toISOString(), queued: counts[0]!,
      processing: counts[1]!, delayed: counts[2]!, deadLetters: counts[3]!
    };
  }

  /** Read one immutable dead-letter record without mutating the job or scheduling a replay. */
  async getDeadLetter(jobId: string): Promise<RedisJobDeadLetter | null> {
    const raw = scalar(await this.send(["GET", this.deadEntryKey(jobId)]));
    if (raw === null) return null;
    try {
      const record = JSON.parse(raw) as RedisJobDeadLetter;
      if (record.jobId !== jobId || record.snapshot?.descriptor?.id !== jobId
        || record.snapshot.state !== "failed" || typeof record.recordedAt !== "string"
        || !["retry-exhausted", "non-retryable", "stale-lease-exhausted"].includes(record.reason)) {
        throw new Error("Dead-letter record has invalid fields.");
      }
      return record;
    } catch (error) {
      throw new JobTransportError(`Invalid Redis dead-letter record: ${jobId}`, { cause: error });
    }
  }

  /** Read a bounded newest-first page. No implicit acknowledgement or replay. */
  async listDeadLetters(offset = 0, limit = 100): Promise<readonly RedisJobDeadLetter[]> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new JobTransportError("Dead-letter offset must be non-negative and limit must be between 1 and 1,000.");
    }
    const raw = await this.send(["ZREVRANGE", this.deadIndexKey, String(offset), String(offset + limit - 1)]);
    if (!Array.isArray(raw)) throw new JobTransportError("Redis dead-letter index returned an invalid page.");
    const records: RedisJobDeadLetter[] = [];
    for (const entry of raw) {
      const id = scalar(entry);
      if (!id) throw new JobTransportError("Redis dead-letter index contains an invalid job ID.");
      const record = await this.getDeadLetter(id);
      if (!record) throw new JobTransportError(`Redis dead-letter index points to a missing record: ${id}`);
      records.push(record);
    }
    return records;
  }

  /** Bounded recovery pass; safe for multiple workers to invoke concurrently. */
  async recoverStaleClaims(batchSize = this.recoveryBatchSize): Promise<RedisJobRecoveryResult> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new JobTransportError("Redis recovery batch size must be between 1 and 1,000.");
    }
    const fetchPage = async (offset: number): Promise<string[]> => {
      const value = await this.send([
        "LRANGE", this.processingKey, String(offset), String(offset + batchSize - 1)
      ]);
      if (!Array.isArray(value)) throw new JobTransportError("Redis LRANGE returned an invalid processing list.");
      return value.map((entry) => {
        const id = scalar(entry);
        if (!id) throw new JobTransportError("Redis processing list contains an invalid job ID.");
        return id;
      });
    };
    let ids = await fetchPage(this.recoveryCursor);
    if (ids.length === 0 && this.recoveryCursor > 0) {
      this.recoveryCursor = 0;
      ids = await fetchPage(0);
    }
    this.recoveryCursor += ids.length;
    const summary: RedisJobRecoveryResult = {
      scanned: ids.length, requeued: 0, cancelled: 0, exhausted: 0, cleaned: 0, active: 0
    };
    for (const jobId of ids) {
      const status = scalar(await this.send([
        "EVAL", RECOVER_EXPIRED_SCRIPT, "6",
        this.jobKey(jobId), this.processingKey, this.queueKey, this.cancelKey(jobId),
        this.deadIndexKey, this.deadEntryKey(jobId),
        jobId, new Date().toISOString(), String(Date.now())
      ]));
      if (status === "requeued" || status === "cancelled" || status === "exhausted"
        || status === "cleaned" || status === "active") {
        summary[status] += 1;
      } else {
        throw new JobTransportError(`Unknown stale-claim recovery status: ${status ?? "null"}`);
      }
    }
    this.emitDiagnostic({ operation: "stale-recovery", at: new Date().toISOString(), result: summary });
    return summary;
  }

  private async maybeRecover(): Promise<void> {
    if (this.recoveryInFlight) return await this.recoveryInFlight;
    if (Date.now() - this.lastRecoveryAt < this.recoveryIntervalMs) return;
    this.lastRecoveryAt = Date.now();
    const task = this.recoverStaleClaims().then(() => undefined);
    this.recoveryInFlight = task;
    try {
      await task;
    } finally {
      this.recoveryInFlight = undefined;
    }
  }

  private async promoteDue(): Promise<void> {
    await this.reconcileDueRetries();
  }

  private emitDiagnostic(event: RedisJobDiagnosticEvent): void {
    try {
      this.onDiagnostic?.(event);
    } catch {
      // Telemetry must never change a committed Redis job transition.
    }
  }

  private assertLeaseMutation(result: number, jobId: string): void {
    if (result !== 1) {
      throw new JobTransportError(`Job lease is no longer valid for mutation: ${jobId}`);
    }
  }

  private jobKey(jobId: string): string {
    return `${this.prefix}:job:${jobId}`;
  }

  private deadEntryKey(jobId: string): string {
    return `${this.prefix}:dead:entry:${jobId}`;
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

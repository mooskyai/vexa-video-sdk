import { createHash, randomUUID } from "node:crypto";
import type {
  JobDescriptor,
  JobEvent,
  JobFailure,
  JobProgress,
  JobRetryPolicy,
  JobSnapshot,
  JobState,
  JobSubmissionOptions
} from "@moosky-video/core";
import {
  InvalidJobError,
  JobCancelledError,
  JobExecutionError,
  JobIdempotencyConflictError,
  JobNotFoundError,
  JobQueueClosedError,
  isTerminalJobState,
  jobRetryDelay,
  normalizeJobRetryPolicy
} from "@moosky-video/core";

export interface JobProgressUpdate<TData = unknown> {
  percent?: number;
  phase?: string;
  message?: string;
  data?: TData;
}

export interface JobHandlerContext<TPayload = unknown, TResult = unknown> {
  readonly job: JobSnapshot<TPayload, TResult>;
  readonly signal: AbortSignal;
  reportProgress(update: JobProgressUpdate): Promise<void>;
}

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: JobHandlerContext<TPayload, TResult>
) => TResult | Promise<TResult>;

export interface JobHandlerOptions<TPayload = unknown, TResult = unknown> {
  retryable?: (
    error: unknown,
    job: JobSnapshot<TPayload, TResult>
  ) => boolean | Promise<boolean>;
}

export interface LocalJobQueueOptions {
  concurrency?: number;
  workerId?: string;
}

export interface JobListOptions {
  state?: JobState | readonly JobState[];
  type?: string;
}

export interface WaitForJobOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type RegisteredHandler = {
  handler: JobHandler<any, any>;
  options: JobHandlerOptions<any, any>;
};

type InternalJob = {
  snapshot: JobSnapshot<any, any>;
  fingerprint: string;
  controller: AbortController | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  terminal: Promise<JobSnapshot<any, any>>;
  resolveTerminal: (snapshot: JobSnapshot<any, any>) => void;
};

function now(): string {
  return new Date().toISOString();
}

function validateType(type: string): string {
  const normalized = type.trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(normalized)) {
    throw new InvalidJobError(
      "Job type must be 1-128 characters and contain only letters, numbers, dot, underscore, colon, or hyphen."
    );
  }
  return normalized;
}

function validateIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const normalized = key.trim();
  if (!normalized || normalized.length > 256) {
    throw new InvalidJobError("Job idempotencyKey must be between 1 and 256 characters.");
  }
  return normalized;
}

function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidJobError("Job payload/result numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") {
    throw new InvalidJobError(`Job payload/result contains unsupported value type: ${typeof value}.`);
  }

  const object = value as object;
  if (seen.has(object)) throw new InvalidJobError("Job payload/result must not contain circular references.");
  seen.add(object);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidJobError("Job payload/result objects must be plain JSON objects.");
    }

    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      if (["function", "symbol", "bigint"].includes(typeof item)) {
        throw new InvalidJobError(`Job payload/result contains a non-serializable value at ${key}.`);
      }
      output[key] = canonicalize(item, seen);
    }
    return output;
  } finally {
    seen.delete(object);
  }
}

function serializableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(canonicalize(value))) as T;
}

function fingerprint(type: string, payload: unknown): string {
  const body = JSON.stringify({ type, payload: canonicalize(payload) });
  return createHash("sha256").update(body).digest("hex");
}

function cloneSnapshot<TPayload, TResult>(snapshot: JobSnapshot<TPayload, TResult>): JobSnapshot<TPayload, TResult> {
  return serializableClone(snapshot);
}

function normalizeProgress(update: JobProgressUpdate): JobProgress {
  if (update.percent !== undefined && (!Number.isFinite(update.percent) || update.percent < 0 || update.percent > 100)) {
    throw new InvalidJobError("Job progress percent must be between 0 and 100.");
  }
  const phase = update.phase?.trim();
  const message = update.message?.trim();
  return {
    ...(update.percent !== undefined ? { percent: update.percent } : {}),
    ...(phase ? { phase } : {}),
    ...(message ? { message } : {}),
    ...(update.data !== undefined ? { data: serializableClone(update.data) } : {}),
    updatedAt: now()
  };
}

function failureOf(error: unknown, attempt: number): JobFailure {
  const value = error as { name?: unknown; message?: unknown; code?: unknown } | null;
  return {
    name: typeof value?.name === "string" ? value.name : "Error",
    message: typeof value?.message === "string" ? value.message : String(error),
    ...(typeof value?.code === "string" ? { code: value.code } : {}),
    attempt,
    at: now()
  };
}

function isCancellationError(error: unknown): boolean {
  const value = error as { name?: unknown; code?: unknown } | null;
  return value?.name === "AbortError" || value?.code === "PROCESS_ABORTED" || value?.code === "JOB_CANCELLED";
}

function createInitialSnapshot<TPayload>(
  type: string,
  payload: TPayload,
  options: JobSubmissionOptions,
  id = randomUUID()
): JobSnapshot<TPayload, never> {
  const timestamp = now();
  const idempotencyKey = validateIdempotencyKey(options.idempotencyKey);
  let retry: JobRetryPolicy;
  try {
    retry = normalizeJobRetryPolicy(options.retry);
  } catch (error) {
    throw new InvalidJobError(error instanceof Error ? error.message : String(error));
  }
  const descriptor: JobDescriptor<TPayload> = {
    schemaVersion: 1,
    id,
    type: validateType(type),
    payload: serializableClone(payload),
    createdAt: timestamp,
    retry,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(options.metadata ? { metadata: serializableClone(options.metadata) } : {})
  };
  return {
    descriptor,
    state: "queued",
    attempt: 0,
    updatedAt: timestamp,
    cancellationRequested: false
  };
}

export class JobHandle<TPayload = unknown, TResult = unknown> {
  readonly id: string;
  private readonly queue: JobQueue;

  constructor(queue: JobQueue, id: string) {
    this.queue = queue;
    this.id = id;
  }

  snapshot(): JobSnapshot<TPayload, TResult> {
    return this.queue.get<TPayload, TResult>(this.id);
  }

  async wait(): Promise<JobSnapshot<TPayload, TResult>> {
    return await this.queue.wait<TPayload, TResult>(this.id);
  }

  async result(): Promise<TResult> {
    const terminal = await this.wait();
    if (terminal.state === "succeeded") return terminal.result as TResult;
    if (terminal.state === "cancelled") throw new JobCancelledError(this.id);
    throw new JobExecutionError(this.id, terminal.error?.message ?? "Unknown job failure.");
  }

  cancel(): boolean {
    return this.queue.cancel(this.id);
  }
}

export class JobQueue {
  private readonly concurrency: number;
  private readonly workerId: string;
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly jobs = new Map<string, InternalJob>();
  private readonly idempotency = new Map<string, { fingerprint: string; jobId: string }>();
  private readonly pending: string[] = [];
  private readonly listeners = new Set<(event: JobEvent) => void>();
  private active = 0;
  private draining = false;
  private closed = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(options: LocalJobQueueOptions = {}) {
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency <= 0 || concurrency > 64) {
      throw new InvalidJobError("Job queue concurrency must be an integer between 1 and 64.");
    }
    this.concurrency = concurrency;
    this.workerId = options.workerId?.trim() || `local-${process.pid}`;
  }

  register<TPayload, TResult>(
    type: string,
    handler: JobHandler<TPayload, TResult>,
    options: JobHandlerOptions<TPayload, TResult> = {}
  ): this {
    const normalized = validateType(type);
    if (this.handlers.has(normalized)) throw new InvalidJobError(`Job handler is already registered: ${normalized}`);
    this.handlers.set(normalized, { handler, options });
    return this;
  }

  unregister(type: string): boolean {
    return this.handlers.delete(type);
  }

  submit<TPayload, TResult = unknown>(
    type: string,
    payload: TPayload,
    options: JobSubmissionOptions = {}
  ): JobHandle<TPayload, TResult> {
    if (this.closed) throw new JobQueueClosedError();
    const normalizedType = validateType(type);
    if (!this.handlers.has(normalizedType)) {
      throw new InvalidJobError(`No local job handler is registered for type: ${normalizedType}`);
    }

    const normalizedPayload = serializableClone(payload);
    const valueFingerprint = fingerprint(normalizedType, normalizedPayload);
    const idempotencyKey = validateIdempotencyKey(options.idempotencyKey);
    if (idempotencyKey) {
      const existing = this.idempotency.get(idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== valueFingerprint) throw new JobIdempotencyConflictError(idempotencyKey);
        return new JobHandle<TPayload, TResult>(this, existing.jobId);
      }
    }

    const snapshot = createInitialSnapshot(normalizedType, normalizedPayload, {
      ...options,
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
    let resolveTerminal!: (snapshot: JobSnapshot<any, any>) => void;
    const terminal = new Promise<JobSnapshot<any, any>>((resolve) => {
      resolveTerminal = resolve;
    });
    const internal: InternalJob = { snapshot, fingerprint: valueFingerprint, terminal, resolveTerminal, controller: undefined, retryTimer: undefined };
    this.jobs.set(snapshot.descriptor.id, internal);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, { fingerprint: valueFingerprint, jobId: snapshot.descriptor.id });
    this.pending.push(snapshot.descriptor.id);
    this.emit("submitted", snapshot);
    this.scheduleDrain();
    return new JobHandle<TPayload, TResult>(this, snapshot.descriptor.id);
  }

  get<TPayload = unknown, TResult = unknown>(jobId: string): JobSnapshot<TPayload, TResult> {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    return cloneSnapshot(job.snapshot) as JobSnapshot<TPayload, TResult>;
  }

  list(options: JobListOptions = {}): readonly JobSnapshot[] {
    const states = options.state === undefined
      ? null
      : new Set(Array.isArray(options.state) ? options.state : [options.state]);
    return [...this.jobs.values()]
      .map((job) => cloneSnapshot(job.snapshot))
      .filter((job) => (!states || states.has(job.state)) && (!options.type || job.descriptor.type === options.type))
      .sort((a, b) => a.descriptor.createdAt.localeCompare(b.descriptor.createdAt));
  }

  async wait<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobSnapshot<TPayload, TResult>> {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    if (isTerminalJobState(job.snapshot.state)) return cloneSnapshot(job.snapshot) as JobSnapshot<TPayload, TResult>;
    return cloneSnapshot(await job.terminal) as JobSnapshot<TPayload, TResult>;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    if (isTerminalJobState(job.snapshot.state)) return false;

    job.snapshot.cancellationRequested = true;
    job.snapshot.updatedAt = now();
    if (job.snapshot.state === "running") {
      job.controller?.abort();
      return true;
    }

    if (job.retryTimer) {
      clearTimeout(job.retryTimer);
      job.retryTimer = undefined;
    }
    this.finishCancelled(job);
    return true;
  }

  onEvent(listener: (event: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  async close(options: { cancelRunning?: boolean } = {}): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) {
      if (isTerminalJobState(job.snapshot.state)) continue;
      if (job.snapshot.state === "running" && !options.cancelRunning) continue;
      this.cancel(job.snapshot.descriptor.id);
    }
    await this.waitForIdle();
  }

  private emit(type: JobEvent["type"], snapshot: JobSnapshot): void {
    const event: JobEvent = { type, at: now(), job: cloneSnapshot(snapshot) };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must never affect job execution.
      }
    }
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      let job: InternalJob | undefined;
      while (this.pending.length > 0 && !job) {
        const id = this.pending.shift()!;
        const candidate = this.jobs.get(id);
        if (candidate?.snapshot.state === "queued") job = candidate;
      }
      if (!job) break;
      this.active += 1;
      void this.execute(job).finally(() => {
        this.active -= 1;
        this.resolveIdleIfNeeded();
        this.scheduleDrain();
      });
    }
    this.resolveIdleIfNeeded();
  }

  private async execute(job: InternalJob): Promise<void> {
    const registration = this.handlers.get(job.snapshot.descriptor.type);
    if (!registration) {
      this.finishFailed(job, new InvalidJobError(`No job handler is registered for type: ${job.snapshot.descriptor.type}`));
      return;
    }

    const controller = new AbortController();
    job.controller = controller;
    job.snapshot.state = "running";
    job.snapshot.attempt += 1;
    job.snapshot.workerId = this.workerId;
    job.snapshot.startedAt ??= now();
    job.snapshot.updatedAt = now();
    delete job.snapshot.nextAttemptAt;
    delete job.snapshot.error;
    this.emit("started", job.snapshot);

    const context: JobHandlerContext = {
      job: cloneSnapshot(job.snapshot),
      signal: controller.signal,
      reportProgress: async (update) => {
        if (isTerminalJobState(job.snapshot.state)) return;
        job.snapshot.progress = normalizeProgress(update);
        job.snapshot.updatedAt = job.snapshot.progress.updatedAt;
        this.emit("progress", job.snapshot);
      }
    };

    try {
      const result = await registration.handler(job.snapshot.descriptor.payload, context);
      if (job.snapshot.cancellationRequested || controller.signal.aborted) {
        this.finishCancelled(job);
        return;
      }
      job.snapshot.result = serializableClone(result);
      job.snapshot.state = "succeeded";
      job.snapshot.completedAt = now();
      job.snapshot.updatedAt = job.snapshot.completedAt;
      job.snapshot.progress = {
        ...(job.snapshot.progress ?? {}),
        percent: 100,
        updatedAt: job.snapshot.updatedAt
      };
      this.emit("succeeded", job.snapshot);
      job.resolveTerminal(cloneSnapshot(job.snapshot));
    } catch (error) {
      if (job.snapshot.cancellationRequested || controller.signal.aborted || isCancellationError(error)) {
        this.finishCancelled(job);
        return;
      }

      let retryable = true;
      if (registration.options.retryable) {
        retryable = await registration.options.retryable(error, cloneSnapshot(job.snapshot));
      }
      const policy = job.snapshot.descriptor.retry;
      if (retryable && job.snapshot.attempt < policy.maxAttempts) {
        const delay = jobRetryDelay(policy, job.snapshot.attempt);
        const nextAttempt = new Date(Date.now() + delay).toISOString();
        job.snapshot.state = "retrying";
        job.snapshot.error = failureOf(error, job.snapshot.attempt);
        job.snapshot.nextAttemptAt = nextAttempt;
        job.snapshot.updatedAt = now();
        this.emit("retrying", job.snapshot);
        const requeue = () => {
          job.retryTimer = undefined;
          if (job.snapshot.cancellationRequested) {
            this.finishCancelled(job);
            this.resolveIdleIfNeeded();
            return;
          }
          job.snapshot.state = "queued";
          job.snapshot.updatedAt = now();
          delete job.snapshot.nextAttemptAt;
          this.pending.push(job.snapshot.descriptor.id);
          this.scheduleDrain();
        };
        if (delay === 0) queueMicrotask(requeue);
        else job.retryTimer = setTimeout(requeue, delay);
        return;
      }
      this.finishFailed(job, error);
    } finally {
      job.controller = undefined;
    }
  }

  private finishFailed(job: InternalJob, error: unknown): void {
    job.snapshot.state = "failed";
    job.snapshot.error = failureOf(error, Math.max(1, job.snapshot.attempt));
    job.snapshot.completedAt = now();
    job.snapshot.updatedAt = job.snapshot.completedAt;
    delete job.snapshot.nextAttemptAt;
    this.emit("failed", job.snapshot);
    job.resolveTerminal(cloneSnapshot(job.snapshot));
  }

  private finishCancelled(job: InternalJob): void {
    if (isTerminalJobState(job.snapshot.state)) return;
    job.snapshot.state = "cancelled";
    job.snapshot.completedAt = now();
    job.snapshot.updatedAt = job.snapshot.completedAt;
    job.snapshot.cancellationRequested = true;
    delete job.snapshot.nextAttemptAt;
    this.emit("cancelled", job.snapshot);
    job.resolveTerminal(cloneSnapshot(job.snapshot));
    this.resolveIdleIfNeeded();
  }

  private isIdle(): boolean {
    return this.active === 0 && [...this.jobs.values()].every((job) => isTerminalJobState(job.snapshot.state));
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

export interface DistributedJobTransport {
  submit(snapshot: JobSnapshot, fingerprint: string): Promise<JobSnapshot>;
  get(jobId: string): Promise<JobSnapshot | null>;
  claim(workerId: string, waitMs: number): Promise<JobSnapshot | null>;
  save(snapshot: JobSnapshot): Promise<void>;
  finish(snapshot: JobSnapshot): Promise<void>;
  scheduleRetry(snapshot: JobSnapshot, availableAtMs: number): Promise<void>;
  cancel(jobId: string): Promise<JobSnapshot | null>;
  isCancellationRequested(jobId: string): Promise<boolean>;
}

export class DistributedJobQueue {
  constructor(private readonly transport: DistributedJobTransport) {}

  async submit<TPayload, TResult = unknown>(
    type: string,
    payload: TPayload,
    options: JobSubmissionOptions = {}
  ): Promise<JobSnapshot<TPayload, TResult>> {
    const snapshot = createInitialSnapshot(type, payload, options);
    const valueFingerprint = fingerprint(snapshot.descriptor.type, snapshot.descriptor.payload);
    return await this.transport.submit(snapshot, valueFingerprint) as JobSnapshot<TPayload, TResult>;
  }

  async get<TPayload = unknown, TResult = unknown>(jobId: string): Promise<JobSnapshot<TPayload, TResult>> {
    const snapshot = await this.transport.get(jobId);
    if (!snapshot) throw new JobNotFoundError(jobId);
    return snapshot as JobSnapshot<TPayload, TResult>;
  }

  async cancel(jobId: string): Promise<JobSnapshot> {
    const snapshot = await this.transport.cancel(jobId);
    if (!snapshot) throw new JobNotFoundError(jobId);
    return snapshot;
  }

  async wait<TPayload = unknown, TResult = unknown>(
    jobId: string,
    options: WaitForJobOptions = {}
  ): Promise<JobSnapshot<TPayload, TResult>> {
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 10) {
      throw new InvalidJobError("pollIntervalMs must be at least 10ms.");
    }
    const started = Date.now();
    while (true) {
      if (options.signal?.aborted) throw new JobCancelledError(jobId);
      const snapshot = await this.get<TPayload, TResult>(jobId);
      if (isTerminalJobState(snapshot.state)) return snapshot;
      if (options.timeoutMs !== undefined && Date.now() - started >= options.timeoutMs) {
        throw new JobExecutionError(jobId, `Wait exceeded timeout of ${options.timeoutMs}ms.`);
      }
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        const finish = () => {
          if (signal) signal.removeEventListener("abort", abort);
          resolve();
        };
        const timer = setTimeout(finish, pollIntervalMs);
        const abort = () => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", abort);
          reject(new JobCancelledError(jobId));
        };
        if (signal) signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}

export interface DistributedJobWorkerOptions {
  workerId?: string;
  concurrency?: number;
  claimWaitMs?: number;
  cancellationPollMs?: number;
}

export class DistributedJobWorker {
  private readonly handlers = new Map<string, RegisteredHandler>();
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly claimWaitMs: number;
  private readonly cancellationPollMs: number;
  private stopping = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly transport: DistributedJobTransport,
    options: DistributedJobWorkerOptions = {}
  ) {
    this.workerId = options.workerId?.trim() || `worker-${randomUUID()}`;
    this.concurrency = options.concurrency ?? 1;
    this.claimWaitMs = options.claimWaitMs ?? 1_000;
    this.cancellationPollMs = options.cancellationPollMs ?? 250;
    if (!Number.isInteger(this.concurrency) || this.concurrency <= 0 || this.concurrency > 64) {
      throw new InvalidJobError("Distributed worker concurrency must be an integer between 1 and 64.");
    }
    if (!Number.isFinite(this.claimWaitMs) || this.claimWaitMs < 10) {
      throw new InvalidJobError("Distributed worker claimWaitMs must be at least 10ms.");
    }
    if (!Number.isFinite(this.cancellationPollMs) || this.cancellationPollMs < 10) {
      throw new InvalidJobError("Distributed worker cancellationPollMs must be at least 10ms.");
    }
  }

  register<TPayload, TResult>(
    type: string,
    handler: JobHandler<TPayload, TResult>,
    options: JobHandlerOptions<TPayload, TResult> = {}
  ): this {
    const normalized = validateType(type);
    if (this.handlers.has(normalized)) throw new InvalidJobError(`Job handler is already registered: ${normalized}`);
    this.handlers.set(normalized, { handler, options });
    return this;
  }

  start(): void {
    if (this.loops.length > 0) return;
    this.stopping = false;
    this.loops = Array.from({ length: this.concurrency }, () => this.loop());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.loops);
    this.loops = [];
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      const snapshot = await this.transport.claim(this.workerId, this.claimWaitMs);
      if (!snapshot) continue;
      await this.execute(snapshot);
    }
  }

  private async execute(snapshot: JobSnapshot): Promise<void> {
    const registration = this.handlers.get(snapshot.descriptor.type);
    snapshot.state = "running";
    snapshot.attempt += 1;
    snapshot.workerId = this.workerId;
    snapshot.startedAt ??= now();
    snapshot.updatedAt = now();
    delete snapshot.nextAttemptAt;
    delete snapshot.error;
    await this.transport.save(snapshot);

    if (!registration) {
      snapshot.state = "failed";
      snapshot.error = failureOf(new InvalidJobError(`No distributed handler is registered for type: ${snapshot.descriptor.type}`), snapshot.attempt);
      snapshot.completedAt = now();
      snapshot.updatedAt = snapshot.completedAt;
      await this.transport.finish(snapshot);
      return;
    }

    const controller = new AbortController();
    if (snapshot.cancellationRequested || await this.transport.isCancellationRequested(snapshot.descriptor.id)) {
      controller.abort();
    }
    const poll = setInterval(() => {
      void this.transport.isCancellationRequested(snapshot.descriptor.id).then((requested) => {
        if (requested) controller.abort();
      }).catch(() => undefined);
    }, this.cancellationPollMs);
    poll.unref?.();

    try {
      const result = await registration.handler(snapshot.descriptor.payload, {
        job: cloneSnapshot(snapshot),
        signal: controller.signal,
        reportProgress: async (update) => {
          snapshot.progress = normalizeProgress(update);
          snapshot.updatedAt = snapshot.progress.updatedAt;
          await this.transport.save(snapshot);
        }
      });

      if (controller.signal.aborted || await this.transport.isCancellationRequested(snapshot.descriptor.id)) {
        snapshot.state = "cancelled";
        snapshot.cancellationRequested = true;
      } else {
        snapshot.state = "succeeded";
        snapshot.result = serializableClone(result);
        snapshot.progress = { ...(snapshot.progress ?? {}), percent: 100, updatedAt: now() };
      }
      snapshot.completedAt = now();
      snapshot.updatedAt = snapshot.completedAt;
      await this.transport.finish(snapshot);
    } catch (error) {
      if (controller.signal.aborted || isCancellationError(error) || await this.transport.isCancellationRequested(snapshot.descriptor.id)) {
        snapshot.state = "cancelled";
        snapshot.cancellationRequested = true;
        snapshot.completedAt = now();
        snapshot.updatedAt = snapshot.completedAt;
        await this.transport.finish(snapshot);
        return;
      }

      let retryable = true;
      if (registration.options.retryable) retryable = await registration.options.retryable(error, cloneSnapshot(snapshot));
      const policy: JobRetryPolicy = snapshot.descriptor.retry;
      if (retryable && snapshot.attempt < policy.maxAttempts) {
        const delay = jobRetryDelay(policy, snapshot.attempt);
        snapshot.state = "retrying";
        snapshot.error = failureOf(error, snapshot.attempt);
        snapshot.nextAttemptAt = new Date(Date.now() + delay).toISOString();
        snapshot.updatedAt = now();
        await this.transport.scheduleRetry(snapshot, Date.now() + delay);
        return;
      }

      snapshot.state = "failed";
      snapshot.error = failureOf(error, snapshot.attempt);
      snapshot.completedAt = now();
      snapshot.updatedAt = snapshot.completedAt;
      await this.transport.finish(snapshot);
    } finally {
      clearInterval(poll);
    }
  }
}

export const jobInternals = {
  fingerprint,
  serializableClone,
  createInitialSnapshot
};

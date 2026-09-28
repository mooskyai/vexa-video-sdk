export type JobState =
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobTerminalState = Extract<JobState, "succeeded" | "failed" | "cancelled">;

export interface JobRetryPolicy {
  /** Total attempts, including the first execution. Defaults to 1. */
  maxAttempts: number;
  /** Delay before the first retry. Defaults to 1 second. */
  backoffMs: number;
  /** Exponential multiplier applied after each failed attempt. Defaults to 2. */
  backoffMultiplier: number;
  /** Upper bound for retry delay. Defaults to 30 seconds. */
  maxBackoffMs: number;
}

export interface JobRetryOptions {
  maxAttempts?: number;
  backoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
}

export type JobMetadataValue = string | number | boolean | null;

export interface JobSubmissionOptions {
  /**
   * Reusing the same key with the same type/payload returns the existing job.
   * Reusing it with different work is rejected.
   */
  idempotencyKey?: string;
  retry?: JobRetryOptions;
  metadata?: Readonly<Record<string, JobMetadataValue>>;
}

export interface JobDescriptor<TPayload = unknown> {
  schemaVersion: 1;
  id: string;
  type: string;
  payload: TPayload;
  createdAt: string;
  retry: JobRetryPolicy;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, JobMetadataValue>>;
}

export interface JobProgress<TData = unknown> {
  percent?: number;
  phase?: string;
  message?: string;
  data?: TData;
  updatedAt: string;
}

export interface JobFailure {
  name: string;
  message: string;
  code?: string;
  attempt: number;
  at: string;
}

export interface JobSnapshot<TPayload = unknown, TResult = unknown> {
  descriptor: JobDescriptor<TPayload>;
  state: JobState;
  attempt: number;
  updatedAt: string;
  cancellationRequested: boolean;
  startedAt?: string;
  completedAt?: string;
  nextAttemptAt?: string;
  workerId?: string;
  progress?: JobProgress;
  result?: TResult;
  error?: JobFailure;
}

export type JobEventType =
  | "submitted"
  | "started"
  | "progress"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobEvent<TPayload = unknown, TResult = unknown> {
  type: JobEventType;
  at: string;
  job: JobSnapshot<TPayload, TResult>;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite number greater than or equal to zero.`);
  }
  return value;
}

export function normalizeJobRetryPolicy(options: JobRetryOptions = {}): JobRetryPolicy {
  const maxAttempts = positiveInteger(options.maxAttempts ?? 1, "job.retry.maxAttempts");
  if (maxAttempts > 100) throw new TypeError("job.retry.maxAttempts must be 100 or less.");

  const backoffMs = nonNegativeFinite(options.backoffMs ?? 1_000, "job.retry.backoffMs");
  const backoffMultiplier = nonNegativeFinite(
    options.backoffMultiplier ?? 2,
    "job.retry.backoffMultiplier"
  );
  const maxBackoffMs = nonNegativeFinite(options.maxBackoffMs ?? 30_000, "job.retry.maxBackoffMs");

  if (backoffMultiplier < 1) {
    throw new TypeError("job.retry.backoffMultiplier must be at least 1.");
  }
  if (maxBackoffMs < backoffMs) {
    throw new TypeError("job.retry.maxBackoffMs must be greater than or equal to job.retry.backoffMs.");
  }

  return { maxAttempts, backoffMs, backoffMultiplier, maxBackoffMs };
}

export function jobRetryDelay(policy: JobRetryPolicy, failedAttempt: number): number {
  positiveInteger(failedAttempt, "failedAttempt");
  const exponent = Math.max(0, failedAttempt - 1);
  return Math.min(policy.maxBackoffMs, policy.backoffMs * (policy.backoffMultiplier ** exponent));
}

export function isTerminalJobState(state: JobState): state is JobTerminalState {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

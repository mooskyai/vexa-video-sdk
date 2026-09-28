export type HostedRenderState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface HostedRenderRequest<TPayload = unknown> {
  schemaVersion: 1;
  type: string;
  payload: TPayload;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HostedRenderProgress {
  percent?: number;
  phase?: string;
  message?: string;
  updatedAt?: string;
}

export interface HostedRenderArtifact {
  url: string;
  name?: string;
  contentType?: string;
  sizeBytes?: number;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HostedRenderFailure {
  message: string;
  code?: string;
  retryable?: boolean;
}

export interface HostedRenderJob<TResult = unknown> {
  id: string;
  state: HostedRenderState;
  createdAt?: string;
  updatedAt?: string;
  progress?: HostedRenderProgress;
  result?: TResult;
  artifacts?: readonly HostedRenderArtifact[];
  error?: HostedRenderFailure;
}

export interface HostedRenderCallOptions {
  signal?: AbortSignal;
}

export interface HostedRenderWaitOptions extends HostedRenderCallOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface HostedRenderAdapter {
  submit<TPayload = unknown, TResult = unknown>(
    request: HostedRenderRequest<TPayload>,
    options?: HostedRenderCallOptions
  ): Promise<HostedRenderJob<TResult>>;

  get<TResult = unknown>(
    jobId: string,
    options?: HostedRenderCallOptions
  ): Promise<HostedRenderJob<TResult>>;

  cancel<TResult = unknown>(
    jobId: string,
    options?: HostedRenderCallOptions
  ): Promise<HostedRenderJob<TResult>>;
}

export function isHostedRenderTerminal(state: HostedRenderState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

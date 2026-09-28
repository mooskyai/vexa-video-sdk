import type {
  HostedRenderAdapter,
  HostedRenderCallOptions,
  HostedRenderJob,
  HostedRenderRequest,
  HostedRenderWaitOptions
} from "@vexa-video/core";
import { isHostedRenderTerminal } from "@vexa-video/core";

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be greater than 0.`);
  return value;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Hosted render wait was aborted."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Hosted render wait was aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class HostedRenderer {
  readonly #adapter: HostedRenderAdapter;

  constructor(adapter: HostedRenderAdapter) {
    if (!adapter || typeof adapter.submit !== "function" || typeof adapter.get !== "function" || typeof adapter.cancel !== "function") {
      throw new TypeError("HostedRenderer requires a submit/get/cancel adapter.");
    }
    this.#adapter = adapter;
  }

  submit<TPayload = unknown, TResult = unknown>(
    request: HostedRenderRequest<TPayload>,
    options: HostedRenderCallOptions = {}
  ): Promise<HostedRenderJob<TResult>> {
    if (!request || request.schemaVersion !== 1 || !request.type?.trim()) {
      throw new TypeError("Hosted render requests require schemaVersion 1 and a non-empty type.");
    }
    return this.#adapter.submit<TPayload, TResult>(request, options);
  }

  get<TResult = unknown>(jobId: string, options: HostedRenderCallOptions = {}): Promise<HostedRenderJob<TResult>> {
    const normalized = jobId.trim();
    if (!normalized) throw new TypeError("Hosted render jobId is required.");
    return this.#adapter.get<TResult>(normalized, options);
  }

  cancel<TResult = unknown>(jobId: string, options: HostedRenderCallOptions = {}): Promise<HostedRenderJob<TResult>> {
    const normalized = jobId.trim();
    if (!normalized) throw new TypeError("Hosted render jobId is required.");
    return this.#adapter.cancel<TResult>(normalized, options);
  }

  async wait<TResult = unknown>(jobId: string, options: HostedRenderWaitOptions = {}): Promise<HostedRenderJob<TResult>> {
    const pollIntervalMs = positiveFinite(options.pollIntervalMs ?? 1_000, "hosted.pollIntervalMs");
    const timeoutMs = positiveFinite(options.timeoutMs ?? 30 * 60 * 1_000, "hosted.timeoutMs");
    const startedAt = Date.now();

    for (;;) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Hosted render wait was aborted.");
      const job = await this.get<TResult>(jobId, options);
      if (isHostedRenderTerminal(job.state)) return job;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Hosted render wait exceeded timeout of ${timeoutMs}ms for job ${jobId}.`);
      }
      await sleep(pollIntervalMs, options.signal);
    }
  }
}

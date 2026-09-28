import { computed, signal, type Signal, type WritableSignal } from "@angular/core";
import { Observable, type Subscription } from "rxjs";
import type { JobSnapshot, JobSubmissionOptions } from "@moosky-video/core/browser";
import type { NormalizedVexaVideoConfig } from "./config.js";
import type {
  VexaProjectRenderRequest,
  VexaRenderResult,
  VexaVideoRenderRequest
} from "./contracts.js";
import { VexaVideoTransport } from "./transport.js";

function isTerminal(state: JobSnapshot["state"]): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export abstract class VexaRenderProvider {
  abstract submit<TPayload, TResult = unknown>(
    type: string,
    payload: TPayload,
    options?: JobSubmissionOptions,
    signal?: AbortSignal
  ): Promise<JobSnapshot<TPayload, TResult>>;
  abstract get<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>>;
  abstract cancel<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>>;
}

export class TransportVexaRenderProvider extends VexaRenderProvider {
  constructor(private readonly transport: VexaVideoTransport) { super(); }
  submit<TPayload, TResult = unknown>(type: string, payload: TPayload, options?: JobSubmissionOptions, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    return this.transport.submitJob<TPayload, TResult>(type, payload, options, signal);
  }
  get<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    return this.transport.getJob<TPayload, TResult>(id, signal);
  }
  cancel<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    return this.transport.cancelJob<TPayload, TResult>(id, signal);
  }
}

export interface VexaWatchJobOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export class VexaJobRef<TPayload = unknown, TResult = unknown> {
  readonly snapshot: WritableSignal<JobSnapshot<TPayload, TResult> | null>;
  readonly state: Signal<JobSnapshot["state"] | null>;
  readonly progress: Signal<JobSnapshot["progress"] | null>;
  readonly result: Signal<TResult | null>;
  readonly error: Signal<JobSnapshot["error"] | null>;
  readonly done: Signal<boolean>;
  private subscription: Subscription | null = null;

  constructor(
    readonly id: string,
    private readonly service: VexaRenderService,
    initial?: JobSnapshot<TPayload, TResult>
  ) {
    this.snapshot = signal(initial ?? null);
    this.state = computed(() => this.snapshot()?.state ?? null);
    this.progress = computed(() => this.snapshot()?.progress ?? null);
    this.result = computed(() => this.snapshot()?.result ?? null);
    this.error = computed(() => this.snapshot()?.error ?? null);
    this.done = computed(() => {
      const current = this.snapshot();
      return current ? isTerminal(current.state) : false;
    });
  }

  start(options: VexaWatchJobOptions = {}): this {
    if (this.subscription) return this;
    this.subscription = this.service.watch<TPayload, TResult>(this.id, options).subscribe({
      next: (snapshot) => this.snapshot.set(snapshot),
      complete: () => { this.subscription = null; }
    });
    return this;
  }

  async refresh(signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    const value = await this.service.get<TPayload, TResult>(this.id, signal);
    this.snapshot.set(value);
    return value;
  }

  async cancel(signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    const value = await this.service.cancel<TPayload, TResult>(this.id, signal);
    this.snapshot.set(value);
    return value;
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}

export class VexaRenderService {
  constructor(
    private readonly provider: VexaRenderProvider,
    private readonly config: NormalizedVexaVideoConfig
  ) {}

  async submit<TPayload, TResult = unknown>(
    type: string,
    payload: TPayload,
    options: JobSubmissionOptions = {},
    signal?: AbortSignal
  ): Promise<VexaJobRef<TPayload, TResult>> {
    const snapshot = await this.provider.submit<TPayload, TResult>(type, payload, options, signal);
    return new VexaJobRef<TPayload, TResult>(snapshot.descriptor.id, this, snapshot).start();
  }

  renderVideo(
    request: VexaVideoRenderRequest,
    options: JobSubmissionOptions = {},
    signal?: AbortSignal
  ): Promise<VexaJobRef<VexaVideoRenderRequest, VexaRenderResult>> {
    return this.submit("video.render", request, options, signal);
  }

  renderProject(
    request: VexaProjectRenderRequest,
    options: JobSubmissionOptions = {},
    signal?: AbortSignal
  ): Promise<VexaJobRef<VexaProjectRenderRequest, VexaRenderResult>> {
    return this.submit("project.render", request, options, signal);
  }

  get<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    return this.provider.get<TPayload, TResult>(id, signal);
  }

  cancel<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    return this.provider.cancel<TPayload, TResult>(id, signal);
  }

  track<TPayload = unknown, TResult = unknown>(id: string): VexaJobRef<TPayload, TResult> {
    return new VexaJobRef<TPayload, TResult>(id, this).start();
  }

  watch<TPayload = unknown, TResult = unknown>(id: string, options: VexaWatchJobOptions = {}): Observable<JobSnapshot<TPayload, TResult>> {
    const interval = options.pollIntervalMs ?? this.config.pollIntervalMs;
    return new Observable<JobSnapshot<TPayload, TResult>>((subscriber) => {
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      const external = options.signal;
      const abort = () => controller.abort();
      external?.addEventListener("abort", abort, { once: true });

      const poll = async () => {
        if (!active || controller.signal.aborted) return;
        try {
          const snapshot = await this.provider.get<TPayload, TResult>(id, controller.signal);
          if (!active) return;
          subscriber.next(snapshot);
          if (isTerminal(snapshot.state)) {
            subscriber.complete();
            return;
          }
          timer = setTimeout(() => void poll(), interval);
        } catch (error) {
          if (controller.signal.aborted) return;
          subscriber.error(error);
        }
      };
      void poll();

      return () => {
        active = false;
        controller.abort();
        if (timer) clearTimeout(timer);
        external?.removeEventListener("abort", abort);
      };
    });
  }
}

import type { JobSnapshot, JobSubmissionOptions } from "@vexa-video/core/browser";
import type { NormalizedVexaVideoConfig, VexaRequestContext } from "./config.js";
import { joinVexaUrl } from "./config.js";
import type { VexaMediaAsset, VexaUploadOptions } from "./contracts.js";

export class VexaAngularHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown, code?: string) {
    super(message);
    this.name = "VexaAngularHttpError";
    this.status = status;
    this.body = body;
    if (code) this.code = code;
  }
}

export abstract class VexaVideoTransport {
  abstract upload(file: Blob, options?: VexaUploadOptions): Promise<VexaMediaAsset>;
  abstract submitJob<TPayload, TResult = unknown>(
    type: string,
    payload: TPayload,
    options?: JobSubmissionOptions,
    signal?: AbortSignal
  ): Promise<JobSnapshot<TPayload, TResult>>;
  abstract getJob<TPayload = unknown, TResult = unknown>(
    id: string,
    signal?: AbortSignal
  ): Promise<JobSnapshot<TPayload, TResult>>;
  abstract cancelJob<TPayload = unknown, TResult = unknown>(
    id: string,
    signal?: AbortSignal
  ): Promise<JobSnapshot<TPayload, TResult>>;
  abstract mediaUrl(path: string): string;
}

function filenameOf(file: Blob, provided?: string): string {
  if (provided?.trim()) return provided.trim();
  const candidate = (file as Blob & { name?: string }).name;
  return candidate?.trim() || "media.bin";
}

export class FetchVexaVideoTransport extends VexaVideoTransport {
  constructor(private readonly config: NormalizedVexaVideoConfig) {
    super();
  }

  private async headers(context: VexaRequestContext): Promise<Record<string, string>> {
    const configured = this.config.headers;
    if (!configured) return {};
    return { ...(typeof configured === "function" ? await configured(context) : configured) };
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const headers = await this.headers({ method, path, kind: "json" });
    if (body !== undefined) headers["content-type"] ??= "application/json";
    const response = await this.config.fetch(joinVexaUrl(this.config.baseUrl, path), {
      method,
      headers,
      credentials: this.config.credentials,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {})
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    if (!response.ok) {
      const object = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
      const message = typeof object?.error === "string"
        ? object.error
        : `Vexa request failed with HTTP ${response.status}.`;
      const code = typeof object?.code === "string" ? object.code : undefined;
      throw new VexaAngularHttpError(response.status, message, parsed, code);
    }
    return parsed as T;
  }

  async upload(file: Blob, options: VexaUploadOptions = {}): Promise<VexaMediaAsset> {
    const path = this.config.paths.media;
    const headers = await this.headers({ method: "POST", path, kind: "upload" });
    headers["content-type"] ??= options.contentType || file.type || "application/octet-stream";
    headers["x-vexa-file-name"] = encodeURIComponent(filenameOf(file, options.filename));
    const response = await this.config.fetch(joinVexaUrl(this.config.baseUrl, path), {
      method: "POST",
      headers,
      credentials: this.config.credentials,
      body: file,
      ...(options.signal ? { signal: options.signal } : {})
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!response.ok) {
      throw new VexaAngularHttpError(
        response.status,
        parsed?.error ?? `Vexa upload failed with HTTP ${response.status}.`,
        parsed,
        typeof parsed?.code === "string" ? parsed.code : undefined
      );
    }
    return parsed as VexaMediaAsset;
  }

  async submitJob<TPayload, TResult = unknown>(
    type: string,
    payload: TPayload,
    options: JobSubmissionOptions = {},
    signal?: AbortSignal
  ): Promise<JobSnapshot<TPayload, TResult>> {
    const value = await this.json<{ job: JobSnapshot<TPayload, TResult> }>(
      "POST",
      this.config.paths.jobs,
      { type, payload, options },
      signal
    );
    return value.job;
  }

  async getJob<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    const value = await this.json<{ job: JobSnapshot<TPayload, TResult> }>(
      "GET",
      `${this.config.paths.jobs}/${encodeURIComponent(id)}`,
      undefined,
      signal
    );
    return value.job;
  }

  async cancelJob<TPayload = unknown, TResult = unknown>(id: string, signal?: AbortSignal): Promise<JobSnapshot<TPayload, TResult>> {
    const value = await this.json<{ job: JobSnapshot<TPayload, TResult> }>(
      "DELETE",
      `${this.config.paths.jobs}/${encodeURIComponent(id)}`,
      undefined,
      signal
    );
    return value.job;
  }

  mediaUrl(path: string): string {
    if (/^https?:\/\//iu.test(path)) return path;
    return joinVexaUrl(this.config.baseUrl, path);
  }
}

import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  HttpMediaSource,
  HttpStorageOptions,
  MediaStorageSource,
  ObjectMediaSource,
  ObjectStorageProvider,
  StorageProvider,
  StorageResolveOptions,
  StorageTransferOptions,
  StorageTransferResult,
  StorageUploadResult,
  StorageWorkspaceOptions
} from "@vexa-video/core";
import {
  InvalidStorageError,
  RemoteMediaRejectedError,
  StorageAdapterNotFoundError,
  StorageTransferError
} from "@vexa-video/core";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export interface StorageAdapter {
  readonly provider: ObjectStorageProvider;
  download(
    reference: ObjectMediaSource,
    destination: string,
    options: StorageTransferOptions
  ): Promise<StorageTransferResult | void>;
  upload?(
    sourcePath: string,
    reference: ObjectMediaSource,
    options: StorageTransferOptions
  ): Promise<StorageUploadResult | void>;
}

export interface StorageAdapterHandlers {
  download: StorageAdapter["download"];
  upload?: NonNullable<StorageAdapter["upload"]>;
}

export interface StorageOptions {
  adapters?: readonly StorageAdapter[];
  http?: HttpStorageOptions;
  workspaceRoot?: string;
}

export interface ResolvedMediaSource {
  readonly path: string;
  readonly provider: StorageProvider;
  readonly original: MediaStorageSource;
  readonly managed: boolean;
  readonly sizeBytes: number | null;
  cleanup(): Promise<void>;
}

function validatePositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new InvalidStorageError(`${label} must be a positive integer.`);
  }
}

function validateStorageOptions(options: StorageTransferOptions): void {
  validatePositiveInteger(options.maxBytes, "storage.maxBytes");
  validatePositiveInteger(options.timeoutMs, "storage.timeoutMs");
}

function safeBasename(value: string, fallback = "media.bin"): string {
  const raw = basename(value).replace(/[^a-zA-Z0-9._-]/gu, "-");
  if (!raw || raw === "." || raw === "..") return fallback;
  return raw.slice(0, 180);
}

function objectReferenceFromUrl(url: URL): ObjectMediaSource | null {
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!key) throw new InvalidStorageError(`Object-storage reference is missing a key: ${url.toString()}`);

  if (url.protocol === "s3:") {
    if (!url.hostname) throw new InvalidStorageError("S3 references require a bucket name.");
    return { kind: "object", provider: "s3", bucket: url.hostname, key };
  }
  if (url.protocol === "gs:" || url.protocol === "gcs:") {
    if (!url.hostname) throw new InvalidStorageError("GCS references require a bucket name.");
    return { kind: "object", provider: "gcs", bucket: url.hostname, key };
  }
  if (url.protocol === "az:" || url.protocol === "azure:") {
    if (!url.hostname) throw new InvalidStorageError("Azure references require a container name.");
    return { kind: "object", provider: "azure", container: url.hostname, key };
  }
  return null;
}

export function parseStorageSource(source: string | URL | MediaStorageSource): MediaStorageSource {
  if (typeof source === "object" && !(source instanceof URL)) {
    if (source.kind === "local") {
      if (!source.path.trim()) throw new InvalidStorageError("Local media path cannot be empty.");
      return { kind: "local", path: source.path.trim() };
    }
    if (source.kind === "http") {
      return { ...source, url: source.url.trim() };
    }
    if (source.kind === "object") {
      if (!source.key.trim()) throw new InvalidStorageError("Object-storage key cannot be empty.");
      return { ...source, key: source.key.trim() };
    }
    throw new InvalidStorageError("Unsupported storage source.");
  }

  const value = source instanceof URL ? source.toString() : source.trim();
  if (!value) throw new InvalidStorageError("Media source cannot be empty.");

  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    return { kind: "local", path: value };
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return { kind: "http", url: url.toString() };
  }
  if (url.protocol === "file:") {
    throw new InvalidStorageError("file: URLs are not accepted. Pass a local filesystem path instead.");
  }
  const object = objectReferenceFromUrl(url);
  if (object) return object;
  throw new InvalidStorageError(`Unsupported media-source protocol: ${url.protocol}`);
}

function sourceLabel(source: MediaStorageSource): string {
  if (source.kind === "local") return source.path;
  if (source.kind === "http") return source.url;
  const bucket = source.bucket ?? source.container ?? "object";
  return `${source.provider}://${bucket}/${source.key}`;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/u.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

async function resolvePublicAddress(hostname: string, allowPrivateNetwork: boolean): Promise<{ address: string; family: 4 | 6 }> {
  const lower = hostname.toLowerCase();
  if (!allowPrivateNetwork && (lower === "localhost" || lower.endsWith(".localhost"))) {
    throw new RemoteMediaRejectedError(`Remote media host is not allowed: ${hostname}`);
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new StorageTransferError(`Remote media host did not resolve: ${hostname}`);
  }
  if (!allowPrivateNetwork) {
    const privateAddress = addresses.find((entry) => isPrivateIp(entry.address));
    if (privateAddress) {
      throw new RemoteMediaRejectedError(
        `Remote media resolved to a private or reserved address: ${privateAddress.address}`
      );
    }
  }
  const selected = addresses[0];
  if (!selected) throw new StorageTransferError(`Remote media host did not resolve: ${hostname}`);
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function sanitizedHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = key.toLowerCase();
    if (["host", "content-length", "connection", "transfer-encoding"].includes(lower)) continue;
    output[key] = value;
  }
  return output;
}

function redirectHeaders(
  headers: Readonly<Record<string, string>>,
  previous: URL,
  next: URL
): Record<string, string> {
  const output = { ...headers };
  if (previous.origin !== next.origin) {
    for (const key of Object.keys(output)) {
      if (["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase())) delete output[key];
    }
  }
  return output;
}

async function openHttpResponse(
  url: URL,
  options: HttpStorageOptions,
  headers: Readonly<Record<string, string>>
): Promise<IncomingMessage> {
  if (url.username || url.password) {
    throw new RemoteMediaRejectedError("Credentials embedded in remote-media URLs are not allowed.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && options.allowHttp)) {
    throw new RemoteMediaRejectedError(
      url.protocol === "http:"
        ? "Plain HTTP media is disabled. Set allowHttp: true only for a trusted source."
        : `Unsupported remote-media protocol: ${url.protocol}`
    );
  }

  const resolved = await resolvePublicAddress(url.hostname, options.allowPrivateNetwork ?? false);
  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: resolved.address,
    ...(url.port ? { port: Number(url.port) } : {}),
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      "user-agent": "vexa-video-sdk/0.1",
      ...headers,
      host: url.host
    },
    ...(options.signal ? { signal: options.signal } : {})
  };
  if (url.protocol === "https:") {
    (requestOptions as RequestOptions & { servername?: string }).servername = url.hostname;
  }

  return await new Promise<IncomingMessage>((resolveResponse, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(requestOptions, resolveResponse);
    const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new StorageTransferError(`Remote media request exceeded timeout of ${timeoutMs}ms.`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function downloadHttp(
  source: HttpMediaSource,
  destination: string,
  options: HttpStorageOptions
): Promise<StorageTransferResult> {
  validateStorageOptions(options);
  validatePositiveInteger(options.maxRedirects, "storage.http.maxRedirects");

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const initial = new URL(source.url);
  const baseHeaders = {
    ...sanitizedHeaders(options.headers),
    ...sanitizedHeaders(source.headers)
  };
  const partial = `${destination}.vexa-${randomUUID()}.part`;
  await mkdir(dirname(destination), { recursive: true });

  async function follow(url: URL, headers: Readonly<Record<string, string>>, redirects: number): Promise<StorageTransferResult> {
    const response = await openHttpResponse(url, options, headers);
    const status = response.statusCode ?? 0;

    if ([301, 302, 303, 307, 308].includes(status)) {
      response.resume();
      if (redirects >= maxRedirects) {
        throw new RemoteMediaRejectedError(`Remote media exceeded ${maxRedirects} redirects.`);
      }
      const location = response.headers.location;
      if (!location) throw new StorageTransferError("Remote media redirect did not include a Location header.");
      const next = new URL(location, url);
      return await follow(next, redirectHeaders(headers, url, next), redirects + 1);
    }

    if (status < 200 || status >= 300) {
      response.resume();
      throw new StorageTransferError(`Remote media request failed with HTTP ${status}.`);
    }

    const contentLength = Number(response.headers["content-length"] ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      response.destroy();
      throw new RemoteMediaRejectedError(`Remote media exceeds the ${maxBytes}-byte download limit.`);
    }

    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new RemoteMediaRejectedError(`Remote media exceeds the ${maxBytes}-byte download limit.`));
          return;
        }
        callback(null, chunk);
      }
    });

    await pipeline(response, limiter, createWriteStream(partial), {
      ...(options.signal ? { signal: options.signal } : {})
    });
    if (options.overwrite) await rm(destination, { force: true });
    await rename(partial, destination);
    return {
      provider: "http",
      source: url.toString(),
      destination,
      bytesTransferred: bytes,
      ...(typeof response.headers["content-type"] === "string"
        ? { contentType: response.headers["content-type"] }
        : {})
    };
  }

  try {
    return await follow(initial, baseHeaders, 0);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    if (
      error instanceof InvalidStorageError ||
      error instanceof RemoteMediaRejectedError ||
      error instanceof StorageTransferError
    ) {
      throw error;
    }
    throw new StorageTransferError(`Failed to download remote media: ${initial.toString()}`, { cause: error });
  }
}

async function assertReadableFile(path: string): Promise<{ path: string; size: number }> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new InvalidStorageError(`Local media file was not found: ${path}`);
  }
  if (!info.isFile()) throw new InvalidStorageError(`Local media source is not a file: ${path}`);
  return { path, size: info.size };
}

export class MediaWorkspace {
  readonly path: string;
  #cleaned = false;

  private constructor(path: string) {
    this.path = path;
  }

  static async create(options: StorageWorkspaceOptions = {}): Promise<MediaWorkspace> {
    const root = resolve(options.root ?? tmpdir());
    await mkdir(root, { recursive: true });
    const prefix = (options.prefix ?? "vexa-media-").replace(/[^a-zA-Z0-9._-]/gu, "-") || "vexa-media-";
    return new MediaWorkspace(await mkdtemp(join(root, prefix)));
  }

  file(relativePath: string): string {
    if (!relativePath.trim() || isAbsolute(relativePath)) {
      throw new InvalidStorageError("Workspace file path must be a non-empty relative path.");
    }
    const target = resolve(this.path, relativePath);
    if (target !== this.path && !target.startsWith(`${this.path}${sep}`)) {
      throw new InvalidStorageError("Workspace file path cannot escape the managed workspace.");
    }
    return target;
  }

  async cleanup(): Promise<void> {
    if (this.#cleaned) return;
    this.#cleaned = true;
    await rm(this.path, { recursive: true, force: true });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.cleanup();
  }
}

function objectFileName(source: ObjectMediaSource): string {
  return safeBasename(source.key, `object-${randomUUID()}.bin`);
}

function httpFileName(source: HttpMediaSource): string {
  try {
    const url = new URL(source.url);
    const name = safeBasename(decodeURIComponent(url.pathname));
    return extname(name) ? name : `${name || "remote"}.bin`;
  } catch {
    return `remote-${randomUUID()}.bin`;
  }
}

export class Storage {
  readonly #adapters: ReadonlyMap<ObjectStorageProvider, StorageAdapter>;
  readonly #options: Readonly<StorageOptions>;

  constructor(options: StorageOptions = {}) {
    const adapters = new Map<ObjectStorageProvider, StorageAdapter>();
    for (const adapter of options.adapters ?? []) {
      if (adapters.has(adapter.provider)) {
        throw new InvalidStorageError(`Duplicate storage adapter for provider: ${adapter.provider}`);
      }
      adapters.set(adapter.provider, adapter);
    }
    this.#adapters = adapters;
    this.#options = Object.freeze({ ...options });
  }

  static adapter(provider: ObjectStorageProvider, handlers: StorageAdapterHandlers): StorageAdapter {
    return {
      provider,
      download: handlers.download,
      ...(handlers.upload ? { upload: handlers.upload } : {})
    };
  }

  static s3(handlers: StorageAdapterHandlers): StorageAdapter {
    return Storage.adapter("s3", handlers);
  }

  static gcs(handlers: StorageAdapterHandlers): StorageAdapter {
    return Storage.adapter("gcs", handlers);
  }

  static azure(handlers: StorageAdapterHandlers): StorageAdapter {
    return Storage.adapter("azure", handlers);
  }

  createWorkspace(options: StorageWorkspaceOptions = {}): Promise<MediaWorkspace> {
    return MediaWorkspace.create({
      ...(this.#options.workspaceRoot ? { root: this.#options.workspaceRoot } : {}),
      ...options
    });
  }

  async download(
    input: string | URL | MediaStorageSource,
    destination: string,
    options: StorageResolveOptions = {}
  ): Promise<StorageTransferResult> {
    const source = parseStorageSource(input);
    const target = resolve(destination);
    validateStorageOptions(options);
    if (!options.overwrite) {
      try {
        await stat(target);
        throw new InvalidStorageError(`Storage destination already exists: ${target}`);
      } catch (error) {
        if (error instanceof InvalidStorageError) throw error;
      }
    }
    await mkdir(dirname(target), { recursive: true });

    if (source.kind === "local") {
      const local = await assertReadableFile(resolve(source.path));
      await copyFile(local.path, target);
      return {
        provider: "local",
        source: local.path,
        destination: target,
        bytesTransferred: local.size
      };
    }

    if (source.kind === "http") {
      const httpOptions: HttpStorageOptions = {
        ...this.#options.http,
        ...options.http,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
        ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {})
      };
      return await downloadHttp(source, target, httpOptions);
    }

    const adapter = this.#adapters.get(source.provider);
    if (!adapter) throw new StorageAdapterNotFoundError(source.provider);
    const result = await adapter.download(source, target, options);
    const local = await assertReadableFile(target);
    return result ?? {
      provider: source.provider,
      source: sourceLabel(source),
      destination: target,
      bytesTransferred: local.size
    };
  }

  async upload(
    sourcePath: string,
    destination: string | URL | MediaStorageSource,
    options: StorageTransferOptions = {}
  ): Promise<StorageUploadResult> {
    validateStorageOptions(options);
    const local = await assertReadableFile(resolve(sourcePath));
    const target = parseStorageSource(destination);

    if (target.kind === "http") {
      throw new InvalidStorageError("Built-in HTTP storage is download-only. Use an object adapter for uploads.");
    }
    if (target.kind === "local") {
      const output = resolve(target.path);
      if (!options.overwrite) {
        try {
          await stat(output);
          throw new InvalidStorageError(`Storage destination already exists: ${output}`);
        } catch (error) {
          if (error instanceof InvalidStorageError) throw error;
        }
      }
      await mkdir(dirname(output), { recursive: true });
      await copyFile(local.path, output);
      return {
        provider: "local",
        source: local.path,
        destination: output,
        bytesTransferred: local.size
      };
    }

    const adapter = this.#adapters.get(target.provider);
    if (!adapter) throw new StorageAdapterNotFoundError(target.provider);
    if (!adapter.upload) throw new InvalidStorageError(`Storage adapter does not support uploads: ${target.provider}`);
    const result = await adapter.upload(local.path, target, options);
    return result ?? {
      provider: target.provider,
      source: local.path,
      destination: sourceLabel(target),
      destinationReference: target,
      bytesTransferred: local.size
    };
  }

  async resolve(
    input: string | URL | MediaStorageSource,
    options: StorageResolveOptions = {}
  ): Promise<ResolvedMediaSource> {
    const source = parseStorageSource(input);
    if (source.kind === "local" && !options.copyLocal) {
      const localPath = await realpath(resolve(source.path)).catch(() => resolve(source.path));
      const local = await assertReadableFile(localPath);
      return {
        path: local.path,
        provider: "local",
        original: source,
        managed: false,
        sizeBytes: local.size,
        async cleanup() {}
      };
    }

    const workspace = await this.createWorkspace({
      ...(options.workspaceRoot ? { root: options.workspaceRoot } : {})
    });
    const name = source.kind === "http"
      ? httpFileName(source)
      : source.kind === "object"
        ? objectFileName(source)
        : safeBasename(source.path);
    const target = workspace.file(name);
    try {
      const transfer = await this.download(source, target, { ...options, overwrite: true });
      const local = await assertReadableFile(target);
      return {
        path: target,
        provider: transfer.provider,
        original: source,
        managed: true,
        sizeBytes: local.size,
        async cleanup() {
          await workspace.cleanup();
        }
      };
    } catch (error) {
      await workspace.cleanup();
      throw error;
    }
  }

  async withResolved<T>(
    input: string | URL | MediaStorageSource,
    callback: (media: ResolvedMediaSource) => Promise<T> | T,
    options: StorageResolveOptions = {}
  ): Promise<T> {
    const media = await this.resolve(input, options);
    try {
      return await callback(media);
    } finally {
      await media.cleanup();
    }
  }
}

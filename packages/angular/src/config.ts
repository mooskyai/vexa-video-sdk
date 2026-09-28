export type VexaHeaders = Readonly<Record<string, string>>;

export interface VexaRequestContext {
  method: string;
  path: string;
  kind: "json" | "upload" | "media";
}

export type VexaHeaderFactory = (
  context: VexaRequestContext
) => VexaHeaders | Promise<VexaHeaders>;

export interface VexaVideoConfig {
  /** Base URL for the Node render service, e.g. https://media.example.com. */
  baseUrl: string;
  /** Optional headers or a per-request header factory (useful for auth tokens). */
  headers?: VexaHeaders | VexaHeaderFactory;
  /** Browser fetch credentials mode. Defaults to same-origin. */
  credentials?: RequestCredentials;
  /** Job polling interval. Defaults to 750 ms. */
  pollIntervalMs?: number;
  /** Override service endpoint paths. */
  paths?: Partial<VexaVideoPaths>;
  /** Override browser fetch for testing/custom environments. */
  fetch?: typeof globalThis.fetch;
}

export interface VexaVideoPaths {
  media: string;
  jobs: string;
}

export interface NormalizedVexaVideoConfig {
  baseUrl: string;
  headers?: VexaHeaders | VexaHeaderFactory;
  credentials: RequestCredentials;
  pollIntervalMs: number;
  paths: VexaVideoPaths;
  fetch: typeof globalThis.fetch;
}

const DEFAULT_PATHS: VexaVideoPaths = {
  media: "/v1/media",
  jobs: "/v1/jobs"
};

function normalizePath(path: string, label: string): string {
  const value = path.trim();
  if (!value.startsWith("/")) throw new TypeError(`${label} must start with '/'.`);
  if (value.includes("..")) throw new TypeError(`${label} must not contain '..'.`);
  return value.replace(/\/+$/u, "") || "/";
}

export function normalizeVexaVideoConfig(config: VexaVideoConfig): NormalizedVexaVideoConfig {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/u, "");
  if (!baseUrl) throw new TypeError("Vexa baseUrl is required.");
  if (!/^https?:\/\//iu.test(baseUrl) && !baseUrl.startsWith("/")) {
    throw new TypeError("Vexa baseUrl must be an http(s) URL or an absolute browser path.");
  }
  const pollIntervalMs = config.pollIntervalMs ?? 750;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) {
    throw new TypeError("Vexa pollIntervalMs must be between 100 and 60000 ms.");
  }
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("Browser fetch is not available. Provide config.fetch.");
  return {
    baseUrl,
    ...(config.headers ? { headers: config.headers } : {}),
    credentials: config.credentials ?? "same-origin",
    pollIntervalMs,
    paths: {
      media: normalizePath(config.paths?.media ?? DEFAULT_PATHS.media, "Vexa media path"),
      jobs: normalizePath(config.paths?.jobs ?? DEFAULT_PATHS.jobs, "Vexa jobs path")
    },
    fetch: fetchImpl
  };
}

export function joinVexaUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/u, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

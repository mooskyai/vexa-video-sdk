import type { ProcessControlOptions } from "./editing.js";

export type StorageProvider = "local" | "http" | "s3" | "gcs" | "azure" | "custom";
export type ObjectStorageProvider = Exclude<StorageProvider, "local" | "http">;

export interface LocalMediaSource {
  kind: "local";
  path: string;
}

export interface HttpMediaSource {
  kind: "http";
  url: string;
  headers?: Readonly<Record<string, string>>;
}

export interface ObjectMediaSource {
  kind: "object";
  provider: ObjectStorageProvider;
  /** S3/GCS bucket name. */
  bucket?: string;
  /** Azure Blob container name. */
  container?: string;
  key: string;
  /** Optional adapter-specific endpoint/account hint. */
  endpoint?: string;
  metadata?: Readonly<Record<string, string>>;
}

export type MediaStorageSource = LocalMediaSource | HttpMediaSource | ObjectMediaSource;

export interface StorageTransferOptions extends ProcessControlOptions {
  overwrite?: boolean;
  /** Maximum accepted object size. Defaults to 2 GiB for built-in HTTP downloads. */
  maxBytes?: number;
}

export interface HttpStorageOptions extends StorageTransferOptions {
  /** Plain HTTP is disabled by default. */
  allowHttp?: boolean;
  /** Loopback, link-local, and private-network destinations are disabled by default. */
  allowPrivateNetwork?: boolean;
  /** Maximum HTTP redirects. Defaults to 5. */
  maxRedirects?: number;
  /** Additional request headers. */
  headers?: Readonly<Record<string, string>>;
}

export interface StorageResolveOptions extends StorageTransferOptions {
  http?: HttpStorageOptions;
  /** Copy local sources into a managed workspace instead of using them in-place. */
  copyLocal?: boolean;
  /** Parent directory for managed workspaces. Defaults to the OS temp directory. */
  workspaceRoot?: string;
}

export interface StorageWorkspaceOptions {
  root?: string;
  prefix?: string;
}

export interface StorageTransferResult {
  provider: StorageProvider;
  source: string;
  destination: string;
  bytesTransferred: number | null;
  contentType?: string;
}

export interface StorageUploadResult extends StorageTransferResult {
  destinationReference?: ObjectMediaSource;
}

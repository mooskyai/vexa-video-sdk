import type { HardwareVideoCodec } from "./hardware.js";
import type { OutputContainer } from "./pipeline.js";

export type PluginCapability =
  | "video-operation"
  | "storage-adapter"
  | "job-handler"
  | "render-backend"
  | "encoder-provider";

export type PluginLifecycleState = "registered" | "started" | "stopped" | "disposed";

export interface PluginDependency {
  id: string;
  /** Optional informational version range. Hosts currently validate the dependency id. */
  version?: string;
}

export interface PluginMetadata {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  browserSafe?: boolean;
  capabilities: readonly PluginCapability[];
  requires?: readonly PluginDependency[];
  tags?: readonly string[];
}

export interface PluginContributionCatalog {
  videoOperations: readonly string[];
  storageAdapters: readonly string[];
  jobHandlers: readonly string[];
  renderBackends: readonly string[];
  encoderProviders: readonly string[];
}

export interface PluginCatalogEntry {
  metadata: PluginMetadata;
  state: PluginLifecycleState;
  contributions: PluginContributionCatalog;
}

/**
 * Portable manifest that a package manager, application config, or framework
 * can serialize without loading the Node plugin implementation.
 */
export interface PluginPackageManifest {
  schemaVersion: 1;
  module: string;
  /** Defaults to the conventional `vexaPlugin` export, then `default`. */
  exportName?: string;
  metadata: PluginMetadata;
}

export interface PluginEncoderRequest {
  codec: HardwareVideoCodec;
  container?: OutputContainer;
  options?: Readonly<Record<string, unknown>>;
}

export interface PluginEncoderSelection {
  pluginId: string;
  contribution: string;
  codec: HardwareVideoCodec;
  backend: string;
  encoder: string;
  options?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

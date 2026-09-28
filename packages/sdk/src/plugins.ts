import type {
  HardwareVideoCodec,
  ObjectStorageProvider,
  PluginCatalogEntry,
  PluginCapability,
  PluginEncoderRequest,
  PluginEncoderSelection,
  PluginLifecycleState,
  PluginMetadata,
  PluginPackageManifest,
  VideoOperation
} from "@vexa-video/core";
import {
  InvalidPluginError,
  PluginConflictError,
  PluginDependencyError,
  PluginExecutionError,
  PluginNotFoundError
} from "@vexa-video/core";
import { JobQueue, type JobHandler, type JobHandlerOptions } from "./jobs.js";
import { Storage, type StorageAdapter, type StorageOptions } from "./storage.js";
import { Video } from "./video.js";

export interface PluginLifecycleContext {
  readonly metadata: PluginMetadata;
  getPluginMetadata(id: string): PluginMetadata | undefined;
}

export interface PluginVideoOperationContext extends PluginLifecycleContext {
  readonly operation: string;
}

export interface PluginVideoOperationDefinition<TPayload = unknown> {
  name: string;
  validate?: (payload: TPayload) => void;
  /** Expand a plugin operation into backend-neutral built-in operations. */
  transform(
    payload: TPayload,
    context: PluginVideoOperationContext
  ): VideoOperation | readonly VideoOperation[];
}

export interface PluginRenderBackendContext extends PluginLifecycleContext {
  readonly backend: string;
  readonly signal?: AbortSignal;
  reportProgress(update: PluginProgressUpdate): Promise<void>;
}

export interface PluginRenderBackendDefinition<TRequest = unknown, TResult = unknown> {
  name: string;
  execute(
    request: TRequest,
    context: PluginRenderBackendContext
  ): TResult | Promise<TResult>;
}

export interface PluginEncoderResolution {
  codec: HardwareVideoCodec;
  backend: string;
  encoder: string;
  options?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PluginEncoderProviderDefinition {
  name: string;
  codecs: readonly HardwareVideoCodec[];
  resolve(
    request: PluginEncoderRequest,
    context: PluginLifecycleContext
  ): PluginEncoderResolution | null | Promise<PluginEncoderResolution | null>;
}

export interface PluginJobHandlerDefinition<TPayload = unknown, TResult = unknown> {
  name: string;
  handler: JobHandler<TPayload, TResult>;
  options?: JobHandlerOptions<TPayload, TResult>;
}

export interface PluginSetupContext extends PluginLifecycleContext {
  registerVideoOperation<TPayload>(definition: PluginVideoOperationDefinition<TPayload>): string;
  registerStorageAdapter(adapter: StorageAdapter): ObjectStorageProvider;
  registerJobHandler<TPayload, TResult>(definition: PluginJobHandlerDefinition<TPayload, TResult>): string;
  registerRenderBackend<TRequest, TResult>(definition: PluginRenderBackendDefinition<TRequest, TResult>): string;
  registerEncoderProvider(definition: PluginEncoderProviderDefinition): string;
}

export interface VexaPlugin {
  readonly metadata: PluginMetadata;
  setup?(context: PluginSetupContext): void | Promise<void>;
  start?(context: PluginLifecycleContext): void | Promise<void>;
  stop?(context: PluginLifecycleContext): void | Promise<void>;
  dispose?(context: PluginLifecycleContext): void | Promise<void>;
}

export interface PluginLoadOptions {
  exportName?: string;
}

export interface PluginProgressUpdate {
  percent?: number;
  phase?: string;
  message?: string;
  data?: unknown;
}

export interface PluginBackendExecutionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PluginProgressUpdate) => void | Promise<void>;
}

type PluginRecord = {
  plugin: VexaPlugin;
  metadata: PluginMetadata;
  state: PluginLifecycleState;
  order: number;
};

type Contribution<T> = {
  pluginId: string;
  name: string;
  key: string;
  definition: T;
};

type JobContribution = Contribution<PluginJobHandlerDefinition<any, any>>;

type PluginModule = {
  default?: unknown;
  vexaPlugin?: unknown;
  vexaPluginMetadata?: unknown;
  [key: string]: unknown;
};

const CAPABILITIES = new Set<PluginCapability>([
  "video-operation",
  "storage-adapter",
  "job-handler",
  "render-backend",
  "encoder-provider"
]);

function pluginId(value: string, label = "plugin id"): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/u.test(normalized)) {
    throw new InvalidPluginError(
      `${label} must be 2-128 lowercase characters using letters, numbers, dot, underscore, or hyphen.`
    );
  }
  return normalized;
}

function contributionName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(normalized)) {
    throw new InvalidPluginError(
      "Plugin contribution names must be 1-64 lowercase characters using letters, numbers, dot, underscore, or hyphen."
    );
  }
  return normalized;
}

function semver(value: string): string {
  const normalized = value.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(normalized)) {
    throw new InvalidPluginError(`Plugin version must be valid semantic-version syntax: ${value}`);
  }
  return normalized;
}

function nonEmpty(value: string, label: string, max = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new InvalidPluginError(`${label} must be between 1 and ${max} characters.`);
  }
  return normalized;
}

function normalizeMetadata(metadata: PluginMetadata): PluginMetadata {
  if (!metadata || typeof metadata !== "object" || metadata.schemaVersion !== 1) {
    throw new InvalidPluginError("Plugin metadata must use schemaVersion 1.");
  }
  const id = pluginId(metadata.id);
  const name = nonEmpty(metadata.name, "Plugin name", 128);
  const version = semver(metadata.version);
  const capabilities = [...new Set(metadata.capabilities ?? [])];
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) {
      throw new InvalidPluginError(`Unsupported plugin capability: ${String(capability)}`);
    }
  }
  const requires = (metadata.requires ?? []).map((dependency) => {
    const dependencyId = pluginId(dependency.id, "plugin dependency id");
    if (dependencyId === id) throw new InvalidPluginError(`Plugin ${id} cannot depend on itself.`);
    return {
      id: dependencyId,
      ...(dependency.version?.trim() ? { version: dependency.version.trim() } : {})
    };
  });
  const tags = [...new Set((metadata.tags ?? []).map((tag) => nonEmpty(tag, "Plugin tag", 64)))];
  return Object.freeze({
    schemaVersion: 1,
    id,
    name,
    version,
    ...(metadata.description?.trim() ? { description: metadata.description.trim() } : {}),
    ...(metadata.homepage?.trim() ? { homepage: metadata.homepage.trim() } : {}),
    ...(metadata.browserSafe !== undefined ? { browserSafe: Boolean(metadata.browserSafe) } : {}),
    capabilities: Object.freeze(capabilities),
    ...(requires.length ? { requires: Object.freeze(requires) } : {}),
    ...(tags.length ? { tags: Object.freeze(tags) } : {})
  });
}

function asPlugin(value: unknown): VexaPlugin {
  if (!value || typeof value !== "object") {
    throw new InvalidPluginError("Plugin module did not export a plugin object.");
  }
  const plugin = value as Partial<VexaPlugin>;
  if (!plugin.metadata) throw new InvalidPluginError("Plugin object is missing metadata.");
  for (const hook of ["setup", "start", "stop", "dispose"] as const) {
    if (plugin[hook] !== undefined && typeof plugin[hook] !== "function") {
      throw new InvalidPluginError(`Plugin ${hook} hook must be a function.`);
    }
  }
  return plugin as VexaPlugin;
}

function keyFor(pluginIdValue: string, name: string): string {
  return `${pluginIdValue}:${contributionName(name)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pluginProgress(update: PluginProgressUpdate): PluginProgressUpdate {
  const percent = update.percent;
  if (percent !== undefined && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
    throw new InvalidPluginError("Plugin progress percent must be between 0 and 100.");
  }
  return { ...update, ...(percent !== undefined ? { percent } : {}) };
}

export function definePlugin<TPlugin extends VexaPlugin>(plugin: TPlugin): TPlugin {
  normalizeMetadata(plugin.metadata);
  return plugin;
}

export class PluginRegistry {
  readonly #plugins = new Map<string, PluginRecord>();
  readonly #videoOperations = new Map<string, Contribution<PluginVideoOperationDefinition<any>>>();
  readonly #storageAdapters = new Map<ObjectStorageProvider, Contribution<StorageAdapter>>();
  readonly #jobHandlers = new Map<string, JobContribution>();
  readonly #renderBackends = new Map<string, Contribution<PluginRenderBackendDefinition<any, any>>>();
  readonly #encoderProviders = new Map<string, Contribution<PluginEncoderProviderDefinition>>();
  #nextOrder = 0;

  async register(pluginValue: VexaPlugin): Promise<PluginMetadata> {
    const plugin = asPlugin(pluginValue);
    const metadata = normalizeMetadata(plugin.metadata);
    if (this.#plugins.has(metadata.id)) {
      throw new PluginConflictError(`Plugin is already registered: ${metadata.id}`);
    }
    for (const dependency of metadata.requires ?? []) {
      if (!this.#plugins.has(dependency.id)) {
        throw new PluginDependencyError(metadata.id, dependency.id);
      }
    }

    const record: PluginRecord = {
      plugin,
      metadata,
      state: "registered",
      order: this.#nextOrder++
    };
    this.#plugins.set(metadata.id, record);
    try {
      if (plugin.setup) await plugin.setup(this.#setupContext(record));
    } catch (error) {
      this.#removeContributions(metadata.id);
      this.#plugins.delete(metadata.id);
      throw new PluginExecutionError(metadata.id, "setup", messageOf(error), { cause: error });
    }
    return metadata;
  }

  async load(specifier: string, options: PluginLoadOptions = {}): Promise<PluginMetadata> {
    const moduleName = nonEmpty(specifier, "Plugin module specifier", 2048);
    let loaded: PluginModule;
    try {
      loaded = await import(moduleName) as PluginModule;
    } catch (error) {
      throw new PluginExecutionError(moduleName, "load", messageOf(error), { cause: error });
    }
    const candidate = options.exportName
      ? loaded[options.exportName]
      : loaded.vexaPlugin ?? loaded.default;
    if (!candidate) {
      throw new InvalidPluginError(
        `Plugin module ${moduleName} must export \`vexaPlugin\`, a default plugin, or the configured export name.`
      );
    }
    const plugin = asPlugin(candidate);
    if (loaded.vexaPluginMetadata !== undefined) {
      const declared = normalizeMetadata(loaded.vexaPluginMetadata as PluginMetadata);
      const actual = normalizeMetadata(plugin.metadata);
      if (declared.id !== actual.id || declared.version !== actual.version) {
        throw new InvalidPluginError(
          `Plugin module ${moduleName} metadata export does not match its plugin implementation.`
        );
      }
    }
    return await this.register(plugin);
  }

  async loadManifest(manifest: PluginPackageManifest): Promise<PluginMetadata> {
    if (!manifest || manifest.schemaVersion !== 1) {
      throw new InvalidPluginError("Plugin package manifest must use schemaVersion 1.");
    }
    const expected = normalizeMetadata(manifest.metadata);
    const loaded = await this.load(manifest.module, manifest.exportName ? { exportName: manifest.exportName } : {});
    if (loaded.id !== expected.id || loaded.version !== expected.version) {
      await this.unregister(loaded.id);
      throw new InvalidPluginError(
        `Plugin manifest expected ${expected.id}@${expected.version} but loaded ${loaded.id}@${loaded.version}.`
      );
    }
    return loaded;
  }

  get(id: string): PluginCatalogEntry {
    const record = this.#record(id);
    return this.#catalogEntry(record);
  }

  catalog(): readonly PluginCatalogEntry[] {
    return [...this.#plugins.values()]
      .sort((a, b) => a.order - b.order)
      .map((record) => this.#catalogEntry(record));
  }

  async start(id: string): Promise<void> {
    const record = this.#record(id);
    if (record.state === "started") return;
    if (record.state === "disposed") {
      throw new InvalidPluginError(`Disposed plugin cannot be restarted: ${record.metadata.id}`);
    }
    for (const dependency of record.metadata.requires ?? []) {
      if (!this.#plugins.has(dependency.id)) throw new PluginDependencyError(record.metadata.id, dependency.id);
    }
    try {
      if (record.plugin.start) await record.plugin.start(this.#lifecycleContext(record));
      record.state = "started";
    } catch (error) {
      throw new PluginExecutionError(record.metadata.id, "start", messageOf(error), { cause: error });
    }
  }

  async startAll(): Promise<void> {
    for (const record of [...this.#plugins.values()].sort((a, b) => a.order - b.order)) {
      await this.start(record.metadata.id);
    }
  }

  async stop(id: string): Promise<void> {
    const record = this.#record(id);
    if (record.state !== "started") return;
    try {
      if (record.plugin.stop) await record.plugin.stop(this.#lifecycleContext(record));
      record.state = "stopped";
    } catch (error) {
      throw new PluginExecutionError(record.metadata.id, "stop", messageOf(error), { cause: error });
    }
  }

  async stopAll(): Promise<void> {
    for (const record of [...this.#plugins.values()].sort((a, b) => b.order - a.order)) {
      await this.stop(record.metadata.id);
    }
  }

  async dispose(id: string): Promise<void> {
    const record = this.#record(id);
    if (record.state === "disposed") return;
    if (record.state === "started") await this.stop(id);
    try {
      if (record.plugin.dispose) await record.plugin.dispose(this.#lifecycleContext(record));
      record.state = "disposed";
      this.#removeContributions(record.metadata.id);
    } catch (error) {
      throw new PluginExecutionError(record.metadata.id, "dispose", messageOf(error), { cause: error });
    }
  }

  async unregister(id: string): Promise<boolean> {
    const normalized = pluginId(id);
    const record = this.#plugins.get(normalized);
    if (!record) return false;
    await this.dispose(normalized);
    this.#plugins.delete(normalized);
    return true;
  }

  applyVideoOperation<TPayload>(video: Video, key: string, payload: TPayload): Video {
    const contribution = this.#contribution(this.#videoOperations, key, "video operation");
    const definition = contribution.definition as PluginVideoOperationDefinition<TPayload>;
    if (definition.validate) definition.validate(payload);
    let operations: VideoOperation | readonly VideoOperation[];
    try {
      operations = definition.transform(payload, {
        ...this.#lifecycleContext(this.#record(contribution.pluginId)),
        operation: contribution.key
      });
    } catch (error) {
      throw new PluginExecutionError(contribution.pluginId, `video-operation:${contribution.name}`, messageOf(error), { cause: error });
    }
    const expanded = Array.isArray(operations) ? operations : [operations];
    return Video.fromPipeline({
      schemaVersion: 1,
      source: video.source,
      operations: [...video.operations, ...expanded]
    }, video.options);
  }

  createStorage(options: StorageOptions = {}): Storage {
    return new Storage({
      ...options,
      adapters: [
        ...[...this.#storageAdapters.values()].map((item) => item.definition),
        ...(options.adapters ?? [])
      ]
    });
  }

  installJobHandlers(queue: JobQueue): readonly string[] {
    const installed: string[] = [];
    for (const contribution of this.#jobHandlers.values()) {
      queue.register(contribution.key, contribution.definition.handler, contribution.definition.options ?? {});
      installed.push(contribution.key);
    }
    return installed;
  }

  async executeBackend<TRequest, TResult = unknown>(
    key: string,
    request: TRequest,
    options: PluginBackendExecutionOptions = {}
  ): Promise<TResult> {
    const contribution = this.#contribution(this.#renderBackends, key, "render backend") as Contribution<PluginRenderBackendDefinition<TRequest, TResult>>;
    const record = this.#record(contribution.pluginId);
    try {
      return await contribution.definition.execute(request, {
        ...this.#lifecycleContext(record),
        backend: contribution.key,
        ...(options.signal ? { signal: options.signal } : {}),
        reportProgress: async (update) => {
          const value = pluginProgress(update);
          await options.onProgress?.(value);
        }
      });
    } catch (error) {
      throw new PluginExecutionError(contribution.pluginId, `render-backend:${contribution.name}`, messageOf(error), { cause: error });
    }
  }

  async resolveEncoder(key: string, request: PluginEncoderRequest): Promise<PluginEncoderSelection | null> {
    const contribution = this.#contribution(this.#encoderProviders, key, "encoder provider");
    if (!contribution.definition.codecs.includes(request.codec)) return null;
    const record = this.#record(contribution.pluginId);
    let selection: PluginEncoderResolution | null;
    try {
      selection = await contribution.definition.resolve(request, this.#lifecycleContext(record));
    } catch (error) {
      throw new PluginExecutionError(contribution.pluginId, `encoder-provider:${contribution.name}`, messageOf(error), { cause: error });
    }
    if (!selection) return null;
    if (selection.codec !== request.codec) {
      throw new InvalidPluginError(
        `Encoder provider ${contribution.key} returned codec ${selection.codec} for requested codec ${request.codec}.`
      );
    }
    if (!selection.backend.trim() || !selection.encoder.trim()) {
      throw new InvalidPluginError(`Encoder provider ${contribution.key} returned an empty backend or encoder.`);
    }
    return {
      ...selection,
      pluginId: contribution.pluginId,
      contribution: contribution.key
    };
  }

  #record(id: string): PluginRecord {
    const normalized = pluginId(id);
    const record = this.#plugins.get(normalized);
    if (!record) throw new PluginNotFoundError(normalized);
    return record;
  }

  #lifecycleContext(record: PluginRecord): PluginLifecycleContext {
    return {
      metadata: record.metadata,
      getPluginMetadata: (id) => this.#plugins.get(id.trim().toLowerCase())?.metadata
    };
  }

  #setupContext(record: PluginRecord): PluginSetupContext {
    const lifecycle = this.#lifecycleContext(record);
    return {
      ...lifecycle,
      registerVideoOperation: <TPayload>(definition: PluginVideoOperationDefinition<TPayload>) => {
        this.#requireCapability(record, "video-operation");
        return this.#addContribution(this.#videoOperations, record, definition.name, definition as PluginVideoOperationDefinition<any>);
      },
      registerStorageAdapter: (adapter: StorageAdapter) => {
        this.#requireCapability(record, "storage-adapter");
        if (!adapter || typeof adapter.download !== "function") {
          throw new InvalidPluginError(`Plugin ${record.metadata.id} registered an invalid storage adapter.`);
        }
        const existing = this.#storageAdapters.get(adapter.provider);
        if (existing) {
          throw new PluginConflictError(
            `Storage provider ${adapter.provider} is already registered by plugin ${existing.pluginId}.`
          );
        }
        this.#storageAdapters.set(adapter.provider, {
          pluginId: record.metadata.id,
          name: adapter.provider,
          key: `${record.metadata.id}:${adapter.provider}`,
          definition: adapter
        });
        return adapter.provider;
      },
      registerJobHandler: <TPayload, TResult>(definition: PluginJobHandlerDefinition<TPayload, TResult>) => {
        this.#requireCapability(record, "job-handler");
        if (typeof definition.handler !== "function") throw new InvalidPluginError("Plugin job handler must be a function.");
        return this.#addContribution(this.#jobHandlers, record, definition.name, definition as PluginJobHandlerDefinition<any, any>);
      },
      registerRenderBackend: <TRequest, TResult>(definition: PluginRenderBackendDefinition<TRequest, TResult>) => {
        this.#requireCapability(record, "render-backend");
        if (typeof definition.execute !== "function") throw new InvalidPluginError("Plugin render backend execute must be a function.");
        return this.#addContribution(this.#renderBackends, record, definition.name, definition as PluginRenderBackendDefinition<any, any>);
      },
      registerEncoderProvider: (definition: PluginEncoderProviderDefinition) => {
        this.#requireCapability(record, "encoder-provider");
        if (!definition.codecs.length) throw new InvalidPluginError("Plugin encoder provider must declare at least one codec.");
        if (typeof definition.resolve !== "function") throw new InvalidPluginError("Plugin encoder provider resolve must be a function.");
        return this.#addContribution(this.#encoderProviders, record, definition.name, definition);
      }
    };
  }

  #requireCapability(record: PluginRecord, capability: PluginCapability): void {
    if (!record.metadata.capabilities.includes(capability)) {
      throw new InvalidPluginError(
        `Plugin ${record.metadata.id} attempted to register ${capability} without declaring that capability.`
      );
    }
  }

  #addContribution<T>(map: Map<string, Contribution<T>>, record: PluginRecord, name: string, definition: T): string {
    const key = keyFor(record.metadata.id, name);
    if (map.has(key)) throw new PluginConflictError(`Plugin contribution is already registered: ${key}`);
    map.set(key, { pluginId: record.metadata.id, name: contributionName(name), key, definition });
    return key;
  }

  #contribution<T>(map: Map<string, Contribution<T>>, key: string, label: string): Contribution<T> {
    const normalized = key.trim().toLowerCase();
    const value = map.get(normalized);
    if (!value) throw new PluginNotFoundError(`${label}:${normalized}`);
    return value;
  }

  #removeContributions(pluginIdValue: string): void {
    for (const map of [this.#videoOperations, this.#jobHandlers, this.#renderBackends, this.#encoderProviders] as const) {
      for (const [key, value] of map) if (value.pluginId === pluginIdValue) map.delete(key);
    }
    for (const [provider, value] of this.#storageAdapters) {
      if (value.pluginId === pluginIdValue) this.#storageAdapters.delete(provider);
    }
  }

  #catalogEntry(record: PluginRecord): PluginCatalogEntry {
    const id = record.metadata.id;
    const keys = <T>(map: Map<string, Contribution<T>>) => [...map.values()]
      .filter((value) => value.pluginId === id)
      .map((value) => value.key)
      .sort();
    return {
      metadata: record.metadata,
      state: record.state,
      contributions: {
        videoOperations: keys(this.#videoOperations),
        storageAdapters: [...this.#storageAdapters.values()].filter((value) => value.pluginId === id).map((value) => value.key).sort(),
        jobHandlers: keys(this.#jobHandlers),
        renderBackends: keys(this.#renderBackends),
        encoderProviders: keys(this.#encoderProviders)
      }
    };
  }
}

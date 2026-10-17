# Plugin system

The Vexa plugin system extends the Node SDK without weakening the backend-neutral media model. Plugins are loaded explicitly by the application and can register a small set of typed extension points.

## Runtime boundary

Plugin implementations belong to the Node runtime unless the plugin package independently documents another environment. Browser/framework code should consume only serializable plugin metadata.

```text
Application
    |
    v
PluginRegistry
    |
    +---- metadata/catalog ----------> browser/framework tooling
    |
    +---- video operation -----------> Video pipeline
    +---- storage adapter -----------> Storage
    +---- job handler ---------------> JobQueue
    +---- render backend ------------> plugin-owned executor
    +---- encoder provider ----------> plugin-owned encoder selection
```

`@vexa-video/core/browser` exports plugin metadata/catalog types only. It never loads plugin implementations.

## Plugin metadata

Every plugin uses schema version 1 metadata:

```ts
const metadata = {
  schemaVersion: 1,
  id: "acme.watermark",
  name: "Acme Watermark",
  version: "1.0.0",
  description: "Adds organization watermark operations.",
  capabilities: ["video-operation"],
  browserSafe: false,
  tags: ["watermark", "branding"]
};
```

Plugin ids are normalized lowercase identifiers. Versions use semantic-version syntax. Capabilities must be declared before the plugin can register a matching contribution.

Supported capabilities are:

- `video-operation`
- `storage-adapter`
- `job-handler`
- `render-backend`
- `encoder-provider`

## Lifecycle

A plugin may implement four hooks:

```ts
export const vexaPlugin = definePlugin({
  metadata,

  async setup(context) {
    // Register contributions here.
  },

  async start(context) {
    // Open plugin-owned runtime resources.
  },

  async stop(context) {
    // Stop accepting work / close active resources.
  },

  async dispose(context) {
    // Final cleanup.
  }
});
```

`setup` runs once during registration. `startAll()` follows registration order; `stopAll()` follows reverse registration order. `unregister()` disposes the plugin and removes its contributions.

Dependencies are declared through `metadata.requires`. A required plugin must already be registered before the dependent plugin is accepted. The optional dependency version field is currently informational; plugin ids are enforced now so version-range semantics can be added without changing the metadata shape.

## Custom video operations

Video-operation plugins expand their input into existing backend-neutral `VideoOperation` objects. They do not receive raw FFmpeg argument access through this extension point.

```ts
context.registerVideoOperation<{ width: number; height: number }>({
  name: "social-fit",

  validate(payload) {
    if (payload.width <= 0 || payload.height <= 0) {
      throw new Error("Invalid target size");
    }
  },

  transform(payload) {
    return {
      type: "resize",
      options: {
        width: payload.width,
        height: payload.height,
        fit: "cover"
      }
    };
  }
});
```

The host applies it by contribution key:

```ts
const result = plugins.applyVideoOperation(
  Video.load("input.mp4"),
  "acme.social:social-fit",
  { width: 1080, height: 1920 }
);
```

The resulting `Video` continues through the normal validation, planning, hardware, and FFmpeg paths.

## Storage plugins

A plugin can register a normal `StorageAdapter`:

```ts
context.registerStorageAdapter(
  Storage.adapter("custom", {
    async download(reference, destination) {
      // Stream provider data into destination.
    },

    async upload(sourcePath, reference) {
      // Upload sourcePath.
    }
  })
);
```

Create a storage instance containing registered plugin adapters with:

```ts
const storage = plugins.createStorage({
  workspaceRoot: ".tmp/media"
});
```

Vexa still intentionally avoids forcing a cloud SDK dependency into the plugin host.

## Job-handler plugins

Plugins can package background worker behavior:

```ts
context.registerJobHandler<{ source: string }, { output: string }>({
  name: "render-proxy",
  async handler(payload, job) {
    // Run plugin-owned work and report through job.reportProgress(...).
    return { output: payload.source };
  }
});
```

Install all registered plugin handlers into an existing local queue:

```ts
const queue = new JobQueue({ concurrency: 2 });
plugins.installJobHandlers(queue);
```

Contribution keys are namespaced by plugin id, for example `acme.worker:render-proxy`.

## Custom render backends

A render backend is an explicit execution path owned by the plugin:

```ts
context.registerRenderBackend({
  name: "cloud",
  async execute(request, backend) {
    await backend.reportProgress({ percent: 25, phase: "upload" });
    // Submit request to a custom/cloud renderer.
    await backend.reportProgress({ percent: 100, phase: "done" });
    return { outputUrl: "https://cdn.example.com/result.mp4" };
  }
});
```

Applications call the backend explicitly:

```ts
const result = await plugins.executeBackend(
  "acme.cloud:cloud",
  request,
  { signal, onProgress }
);
```

This prevents an installed plugin from silently replacing the default FFmpeg execution path.

## Encoder providers

Encoder providers can resolve a logical Vexa codec into a plugin-owned backend/encoder identity:

```ts
context.registerEncoderProvider({
  name: "h264-cloud",
  codecs: ["h264"],
  async resolve(request) {
    return {
      codec: request.codec,
      backend: "acme-cloud",
      encoder: "h264-premium",
      options: { tier: "balanced" }
    };
  }
});
```

Resolve explicitly:

```ts
const selection = await plugins.resolveEncoder(
  "acme.cloud:h264-cloud",
  { codec: "h264", container: "mp4" }
);
```

The core hardware/FFmpeg planner remains unchanged unless the application deliberately delegates to the plugin backend.

## Package convention

Vexa does not scan `node_modules` or execute arbitrary packages automatically. Applications explicitly load known plugin packages:

```ts
await plugins.load("@acme/vexa-plugin-watermark");
```

A plugin package should expose:

```ts
export const vexaPluginMetadata = { /* serializable metadata */ };
export const vexaPlugin = definePlugin({
  metadata: vexaPluginMetadata,
  setup(context) { /* ... */ }
});
```

`vexaPlugin` is preferred. A default plugin export is also supported. `PluginPackageManifest` lets application configuration declare the module, optional export name, and expected id/version; `loadManifest(...)` verifies the loaded implementation matches that manifest.

This is intentionally explicit package discovery: package managers decide what is installed, application configuration decides what may execute, and Vexa validates the plugin contract when it is loaded.

## Security and trust

Node plugins execute application-level code and therefore have the same process privileges as the host application. Treat plugin packages like any other trusted server dependency.

Recommended practices:

- pin plugin versions with the application's package manager;
- load only configured/allowlisted module specifiers;
- do not derive plugin module names directly from untrusted HTTP input;
- keep secrets and cloud credentials in application-owned configuration;
- use browser-safe metadata for UI discovery rather than importing Node plugin implementations into browser bundles;
- prefer backend-neutral custom operations when raw backend access is unnecessary.

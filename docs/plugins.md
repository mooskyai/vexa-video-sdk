# Plugin System

Vexa plugins add explicit extension points to a Node host without silently replacing normal planning, validation or security behavior.

## Core idea

A plugin declares metadata/capabilities and registers supported extension types during setup. Plugin runtime code executes with the host application's privileges; it is not sandboxed.

## Example

```ts
import { definePlugin, PluginRegistry, Video } from "@vexa-video/sdk";

const plugin = definePlugin({
  metadata: {
    schemaVersion: 1,
    id: "acme.video-tools",
    name: "Acme video tools",
    version: "1.0.0",
    capabilities: ["video-operation"]
  },
  setup(context) {
    context.registerVideoOperation({
      name: "square",
      transform() {
        return {
          type: "crop",
          options: { width: 1080, height: 1080 }
        };
      }
    });
  }
});

const registry = new PluginRegistry();
await registry.register(plugin);

const edited = registry.applyVideoOperation(
  Video.load("input.mp4"),
  "acme.video-tools:square",
  {}
);

await edited.export("square.mp4");
```

## Version 2 extension points

The plugin host supports explicit lifecycle-managed contribution of capabilities such as:

- backend-neutral video operations;
- storage adapters;
- job handlers;
- render backends;
- encoder providers;
- package metadata/catalog information.

## Rules for plugin authors

1. keep namespaced identifiers stable;
2. validate plugin input before producing Vexa operations;
3. use existing plan/render/storage/job APIs rather than shelling out around them;
4. make cleanup deterministic;
5. surface typed failures with enough context for operators;
6. never assume plugin metadata makes runtime code safe to execute.

## Loading third-party plugins

Only load trusted packages. A plugin has the same effective access as other Node dependencies in the host process.

For multi-tenant systems, consider process/container isolation and explicit allowlists in addition to Vexa plugin metadata.

## Version 3 direction

Version 3 plans additional explicit plugin surfaces for effects, transitions, media sources, AI providers, Studio panels and templates. Those additions must preserve Vexa planning/security rules.

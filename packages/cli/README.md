# @vexa-video/cli

Terminal access to Vexa media workflows and programmable composition discovery, bundling, validation, inspection and rendering.

> Stable baseline: **2.0.0** · Node.js command-line interface.

## Install

```bash
npm install @vexa-video/cli@2.0.0
```

## When to use it

Use this package for local scripting, diagnostics, CI helpers and composition workflows without writing a Node wrapper first.

## Capabilities

- Media probe/plan/render
- Hardware inspection and adaptive streaming commands
- Composition discovery and bundling
- Composition inspect/validate/render/still
- Machine-readable JSON output/errors

## Quick commands

```bash
vexa --help
vexa probe input.mp4
vexa hardware --json
```

## Runtime boundary

The CLI delegates to existing SDK/bundler/renderer contracts; it is not a separate execution engine.

## Documentation

- [getting-started.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/getting-started.md)
- [compositions.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/compositions.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

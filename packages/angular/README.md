# @vexa-video/angular

Angular providers, transport configuration, uploads, render-job clients, Signals/RxJS state and preview helpers for Vexa-backed applications.

> Stable baseline: **2.0.0** · Browser-safe Angular integration.

## Install

```bash
npm install @vexa-video/angular@2.0.0
```

## When to use it

Use this package in an Angular browser application that talks to a Node Vexa render service.

## Capabilities

- DI configuration through `provideVexaVideo(...)`
- Browser uploads and media helpers
- Render submission, polling/progress and cancellation
- Signals and RxJS integration
- Replaceable transport boundary

## Minimal example

```ts
import { provideVexaVideo } from "@vexa-video/angular";

export const appConfig = {
  providers: [provideVexaVideo({ baseUrl: "http://127.0.0.1:4180", pollIntervalMs: 500 })]
};
```

## Runtime boundary

This package must not runtime-import `@vexa-video/sdk`, FFmpeg, `node:*`, `child_process`, Redis or other Node-only dependencies.

## Documentation

- [angular-integration.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/angular-integration.md)
- [architecture.md](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/architecture.md)

For the full package map and runtime boundaries, see the [Vexa package guide](https://github.com/mooskyai/vexa-video-sdk/blob/main/docs/package-guide.md).

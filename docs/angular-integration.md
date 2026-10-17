# Angular Integration

`@vexa-video/angular` is the browser-safe Angular integration for Vexa Video SDK. It talks to a render service through an explicit transport and never runtime-imports the Node SDK or FFmpeg execution code.

## Install

```bash
npm install @vexa-video/angular@2.0.0
```

The repository development baseline uses Angular 21.2.x and TypeScript 5.9.x.

## Configure providers

```ts
import { provideVexaVideo } from "@vexa-video/angular";

export const appConfig = {
  providers: [
    provideVexaVideo({
      baseUrl: "http://127.0.0.1:4180",
      pollIntervalMs: 500
    })
  ]
};
```

The package exposes browser-side upload, render-job, cancellation, Signal/RxJS state and transport abstractions. The server remains responsible for media execution.

## Recommended architecture

```text
Angular application
      |
      v
@vexa-video/angular
      |
      v
HTTP/custom transport
      |
      v
Node render service
      |
      v
@vexa-video/sdk / @vexa-video/renderer
```

## Repository render-service example

Build and run the bundled Angular render service from the repository root:

```bash
npm run example:angular-service
```

The example service uses port `4180` and exposes a health endpoint at:

```text
http://127.0.0.1:4180/health
```

The browser client example lives under `examples/` and should use its own workspace scripts/configuration; the root package does not promise a generic `example:angular-demo` script.

## Custom transport

Production applications can replace the default transport while preserving the browser-safe public contracts. Typical reasons include:

- existing API gateways;
- authenticated request clients;
- WebSocket/SSE status delivery;
- organization-specific upload protocols.

Keep authentication, authorization and tenant context in your application/service boundary rather than adding credentials to reusable browser state.

## Browser safety

Do not import these from Angular runtime code:

- `@vexa-video/sdk`;
- Node `child_process`/`node:*` modules;
- FFmpeg executors;
- Redis clients.

If a feature requires server execution, add it to the render-service API and return a serializable job/result contract.

## Production checklist

- authenticate upload/render endpoints;
- enforce media/request size limits;
- use managed server workspaces;
- handle cancellation and failed jobs;
- avoid exposing local filesystem paths to the browser;
- use trusted output URLs or application-owned download endpoints;
- configure CORS intentionally rather than broadly.

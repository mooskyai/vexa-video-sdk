# Angular Integration

`@moosky-video/angular` is the browser-facing integration layer for Vexa Video SDK. It communicates with a Node render service while keeping FFmpeg, local filesystem access, worker infrastructure, and other Node-only dependencies outside the browser bundle.

## Architecture

```text
Angular application
      |
      v
@moosky-video/angular
      |
 fetch / custom transport
      |
      v
Node render service
      |
      v
@moosky-video/sdk
      |
 jobs / storage / hardware / FFmpeg
```

The Angular package must not have runtime imports from `@moosky-video/sdk`, `node:*`, or `child_process`.

## Compatibility

The public Angular package targets modern Angular/RxJS applications through peer dependencies. The repository's runnable demo should use a single internally compatible Angular toolchain.

The root repository currently uses TypeScript 5.9.x. Angular build tooling that requires TypeScript 6 must not be allowed to float into the demo independently. Keep Angular CLI/build/compiler/runtime packages aligned on a TypeScript-5.9-compatible Angular 21.2.x release unless the repository TypeScript baseline is intentionally upgraded as one coordinated change.

Avoid resolving install conflicts with `--force` or `--legacy-peer-deps`; those flags can hide a genuinely incompatible compiler/tooling combination.

## Configure providers

```ts
import { provideVexaVideo } from "@moosky-video/angular";

export const appConfig = {
  providers: [
    provideVexaVideo({
      baseUrl: "https://media.example.com",
      pollIntervalMs: 750,
      headers: async () => ({
        authorization: `Bearer ${await getAccessToken()}`
      })
    })
  ]
};
```

Default service paths:

```text
POST   /v1/media
POST   /v1/jobs
GET    /v1/jobs/:id
DELETE /v1/jobs/:id
```

Paths and transport behavior can be customized through providers.

## Upload and render

```ts
import { inject } from "@angular/core";
import {
  VexaMediaService,
  VexaRenderService
} from "@moosky-video/angular";

const media = inject(VexaMediaService);
const renders = inject(VexaRenderService);

const uploaded = await media.upload(file);

const job = await renders.renderVideo({
  mediaId: uploaded.id,
  operations: [
    { type: "trim", options: { start: 2, duration: 15 } },
    { type: "resize", options: { width: 1280, height: 720, fit: "contain" } }
  ],
  outputFormat: "mp4",
  export: {
    videoCodec: "h264",
    audioCodec: "aac",
    hardwareAcceleration: "auto"
  }
}, {
  idempotencyKey: "customer-42:render-7",
  retry: { maxAttempts: 3 }
});
```

## Signals

`VexaJobRef` exposes Angular Signals for job state:

- `snapshot()`
- `state()`
- `progress()`
- `result()`
- `error()`
- `done()`

A ref polls through the configured render provider until the job reaches a terminal state. Stop manually tracked refs when they are no longer needed.

## RxJS

Applications that prefer streams can use `VexaRenderService.watch(...)`:

```ts
const subscription = renders.watch(jobId).subscribe({
  next(snapshot) {
    console.log(snapshot.state, snapshot.progress?.percent);
  },
  complete() {
    console.log("Job reached a terminal state");
  }
});
```

Unsubscribing stops future polling and aborts the active request.

## Preview helpers

`VexaPreviewService` converts media/output references into render-service URLs and can attach them to an `HTMLMediaElement`.

```ts
const detach = preview.attach(videoElement, uploaded, {
  autoplay: true,
  muted: true
});

// later
detach();
```

## Replace transport, media, or render providers

The default implementation uses browser `fetch`, but applications can replace layers independently:

```ts
provideVexaVideo(
  { baseUrl: "/api/media" },
  withVexaTransport(MyTransport),
  withVexaMediaProvider(MyMediaProvider),
  withVexaRenderProvider(MyRenderProvider)
);
```

This supports custom authentication, storage, API gateways, GraphQL/RPC transports, or existing job backends without changing component-facing APIs.

## Project rendering

`renderProject(...)` accepts a serializable `VideoProjectAst` plus a mapping from project source identifiers to uploaded media IDs. The Node service resolves those IDs before calling `VideoProject`.

The browser should exchange serializable domain objects, not live Node SDK instances.

## Example render service

The repository includes `examples/angular-render-service`, a small Node HTTP service using `@moosky-video/sdk` and `JobQueue`.

Start it with:

```bash
npm run example:angular-service
```

Default origin:

```text
http://127.0.0.1:4180
```

Developer-facing routes:

```text
GET    /
GET    /health
POST   /v1/media
POST   /v1/jobs
GET    /v1/jobs/:id
DELETE /v1/jobs/:id
GET    /v1/media/:id/:name
GET    /v1/outputs/:name
```

Opening `/` shows a service status page. `/health` returns JSON health data. Port `4180` is the render API, not the Angular application UI.

## Runnable browser demo

`examples/angular-client` is intended to be a real browser demo for the Angular package.

Start the runnable browser demo with:

```bash
npm run example:angular-demo
```

Expected local endpoints:

```text
Angular UI    http://127.0.0.1:4200
Render API    http://127.0.0.1:4180
Health        http://127.0.0.1:4180/health
```

The demo exercises:

- service health;
- file selection/drag-and-drop;
- media upload;
- source preview;
- output dimensions;
- hardware preference;
- retry count and optional idempotency key;
- background render submission;
- Signal-driven state/progress;
- cancellation;
- completed-output playback.

A compatible alternate render service can be selected through a `service` query parameter when supported by the demo configuration.

## Browser bootstrap guidance

The configured browser target matrix may reject top-level `await`. Use promise handling instead of:

```ts
await bootstrapApplication(AppComponent, appConfig);
```

Prefer:

```ts
bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  console.error("Failed to bootstrap the Vexa Angular demo.", error);
});
```

## Troubleshooting

### `ERESOLVE` mentions Angular build and TypeScript 6

Cause: an Angular build-tool version that requires TypeScript 6 was resolved while the repository still uses TypeScript 5.9.

Fix: align `@angular/build`, `@angular/cli`, `@angular/compiler`, `@angular/compiler-cli`, `@angular/core`, `@angular/common`, and `@angular/platform-browser` on one compatible Angular 21.2.x release. Do not paper over the mismatch with npm force flags.

### `Top-level await is not available in the configured target environment`

Remove top-level `await` from `main.ts` and handle the bootstrap promise with `.catch(...)` as shown above.

### Opening `http://127.0.0.1:4180` does not show the Angular app

Expected behavior: port `4180` is the Node render API. The Angular UI runs separately on port `4200` when the browser demo is started.

### Service indicator is offline

Check:

```text
http://127.0.0.1:4180/health
```

Then verify the Angular client's configured `baseUrl`, browser console, CORS policy, and whether another process is already using the port.

## Browser safety verification

Automated coverage should scan the Angular package and reject runtime references to Node-only modules. This is an architectural contract, not a bundler workaround.

When adding a new Angular feature, ask whether the feature belongs in the browser adapter or in the Node render service. Media execution, local files, cloud credentials, Redis workers, and FFmpeg belong on the Node side.

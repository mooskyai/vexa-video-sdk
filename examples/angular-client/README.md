# Angular Client Demo

This example demonstrates the browser-safe `@moosky-video/angular` package against the Node render service in `examples/angular-render-service`.

The intended data flow is:

```text
Angular UI
   |
   v
@moosky-video/angular
   |
   v
Node render service
   |
   v
JobQueue
   |
   v
@moosky-video/sdk
   |
   v
FFmpeg
```

The browser app does not import the Node SDK or FFmpeg directly.

## Prerequisites

From the repository root, make sure Node.js, npm, FFmpeg, and ffprobe are available.

The repository currently uses TypeScript 5.9.x. Keep the demo Angular CLI/build/compiler/runtime packages aligned on a compatible Angular 21.2.x line unless TypeScript is upgraded across the whole workspace.

If npm tries to install Angular build tooling that requires TypeScript 6, fix the version alignment instead of using `--force` or `--legacy-peer-deps`.

## Start the render service

```bash
npm run example:angular-service
```

Verify:

```text
http://127.0.0.1:4180/
http://127.0.0.1:4180/health
```

The service on port `4180` is an API/status service, not the Angular application UI.

## Start the browser client

Start the browser client with:

```bash
npm run example:angular-client
```

Or start both client and service together:

```bash
npm run example:angular-demo
```

Open:

```text
http://127.0.0.1:4200
```

## Demo workflow

The runnable client is expected to support:

1. render-service health check;
2. video file selection or drag/drop;
3. browser upload through `VexaMediaService`;
4. uploaded source preview;
5. output width/height selection;
6. hardware preference selection;
7. retry attempts and optional idempotency key;
8. `video.render` submission;
9. Signal-driven state/progress display;
10. job cancellation;
11. completed-output playback.

## Alternate render service

When supported by the local demo configuration, use a query parameter to point the UI at another compatible service:

```text
http://127.0.0.1:4200/?service=https://media.example.com
```

## Browser bootstrap

Do not use top-level `await` in the demo entry point if the configured browser target matrix does not support it.

Use:

```ts
bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  console.error("Failed to bootstrap the Vexa Angular demo.", error);
});
```

instead of:

```ts
await bootstrapApplication(AppComponent, appConfig);
```

## Troubleshooting

### npm `ERESOLVE` references TypeScript 6

Align all Angular CLI/build/compiler/runtime packages to the same Angular 21.2.x version compatible with TypeScript 5.9.x.

### `Top-level await is not available`

Update `src/main.ts` to handle `bootstrapApplication(...)` with `.catch(...)` instead of top-level `await`.

### `Route not found` on port 4180

Use a service build that includes the root/health routes, then rebuild. `/health` should return JSON with `status: "ok"`.

### Angular UI reports the service offline

Check `/health`, then inspect the browser console, configured service origin, and CORS response headers.

## Security note

The example render service is a development integration service. Production applications should add authentication, authorization, quotas, persistence, rate limits, CORS restrictions, and worker isolation appropriate to their deployment.

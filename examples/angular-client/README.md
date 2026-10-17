# Angular browser integration example

This source workspace demonstrates the browser boundary for `@vexa-video/angular@2.0.0` against the Node render service in `examples/angular-render-service`.

```text
Angular UI
   |
   v
@vexa-video/angular
   |
   v
HTTP transport
   |
   v
Node render service
   |
   v
@vexa-video/sdk -> FFmpeg
```

The browser client never imports the Node SDK or FFmpeg execution code.

## What this example demonstrates

- `provideVexaVideo(...)` configuration;
- browser media upload;
- render-job submission and polling;
- Signal/RxJS state and progress;
- cancellation;
- completed-output playback.

## Run the matching render service

From the repository root:

```bash
npm run example:angular-service
```

The service listens at `http://127.0.0.1:4180` and exposes a `/health` endpoint.

## About the client workspace

At the `2.0.0` baseline this directory is a **source integration example**, not a standalone root-script application. There is no `example:angular-client` or `example:angular-demo` script in the released root `package.json`.

To run the UI, place/adapt these source files in an Angular 21.2.x application compatible with the repository TypeScript 5.9.x baseline, or add an explicit application workspace in a future change. Do not work around incompatible Angular/TypeScript versions with `--force` or `--legacy-peer-deps`.

See [`../../docs/angular-integration.md`](../../docs/angular-integration.md) for the supported package contract and deployment boundary.

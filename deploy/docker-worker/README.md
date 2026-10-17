# Vexa Docker Render Service

This recipe builds the repository REST render-service example into a small Node.js container with FFmpeg installed.

It is a deployment example, not the full Version 3 hosted-rendering platform.

## Start with Docker Compose

From the repository root:

```bash
docker compose -f deploy/docker-worker/compose.yaml up --build
```

The service listens on:

```text
http://127.0.0.1:4190
```

Health check:

```text
http://127.0.0.1:4190/health
```

## Defaults

The image sets:

```text
VEXA_REST_HOST=0.0.0.0
VEXA_REST_PORT=4190
VEXA_WORKER_CONCURRENCY=2
VEXA_REST_WORKSPACE=/var/lib/vexa
```

`/var/lib/vexa` is a persistent volume in the provided Compose file.

## Production use

Before exposing the service publicly, add application-level authentication/authorization, request/media size limits, network controls, retention policy and tenant isolation appropriate to your environment.

See [`../../docs/hosted-rendering.md`](../../docs/hosted-rendering.md) and [`../../SECURITY.md`](../../SECURITY.md).

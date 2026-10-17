# Vexa REST render-service template

A small Node.js reference service that exposes Vexa media upload and background render jobs over HTTP using the same `JobQueue` and `Video` contracts as application code.

## Run

From the repository root:

```bash
npm run example:rest-service
```

Default origin:

```text
http://127.0.0.1:4190
```

## Environment

- `VEXA_REST_HOST`
- `VEXA_REST_PORT`
- `VEXA_REST_WORKSPACE`
- `VEXA_WORKER_CONCURRENCY`
- `VEXA_MAX_UPLOAD_BYTES`

## Intended use

Use this as a reference boundary for browser examples, internal tools and deployment prototypes. Replace the HTTP/auth/persistence/storage layer as needed without changing Vexa media execution semantics.

This is not a complete multi-tenant hosted platform. Production deployments should add authentication/authorization, quotas, persistence, rate limiting, CORS restrictions, network controls, artifact retention and worker isolation appropriate to the environment.

For a containerized version, see [`../../deploy/docker-worker/README.md`](../../deploy/docker-worker/README.md). For hosted-render contracts, see [`../../docs/hosted-rendering.md`](../../docs/hosted-rendering.md).

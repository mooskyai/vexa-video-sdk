# Vexa REST service template

A dependency-light Node.js template that exposes Vexa uploads and background render jobs over HTTP.

```bash
npm run example:rest-service
```

Default endpoint: `http://127.0.0.1:4190`.

Environment variables:

- `VEXA_REST_HOST`
- `VEXA_REST_PORT`
- `VEXA_REST_WORKSPACE`
- `VEXA_WORKER_CONCURRENCY`
- `VEXA_MAX_UPLOAD_BYTES`

The template intentionally uses the existing `JobQueue` and `Video` APIs so applications can replace the HTTP/auth/storage layer without changing media execution semantics.

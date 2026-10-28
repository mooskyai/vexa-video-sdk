# V3.1o — External object-storage crash-recovery acceptance

This is an **opt-in test-only** S3-compatible integration gate against an isolated SILO S3-compatible container and a dedicated Redis 7 instance. It extends the existing Redis/live-file fixtures; it does not add an S3 client to published SDK packages, provide a production storage adapter, or change the released `2.0.0` API.

## Required setup (Windows PowerShell)

Use Docker Desktop and Node.js >=24.21.0 from the repository root. The commands bind both test services to loopback and create a random empty S3 bucket and a unique Redis namespace per run. Do not point the acceptance harness at a production account.

```powershell
Set-Location "C:\working\Projects\nodejs\vexa-video-sdk"

docker run -d --name vexa-v31o-redis -p 127.0.0.1:6389:6379 redis:7-alpine
if ($LASTEXITCODE -ne 0) { throw "Redis startup failed" }

docker run -d --name vexa-v31o-silo -p 127.0.0.1:9005:9000 `
  -e MINIO_ROOT_USER=vexaacceptance -e MINIO_ROOT_PASSWORD=vexaacceptance-only-local-2026 `
  docker.io/pgsty/silo:RELEASE.2026-10-18T00-00-00Z server /data
if ($LASTEXITCODE -ne 0) { throw "SILO startup failed" }

$env:VEXA_TEST_REDIS_URL = "redis://127.0.0.1:6389"
$env:VEXA_TEST_S3_URL = "http://127.0.0.1:9005"
$env:VEXA_TEST_S3_ACCESS_KEY = "vexaacceptance"
$env:VEXA_TEST_S3_SECRET_KEY = "vexaacceptance-only-local-2026"

try {
  # Ensure the service is ready before running the test suite.
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $ping = Invoke-WebRequest -Uri "http://127.0.0.1:9005/minio/health/live" -TimeoutSec 2
      if ($ping.StatusCode -eq 200) { break }
    } catch { Start-Sleep -Seconds 1 }
  }
  npm run test:object-storage
  if ($LASTEXITCODE -ne 0) { throw "External object-storage acceptance failed. Do not commit." }
}
finally {
  docker rm -f vexa-v31o-silo vexa-v31o-redis
  Remove-Item Env:VEXA_TEST_REDIS_URL,Env:VEXA_TEST_S3_URL,Env:VEXA_TEST_S3_ACCESS_KEY,Env:VEXA_TEST_S3_SECRET_KEY -ErrorAction SilentlyContinue
}
```

SILO is a maintained MinIO-compatible fork. Legacy MinIO Docker Hub/Quay image pulls are not dependable in October 2026; the command pins a verified published SILO release.

The test requires loopback **HTTP** S3 endpoint and explicitly configured credentials. The test signer supports only fixed-region `us-east-1`, path-style bucket addressing, and isolated `case-*.mp4` objects in freshly randomized `vexa-acceptance-<hex>` buckets. No bucket listing, bulk sweep or `FLUSHDB` is performed. The signer and credentials are **not production code**; pin the image digest in CI for reproducibility.

## Seven acceptance scenarios

1. Crash before the remote PUT: no object exists and no receipt can be adopted.
2. Abrupt child-process exit immediately after acknowledged conditional S3 PUT and before receipt persistence: object survives and a fresh Redis client verifies and adopts the exact fingerprint without another upload.
3. Abrupt child-process exit immediately after durable Redis receipt: a fresh client reuses the receipt, while the destination rejects a subsequent conditional PUT.
4. Two concurrent conflicting `If-None-Match: *` PUTs: exactly one S3 object is accepted, the other gets HTTP 409/412, and Redis cannot adopt the wrong request fingerprint.
5. Object removed after receipt creation: lookup and reconciliation fail closed, rather than presenting a stale receipt as healthy.
6. Existing object missing the authoritative fingerprint/identity metadata: reconciliation rejects it.
7. Invalid S3 credentials: 401/403 is treated as a provider error, **not** an authoritative missing-object result.

The `If-None-Match` gate is intentionally strict: an S3-compatible provider that does not implement conditional writes fails this acceptance. The remote object metadata must be written by the publisher itself, in an authorization-scoped bucket; request fingerprint equality alone is not a proof of malicious tamper resistance.

## Remaining limitations and production gates

This tests SILO's real HTTP object PUT/HEAD/GET/DELETE and Redis CAS, plus abrupt Node worker process exit. It does **not** prove identical semantics for AWS S3, GCS, Azure Blob, multipart uploads, provider/network partitions, cross-region replication, durable backup/restore, or interruption of an in-flight streaming upload. The example's `publish`/inspect adapter and SigV4 signer are fixtures, not production API. Validate the exact production adapter, object versioning/conditional semantics, IAM isolation, provider backup, and cleanup policies separately before treating remote publication as production-ready. Side effects remain at-least-once and external publication is not a global transaction with Redis or worker leasing.

Run `npm run verify` (466 regular tests), `npm run test:redis` (12 Redis-only integration tests), and `npm run test:object-storage` (7 isolated S3+Redis tests). Never claim the external acceptance passed until its actual output shows all seven tests passing.

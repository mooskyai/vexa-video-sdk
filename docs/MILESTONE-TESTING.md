# Engineering Verification Guide

**V3.1t targeted acceptance:** `npm run verify` includes new exclusive-reclamation unit tests. `npm run test:workspace-quiescence-redis` requires dedicated loopback Redis and exercises active owners, fencing, concurrent admission, host denial and authority outage. Continue to run `npm run test:workspace-crash`, `npm run test:redis`, `npm run test:object-storage` and `npm run test:v3-release-gate`. These targeted cases are not proof of deployment-wide FFmpeg producer quiescence; see [V3.1t acceptance boundary](./V3_1T_DISTRIBUTED_WORKSPACE_OWNERSHIP.md).

**V3.1s acceptance:** `npm run test:v3-release-gate` verifies the exact audit evidence schema and its intentional NO-GO; `node scripts/v3-release-gate.mjs --json` prints a read-only decision. A strict `--require-ready` intentionally exits 2 while the evidence is blocked. This does not replace `npm run verify`, real Redis/S3-compatible acceptance, current-commit GitHub CI or the cross-platform release matrix. See [the release-gate review](./V3_1S_RELEASE_GATE_REVIEW.md).

This file keeps its historical filename because existing repository links may reference it. It now describes the current verification model for Version 2.0.0 and future work.

## Default gate

Run before committing a normal code change:

```bash
npm run verify
```

That performs type checking, automated tests and builds through the repository scripts.

Also run:

```bash
git diff --check
```

## Choose tests by boundary

| Change area | Minimum additional verification |
| --- | --- |
| FFmpeg/process/media behavior | real FFmpeg integration test |
| Studio/browser behavior | `npm run verify:studio` |
| package exports/metadata | `npm run release:check` + `npm run release:pack` |
| published consumer behavior | `npm run release:install-check` |
| FFmpeg baseline assumptions | `npm run release:ffmpeg-check` |
| trusted publishing/release workflow | `npm run release:trusted-publish-check` and protected workflow dry run |

## Testing principles

### Test the real boundary

Mocks can prove orchestration but cannot prove FFmpeg codecs, browser pixels, filesystem cleanup, process cancellation, packed exports or remote-worker behavior. Add at least one real integration test when a feature depends on those systems.

### Test deterministic contracts

For planners, validators, composition metadata and serialized project structures, assert normalized outputs and typed error behavior.

### Test cancellation and cleanup

Any long-running operation should be exercised through cancellation/failure paths when it creates child processes, temporary files, workspaces or partial artifacts.

### Test browser/server separation

Changes to browser packages must retain prohibited-runtime import guards. A browser build that compiles by accidentally bundling Node shims is not acceptable.

### Test packed artifacts

Workspace tests can hide missing files, wrong exports and symlink behavior. Release qualification therefore packs real tarballs and installs them into an isolated consumer project.

## Version 2 visual/runtime regression

`@vexa-video/test` provides deterministic selected-frame checkpoints, PNG comparison and runtime checkpoint parity helpers. Version 2 acceptance also uses real Chromium Studio captures for reviewed transition fixtures and probes real audio/video duration synchronization.

Use these tools for Vexa-owned deterministic fixtures, not as a substitute for visual review of arbitrary third-party media.

## Cross-platform expectations

Path, font, process, hardware and browser behavior can differ across operating systems. Release acceptance covers:

- Ubuntu / Node 24.21;
- Windows / Node 24.21;
- macOS / Node 24.21;
- Ubuntu / Node 26 compatibility;
- Chrome Studio acceptance on Ubuntu, Windows and macOS;
- Edge Studio acceptance on Windows.

Feature PRs do not need to reproduce the entire release matrix locally when focused tests prove their slice, but the protected release path must remain green.

## Version 3 additions

V3.1r adds **eight** read-only artifact lifecycle planner tests (expected **476** regular tests: 468 + 8), covering the five-resource ownership matrix, age floors, archive/remote proof, tenant and batch isolation, deterministic results and fail-closed invalid input. The V3.1q live CI passed on commit `83b5495` ([run 40653898073](https://github.com/mooskyai/vexa-video-sdk/actions/runs/40653898073)). V3.1r still needs its own successful `npm run verify` and commit-matched CI; opt-in workspace/Redis/S3 tests remain 4/12/7.

Each V3 stage should add fault/scale/integration tests appropriate to its new guarantee. In particular, V3.1 worker hardening should use fault injection for process death, stale leases, retries, recovery and workspace cleanup rather than relying on happy-path worker tests.

V3.1a focused acceptance covers renewable heartbeats during active work, rejection of stale claim-token mutations, cancellation while a lease is active, Redis lease-aware claim/save/finish behavior, and clearing the lease when work becomes terminal.

V3.1b tests cover atomic claim-list ownership, no premature reclaim of a live lease, expired-claim requeue with stale token rejection, terminal cancellation after worker death, exhausted-attempt failure context, and autonomous recovery by a replacement worker. The fake Redis implements corresponding atomic script effects; validate with a real Redis deployment.

V3.1c tests exercise terminal worker-failure dead-letter persistence, non-retryable failure reason classification, stale-lease exhaustion, cancellation exclusion, duplicate-sweep safety and bounded inspection input validation. Redis Lua must persist the failed snapshot and its dead-letter record/index atomically, never allowing a lost lease to archive or overwrite a newer owner.

V3.1d focused acceptance covers atomic queued/delayed cancellation and lease-aware cancellation, bounded promotion of due retries, discarding orphan/cancelled delayed entries, single-promote semantics, stale claim fencing, read-only queue counters, diagnostic callback isolation and input validation. The fake Redis models Lua state transitions but does not replace live Redis fault injection. Run multi-worker, kill/restart, and cancellation/promotion race tests against real Redis before production claims. Retention, replay and external artifact reconciliation are still excluded.

V3.1e acceptance adds worker-loop fault injection: transient claim failures must not kill the worker, execution-path errors must not prevent later jobs, a rejected heartbeat must abort execution without publishing a late result, activity counts must clear after processing, and throwing diagnostic listeners must not break job execution. These are deterministic in-memory tests, not live Redis/kill-process acceptance; that gate remains open.

V3.1f also tests opt-in atomic repair of a missing queue reference without duplicate scheduling or lease takeover, plus dry-run-first bounded reclamation of old named workspace directories. Age does not prove that an active worker has stopped: destructive cleanup requires operator coordination. Real Redis kill/restart and external artifact verification are still open acceptance gates.

V3.1g retention tests cover no-op dry runs, oldest-first batch limits, recent failure preservation, unchanged job snapshots, repeat safety, unsafe option rejection and non-blocking diagnostic listeners. Fake Redis emulates the atomic Lua contract; live Redis fault-injection and operator backup/retention verification remain required before production adoption.

V3.1h real-Redis acceptance is opt-in and is **not** included in `npm run verify`. Launch Redis 7 on loopback, set `VEXA_TEST_REDIS_URL=redis://127.0.0.1:6389` and run `npm run test:redis`. All four process death, fencing, cancellation, and retry race tests must pass.

V3.1i tests deterministic publication fingerprints, persisted-receipt reuse after a simulated post-publication failure, mismatched receipt rejection, and fail-closed provider lookup errors. These tests use a fake provider; validating provider-backed durable receipts and publication under real process crashes is a separate acceptance gate.

V3.1j adds four Redis receipt adapter unit tests and two opt-in real-Redis tests for cross-client durability, concurrent compare-and-set, remote-object disappearance and cancellation guards. `npm run verify` runs the unit tests; `npm run test:redis` runs six real Redis tests in total. Provider storage crash injection and a durable backup policy remain separate acceptance requirements.

V3.1k adds four unit tests for opt-in unrecorded-artifact recovery, mismatch rejection, provider failure and cancellation, plus two real-Redis tests proving cross-client adoption and competing-request fencing. Expected gates are 454 unit-suite tests via `npm run verify` and 8 real-Redis tests via `npm run test:redis`; real object-store crash injection is not covered by the file-backed provider fixture.

V3.1l adds four unit tests for dry-run, age threshold, missing/present/reference gates, cancellation/validation and changed-raw fencing, plus two live Redis tests. Expected gates are 458 regular tests and 10 live Redis tests. No remote deletion, sweeper, provider lock or legacy timestamp backfill is provided.

V3.1m adds four unit tests and two opt-in live Redis checks for 100-candidate bounds, duplicate/identity rejection, read-only summaries, reference safety, per-item redacted failures and observer isolation. Expected totals: 462 tests via `npm run verify` and 12 via `npm run test:redis`. These tests are not an external-object-store sweep or a global producer lock.

V3.1n adds four worker-level tests for successful/failed outcomes, monotonic durations, payload/error omission, and synchronous telemetry exporter isolation, plus lease-loss counter and span fencing. Expected totals: 466 tests via `npm run verify`; `npm run test:redis` remains 12 real Redis tests. The hooks do not export to a particular metrics or tracing backend; deploy an application-provided exporter and sampling/aggregation policy before production use.

V3.1o adds 7 **opt-in** real SILO/S3-compatible plus Redis HTTP/process-exit acceptance tests (`npm run test:object-storage`), outside the 466 regular tests and 12 Redis-only tests. Run the isolated containers and environment guards in `docs/V3_1O_OBJECT_STORAGE_ACCEPTANCE.md`. Required checks: before upload absence, crash after acknowledged PUT, crash after receipt, conflicting conditional writers, vanished object, missing metadata and permission denial. Production cloud adapters, interrupted multipart upload, network partitions, provider backup/restore and exact-once behavior are NOT certified by SILO acceptance.

V3.1p adds `.github/workflows/v3-hardening-acceptance.yml`, a standalone Ubuntu/Node 24 GitHub Actions job that runs `npm run verify`, `npm run test:redis`, and `npm run test:object-storage` against loopback Redis 7 and a digest-pinned SILO container. An unexecuted workflow is not a passed gate; record a green commit-matched run before V3.1 sign-off. The regular release-acceptance matrix remains separate, and the [go/no-go review](./V3_1P_PRODUCTION_HARDENING_REVIEW.md) details outstanding workspace and provider acceptance.

V3.1q adds two regular ownership-guard unit tests (468 expected total) and four opt-in FFmpeg-backed Node worker crash/cancellation/restart tests via `npm run test:workspace-crash`; see `docs/V3_1Q_WORKSPACE_CRASH_ACCEPTANCE.md`. GitHub V3 hardening live acceptance runs the additional suite. The authority callback is optional for backward compatibility; it is not a global worker lock or proof of safe deletion under unknown concurrent producers.

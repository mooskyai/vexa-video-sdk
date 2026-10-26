# Engineering Verification Guide

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

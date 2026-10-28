# Changelog

All notable public changes to Vexa Video SDK are documented here. Public `@vexa-video/*` packages use synchronized semantic versions.

## Unreleased

### Added
- V3.1r bounded, read-only, tenant-scoped artifact lifecycle review planner with explicit retention ages, archived-failure export evidence, provider-verified missing receipts and authority checks; no deletion executor.

- V3 distributed-worker lease ownership with unique claim fencing tokens, renewable heartbeats, expiry timestamps, and lease-aware Redis mutation guards.
- worker configuration for lease duration and heartbeat cadence, with fail-closed behavior when a heartbeat can no longer renew ownership.
- V3.1b bounded Redis stale-claim recovery, including safe requeue of expired claims, terminal cancellation cleanup, and explicit exhaustion failure context.
- V3.1c durable Redis dead-letter entries for terminal worker failures and stale-lease exhaustion, with bounded read-only inspection APIs.
- V3.1d bounded retry reconciliation, queue diagnostics, and optional structured operational events.
- V3.1e worker-level claim/execution/lease-loss diagnostics, read-only activity counters, and retryable transport-error backoff.
- V3.1f explicit single-queued-job orphan reconciliation and dry-run-first bounded managed workspace reclamation.
- V3.1g opt-in, bounded, dry-run-first dead-letter retention with atomic Redis index/envelope removal; job records remain untouched.
- V3.1h opt-in real Redis acceptance tests with independent worker-process termination, lease fencing, cancellation recovery, and concurrent retry reconciliation.
- V3.1i opt-in provider publication receipts for retry-safe hosted artifact recovery, fingerprint validation, and fail-closed lookup errors.
- V3.1j Redis-backed provider receipt hooks with destination-keyed atomic write-once semantics and mandatory external artifact validation on write and lookup.
- V3.1k opt-in reconciliation of remote artifacts published before receipt persistence, requiring provider fingerprint evidence and atomic Redis adoption.
- V3.1l opt-in, dry-run-first, age-gated removal of one missing unreferenced Redis publication receipt with atomic compare-and-delete; remote objects are never deleted.
- V3.1m bounded, read-only operator inspection of known publication destinations, structured status counts, per-entry redacted errors and isolated diagnostics; no sweeps or deletion.
- V3.1n opt-in exporter-neutral worker counters, duration histograms and completed-attempt spans, with synchronous sink failure isolation and no metrics cardinality from job IDs.
- V3.1o isolated opt-in SILO and Redis crash-recovery acceptance for conditional object publication, metadata verification, concurrent writers, and provider failure modes; no production storage adapter added.
- V3.1p release-readiness audit and isolated CI job for Redis plus S3-compatible process-crash acceptance; production sign-off remains blocked by documented gaps.

### Changed

- `DistributedJobTransport` is now lease-aware: claims receive a lease duration, heartbeats renew ownership, and worker save/finish/retry mutations must present the active claim token.
- Redis cancellation preserves active lease state atomically so progress writes and heartbeats cannot erase a cancellation request.
- Redis now acquires queued job IDs and assigns leases in the same atomic Lua command, and periodically scans bounded portions of the processing list for expired ownership.

## [2.0.0] — 2026-10-17

Version 2 establishes Vexa as a programmable-video platform in addition to its deterministic media-processing foundation.

### Added

- programmable composition contracts, deterministic frame/time primitives and scene graphs;
- browser-safe React authoring, Player, Studio and WebCodecs rendering layers;
- TypeScript/TSX composition bundling and Node bundle-backed rendering;
- shapes, effects, transitions, typography, composition captions and reusable templates;
- GIF, waveform and sound-effect integrations;
- hosted composition rendering and deterministic artifact publication contracts;
- CLI composition discovery/bundling/inspection/validation/render/still workflows;
- MCP tools and official stdio protocol transport;
- deterministic visual/runtime regression helpers and browser pixel acceptance;
- synchronized release tooling for all eighteen public packages.

### Release and supply chain

- all public packages are synchronized at `2.0.0`;
- release acceptance covers Windows, Ubuntu and macOS plus Chrome and Windows Edge;
- Node.js 24.21.0 is the primary release baseline with an Ubuntu Node.js 26 compatibility lane;
- packed tarballs are installed into isolated consumers before publication;
- npm publication uses GitHub Actions OIDC trusted publishing with provenance;
- a fresh public-registry smoke test verified SDK import, CLI execution, registry signatures and attestations.

### Migration

Existing 1.x users should read [`docs/V2_MIGRATION.md`](./docs/V2_MIGRATION.md).

## [1.0.0]

Initial public Vexa Video SDK release line.
- V3.1q opt-in FFmpeg-backed child-process workspace crash/cancel/restart acceptance and optional authoritative cleanup guard; destructive cleanup remains operator-controlled.

# Changelog

All notable public changes to Vexa Video SDK are documented here. Public `@vexa-video/*` packages use synchronized semantic versions.

## Unreleased

### Added

- V3 distributed-worker lease ownership with unique claim fencing tokens, renewable heartbeats, expiry timestamps, and lease-aware Redis mutation guards.
- worker configuration for lease duration and heartbeat cadence, with fail-closed behavior when a heartbeat can no longer renew ownership.
- V3.1b bounded Redis stale-claim recovery, including safe requeue of expired claims, terminal cancellation cleanup, and explicit exhaustion failure context.
- V3.1c durable Redis dead-letter entries for terminal worker failures and stale-lease exhaustion, with bounded read-only inspection APIs.

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

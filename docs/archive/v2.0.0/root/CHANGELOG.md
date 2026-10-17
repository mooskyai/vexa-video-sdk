# Changelog

All notable public changes are documented here.

The project uses Semantic Versioning and keeps the public `@vexa-video/*` workspace set on one synchronized release version.

## Unreleased

## [2.0.0]

### Added

- Vexa-native programmable composition contracts, deterministic frame/time/animation primitives, scene graphs, React authoring, Player, TypeScript/TSX bundling, Node rendering, Studio, browser/WebCodecs rendering, templates, hosted rendering, CLI/MCP workflows, and frame-level visual regression tooling.
- Shapes, effects, transitions, fonts, composition captions, GIF, waveform, sound-effect, parameterized-template, and agent-facing integrations built on the existing Vexa media/runtime boundaries.
- Version 2 migration guidance and protected tokenless npm release operations.

### Changed

- all eighteen public `@vexa-video/*` packages release in lockstep at `2.0.0`;
- release acceptance verifies packed-tarball installs on Ubuntu 24.04, Windows, and macOS, plus Chrome/Edge Studio acceptance and a Node 26 compatibility lane;
- npm publication uses GitHub Actions OIDC trusted publishing with provenance and rejects `NPM_TOKEN`/`NODE_AUTH_TOKEN` in the protected publish path.

### Migration

See [`docs/V2_MIGRATION.md`](./docs/V2_MIGRATION.md) before upgrading an existing Vexa application.

## [1.0.0]

- Initial Vexa Video SDK release line.

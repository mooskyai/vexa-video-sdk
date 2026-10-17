# Contributing to Vexa Video SDK

Thank you for contributing. Vexa is a multi-package media SDK with strict browser/server boundaries and deterministic execution requirements, so changes should be small, testable and explicit about which runtime they affect.

## Baseline

The current stable baseline is Version **2.0.0**. The release source is `af8d1d8e0c967e2651b8f77c1e02b6f11135a90a` and public packages are synchronized at `2.0.0`.

For new work, start from current `main` and verify your checkout before changing code:

```bash
git status -sb
git rev-parse HEAD
```

## Local requirements

- Node.js 24.21.0+
- npm 11+
- FFmpeg/ffprobe 6.1+
- Git

Install and verify:

```bash
npm install
npm run verify
```

## Repository model

The important package boundaries are:

- `@vexa-video/core`: backend-neutral contracts and serializable models;
- `@vexa-video/ffmpeg`: Node FFmpeg/ffprobe planning and execution;
- `@vexa-video/sdk`: high-level Node media/storage/jobs/hardware APIs;
- browser packages: Angular, React, Player, Editor, Studio, Web Renderer;
- execution packages: Bundler, Renderer, CLI, MCP and optional Node adapters.

Browser packages must not runtime-import:

- `@vexa-video/sdk`;
- `@vexa-video/ffmpeg` execution code;
- `node:*` modules;
- `child_process`;
- Redis or other Node-only worker clients.

If browser code needs execution, expose a serializable contract and communicate with a Node service through HTTP or another explicit transport.

## Development workflow

Before a change:

```bash
git status -sb
git rev-parse HEAD
```

During development use focused tests where possible, then run the repository gate:

```bash
npm run typecheck
npm test
npm run build
npm run verify
```

Changes affecting Studio/browser behavior should also run:

```bash
npm run verify:studio
```

Changes affecting package/release surfaces should additionally run:

```bash
npm run release:check
npm run release:pack
npm run release:install-check
npm run release:ffmpeg-check
```

## Design expectations

### Prefer intent over process arguments

Public APIs should describe media intent. FFmpeg argument construction belongs behind planner/executor boundaries.

### Keep plans deterministic

Where practical, the same normalized input should produce the same serializable plan. Avoid hidden process-global state and implicit filesystem dependencies.

### Preserve cancellation and progress

Long-running operations must integrate with existing signal/progress conventions rather than inventing parallel lifecycle models.

### Reuse existing execution paths

New composition, CLI, MCP, plugin or hosted-render features should delegate to existing validators/renderers/jobs/storage contracts. Do not create a second render engine for convenience.

### Make security boundaries explicit

Remote URLs, plugins, process execution, filesystem paths and agent-facing inputs are security-sensitive. Reuse existing validation and path/network restrictions.

## Tests

A feature is not complete with unit tests alone when it relies on FFmpeg, browsers, files, networking or worker lifecycle behavior. Add an integration test that exercises the real boundary.

Useful guidance is in [`docs/MILESTONE-TESTING.md`](./docs/MILESTONE-TESTING.md).

## Documentation

Every public change must update the relevant documentation in the same pull request:

- public onboarding/major capability changes: `README.md`;
- architecture/package-boundary changes: `docs/architecture.md`;
- user workflow changes: the relevant guide under `docs/`;
- future sequencing/status changes: `ROADMAP.md`;
- release-visible changes: `CHANGELOG.md`.

Keep examples executable and do not document scripts or package exports that are not present in the current repository.

## Pull request checklist

Before requesting review:

- working tree contains only intended changes;
- typecheck, tests and build pass;
- affected integration/browser tests pass;
- no browser package gained a Node-only runtime dependency;
- public API behavior is documented and versioning impact considered;
- `git diff --check` passes;
- documentation matches the code being proposed.

## Commits

Use focused commits with messages that describe user-visible intent, for example:

```text
feat(scheduler): add worker lease recovery
fix(renderer): preserve cancellation during frame ranges
docs: rebaseline V3 on the 2.0.0 release
```

Do not combine unrelated refactors, generated artifacts and feature behavior in one commit unless they are inseparable.

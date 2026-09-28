# Contributing to Vexa Video SDK

Thanks for helping improve Vexa Video SDK. This project combines public TypeScript APIs, FFmpeg process execution, storage/network boundaries, worker infrastructure, and browser integrations, so changes should be small, testable, and explicit about runtime boundaries.

## Prerequisites

Install:

- Node.js 24.21.0 or newer;
- npm 11+ recommended;
- FFmpeg and ffprobe available in `PATH`.

Verify:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## Setup

```bash
git clone https://github.com/mooskyai/vexa-video-sdk.git
cd vexa-video-sdk
npm install
npm run verify
```

## Repository structure

| Path | Purpose |
| --- | --- |
| `packages/core` | Backend-neutral types, ASTs, validation, errors |
| `packages/ffmpeg` | FFmpeg/ffprobe planning and execution |
| `packages/sdk` | Node developer-facing API, storage, jobs, workers |
| `packages/angular` | Browser-safe Angular integration |
| `examples/visual-playground` | Local Node SDK acceptance UI |
| `examples/angular-client` | Angular browser integration demo |
| `examples/angular-render-service` | Node render-service example |
| `docs` | Architecture, integration, and acceptance documentation |

## Development rules

### Keep public APIs backend-neutral

Do not expose raw FFmpeg flags as the primary product API when a stable domain-level option can represent the same intent.

### Preserve browser safety

`@moosky-video/angular` must not import Node runtime modules or `@moosky-video/sdk` at runtime. Browser/server communication should use serializable contracts and replaceable transports.

### Prefer deterministic planning

Validation and compatibility decisions should happen before expensive FFmpeg work where possible. New execution paths should be inspectable through typed plans or equivalent diagnostics.

### Reuse cancellation, progress, and error contracts

Avoid introducing parallel conventions for common execution concerns. Use `AbortSignal`, structured progress, and typed SDK errors consistently.

### Treat remote inputs as untrusted

Do not weaken remote-media network restrictions, path traversal checks, upload limits, or redirect validation without a documented security reason and dedicated tests.

## Making changes

Create a focused branch for public contributions:

```bash
git switch -c feature/short-description
```

Keep commits scoped to one logical change. If a feature changes setup, public APIs, architecture, or acceptance behavior, update the relevant Markdown in the same change.

## Testing

Run the standard gate:

```bash
npm run verify
```

Use narrower commands while iterating:

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

When FFmpeg behavior changes, add or update a real integration test rather than relying only on argument-string assertions.

For browser/package-boundary changes, also verify the Angular package emits no Node-only imports.

See [docs/MILESTONE-TESTING.md](./docs/MILESTONE-TESTING.md) for the full acceptance matrix.

## Windows validation

Windows has exposed several classes of real portability issues in media tooling. Explicitly test Windows when changing:

- path construction/escaping;
- drawtext/font paths;
- HLS/DASH manifests and relative segments;
- temp/workspace paths;
- process cancellation;
- GPU encoder detection.

Do not weaken a cross-platform assertion just to make a Windows test pass. Fix the generated artifact or execution model when the output itself is non-portable.

## New files and patches

Before generating a patch or commit, check:

```bash
git status --short
```

New source files, tests, examples, and documentation must be staged/included. A patch that changes imports but omits the new module is incomplete even if the edited files look correct.

Before sharing a patch:

```bash
git diff --check
```

If the patch is expected to apply to the current branch:

```bash
git apply --check path/to/change.patch
```

## Documentation style

Public documentation should:

- lead with what a user needs to accomplish a task;
- separate product behavior from internal delivery history;
- avoid stale hard-coded test counts unless they are part of a specific validation report;
- include copy-pasteable commands;
- explain browser/Node boundaries clearly;
- document security-sensitive defaults instead of hiding them.

README is product-facing. Detailed implementation tracking belongs in `ROADMAP.md`, architecture, and acceptance docs.

## Pull request checklist

Before opening a pull request:

```text
[ ] change is scoped and understandable
[ ] npm install succeeds normally
[ ] npm run verify passes
[ ] real FFmpeg/network path tested when relevant
[ ] browser safety preserved
[ ] Windows behavior considered/tested when relevant
[ ] new files are tracked
[ ] docs/examples updated
[ ] git diff --check passes
[ ] no generated .tmp/dist/media artifacts are staged
```

## Commit messages

Use short conventional-style subjects when practical:

```text
feat(streaming): add adaptive rendition planning
fix(windows): normalize HLS playlist URIs
docs: clarify Angular render-service setup
test(storage): cover redirect policy
```

## Security changes

For vulnerabilities or sensitive security findings, do not open a public issue with exploit details. Follow [SECURITY.md](./SECURITY.md).

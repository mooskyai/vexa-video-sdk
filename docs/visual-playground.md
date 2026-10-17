# Visual Playground and Studio Acceptance

The repository includes a local visual environment for exercising media workflows and the programmable composition/Studio surfaces during development.

## Start

Build and launch the playground:

```bash
npm run playground
```

For watch-oriented development use:

```bash
npm run dev
```

The playground is served locally at:

```text
http://127.0.0.1:4173
```

## What it exercises

The visual environment is intended for hands-on validation of:

- uploads and media probing;
- video edits and timeline projects;
- audio/caption/streaming settings;
- hardware selection;
- background job progress/cancellation;
- programmable composition discovery/bundling;
- Player/Studio preview state;
- Node composition render planning/execution;
- generated outputs and failure recovery.

## Automated Studio acceptance

Run:

```bash
npm run verify:studio
```

The release matrix executes Studio acceptance in Chrome across Ubuntu, Windows and macOS plus Microsoft Edge on Windows.

## What the playground is not

The playground is a development/acceptance surface, not a production multi-user editor service. Authentication, tenant storage, quotas, collaboration, persistence and deployment policy belong to the consuming application or future platform work.

## Debugging

When a Studio test fails:

1. reproduce with `npm run playground`;
2. confirm the same composition/props/frame locally;
3. inspect browser diagnostics before changing timing logic;
4. confirm Node render output independently when the failure concerns pixel parity;
5. preserve browser/server package boundaries while fixing the issue.

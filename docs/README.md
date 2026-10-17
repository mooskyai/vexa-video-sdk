# Vexa Video SDK Documentation

This directory contains the canonical documentation for the released **Vexa Video SDK 2.0.0** baseline and the Version 3 plan that builds on it.

## Baseline

```text
Release: 2.0.0
Tag:     v2.0.0
Source:  af8d1d8e0c967e2651b8f77c1e02b6f11135a90a
Node:    >= 24.21.0
```

If a document conflicts with the published package behavior, package code/tests and the tagged release are authoritative. Documentation changes should be made together with the code they describe.

## Start here

| If you want to… | Read |
| --- | --- |
| install Vexa and render your first media | [Getting started](./getting-started.md) |
| choose the correct package | [Package guide](./package-guide.md) |
| build code-defined videos | [Programmable compositions](./compositions.md) |
| understand package/runtime boundaries | [Architecture](./architecture.md) |
| integrate Angular | [Angular integration](./angular-integration.md) |
| use AI-assisted editing helpers | [AI extension](./ai-extension.md) |
| extend Vexa | [Plugin system](./plugins.md) |
| integrate a hosted/cloud render service | [Hosted rendering](./hosted-rendering.md) |
| operate the local visual environment | [Visual playground](./visual-playground.md) |
| understand versioning guarantees | [API stability](./API-STABILITY.md) |
| migrate from 1.x | [Version 2 migration](./V2_MIGRATION.md) |
| contribute/test changes | [Engineering verification](./MILESTONE-TESTING.md) |
| publish a release | [Release operations](./release-operations.md) |
| understand npm trusted publishing | [npm publishing](./npm-publishing.md) |
| understand the next major version | [Version 3 plan](./V3_MILESTONE.md) |

## Historical implementation records

The detailed pre-release Version 2 implementation journals are preserved under [`archive/v2.0.0`](./archive/v2.0.0/) for historical context. They are not the recommended onboarding path.

The concise current records are:

- [Version 2 implementation record](./V2_MILESTONE.md)
- [Version 2 release qualification record](./V2_MILESTONE_TESTING.md)
- [2.0.0 release notes](./releases/v2.0.0.md)

## Documentation principles

Documentation should:

- describe released behavior separately from planned behavior;
- use commands and exports that exist in the repository;
- state whether an API is browser-safe or Node-only;
- prefer short end-to-end examples over internal implementation history;
- link to deeper architecture/testing documents instead of duplicating them;
- keep Version 3 plans explicit about which Version 2 foundation they extend.

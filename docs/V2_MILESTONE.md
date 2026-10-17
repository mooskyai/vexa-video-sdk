# Version 2 Implementation Record

**Status: Released as Vexa Video SDK 2.0.0 on 2026-10-17.**

This file keeps its historical name because repository references may point to it. It is no longer an active implementation plan; it is a concise record of what Version 2 delivered. Detailed pre-release working notes are preserved under `docs/archive/v2.0.0/`.

## Release baseline

```text
Version: 2.0.0
Tag:     v2.0.0
Source:  af8d1d8e0c967e2651b8f77c1e02b6f11135a90a
Packages: 18 public @vexa-video/* packages
```

## Delivered stages

| Stage | Delivered capability |
| --- | --- |
| V2.1 | composition contracts, registry, stills and dynamic metadata |
| V2.2 | deterministic frame/time semantics, interpolation, easing, springs, loops and random |
| V2.3 | composition scene graph and media elements |
| V2.4 | browser-safe React authoring adapter |
| V2.5 | browser Player and framework-neutral playback state |
| V2.6 | TypeScript/TSX bundling and composition discovery |
| V2.7 | Node composition/still/frame-range/video renderer |
| V2.8 | local Studio development environment and hot reload |
| V2.9 | shapes, effects, transitions, fonts and composition captions |
| V2.10 | GIF, waveform and sound-effect integrations |
| V2.11 | browser/WebCodecs rendering and MP4/WebM A/V output planning |
| V2.12 | parameterized templates, validated schemas and reusable assets |
| V2.13 | hosted/serverless composition rendering contracts |
| V2.14 | CLI, agent and MCP composition workflows |
| V2.15 | deterministic frame-level visual/runtime regression tooling |
| V2.16 | release hardening, cross-platform/browser matrix and OIDC publication readiness |

## Architectural result

Version 2 did not create an independent media engine. Programmable compositions reuse shared timing/contracts and lower supported work into the existing project/renderer/FFmpeg paths. Browser packages remain separated from Node execution.

## What moved to Version 3

Production-platform work remains future scope:

- worker leases/heartbeat/recovery/dead letters;
- capability-aware scheduling;
- incremental render caching;
- advanced GPU-resident pipelines;
- professional editor semantics and proxy workflows;
- first-party cloud media packages;
- collaboration/project-format evolution;
- larger hosted-render platform controls.

See [`V3_MILESTONE.md`](./V3_MILESTONE.md).

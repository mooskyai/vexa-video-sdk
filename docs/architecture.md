# Architecture

## Overview

Vexa Video SDK is designed as a typed media platform rather than a thin FFmpeg command wrapper. The public model describes media intent; planning and backend layers decide how that intent is executed.

The architecture has four primary goals:

1. keep public APIs stable and backend-neutral;
2. keep browser packages free of Node-only execution code;
3. make expensive media work inspectable before execution;
4. preserve safe, testable boundaries around processes, storage, networks, workers, and hardware.

## Package boundaries

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `@vexa-video/core` | shared | Types, ASTs, validation, normalized domain models, typed errors |
| `@vexa-video/ffmpeg` | Node.js | ffprobe/FFmpeg adapters, planning, filters, hardware detection, streaming packaging |
| `@vexa-video/sdk` | Node.js | Developer-facing media APIs, storage, jobs, workers, hardware, and plugin host |
| `@vexa-video/angular` | Browser | Angular DI, uploads, render clients, Signals/RxJS state, preview helpers |
| `@vexa-video/ai` | Node.js (optional) | Provider-neutral transcription/tracking/highlight adapters plus deterministic AI-assisted planning helpers |

A browser-safe subpath, `@vexa-video/core/browser`, exposes serializable TypeScript contracts without exposing Node execution classes.

## Runtime boundary

```text
Browser / Angular                           Node render environment
      |                                              |
      v                                              v
@vexa-video/angular ---------------------> @vexa-video/sdk
      |                         HTTP/custom transport |
      |                                              v
      +-------- shared serializable contracts -> @vexa-video/core
                                                     |
                                                     v
                                           planning / validation
                                                     |
                                           @vexa-video/ffmpeg
                                                     |
                                          FFmpeg / ffprobe / I/O
```

`@vexa-video/angular` must not import `@vexa-video/sdk`, `node:*`, `child_process`, Redis clients, or FFmpeg wrappers at runtime.

## Core domain model

The core package owns serializable representations of media intent:

- normalized video operations;
- project/timeline ASTs;
- caption documents;
- audio and streaming options;
- hardware preferences/decisions;
- storage references;
- job descriptors and snapshots.

The domain model is intentionally independent of raw FFmpeg flags. This makes the same request suitable for local execution, remote workers, framework clients, diagnostics, and future alternate backends.

## Video execution path

```text
Video.load(source)
      |
      +--> probe() ------------------------------> ffprobe
      |
      +--> trim / resize / crop / rotate
                    |
                    v
          normalized VideoPipelineAst
                    |
                    v
          deterministic execution plan
             |                  |
       filter graph       codec/hardware plan
             |                  |
             +---------> FFmpeg arguments
                               |
                               v
                         spawn(ffmpeg)
```

Planning records source/output information, normalized operations, filters, codec decisions, expected duration, hardware selection, optimizer markers, and final argument arrays.

Untouched compatible streams can be copied instead of re-encoded.

## Timeline composition

`VideoProjectAst` contains canvas settings, ordered tracks, typed clips, and track state. Track order defines visual z-order.

```text
VideoProjectAst
      |
 normalize + validate
      |
      v
ProjectExecutionPlan
      |
      +---- visual stack: video / image / text / blend / transition
      |
      +---- audio stack: clip audio / standalone audio / fades / volume
      |
      v
single FFmpeg filter_complex where practical
```

Keyframes are clip-relative and support linear, hold, ease-in, ease-out, and ease-in-out interpolation. Advanced transitions have explicit eligibility rules; invalid layouts fail during planning instead of being silently approximated.

## Audio execution

Audio uses its own immutable pipeline so audio-first workflows do not need a video wrapper.

```text
Audio.load(source)
      |
 trim / normalize / fades / channels / ducking
      |
      v
AudioExecutionPlan
      |
 audio filter graph + codec/output decision
      |
      v
FFmpeg
```

Silence detection and waveform generation reuse the same binary-resolution, timeout, cancellation, and typed-error infrastructure.

## Captions

Caption parsing is separated from rendering:

```text
SRT / WebVTT / ASS
        |
        v
CaptionDocument
        |
 templates + per-cue styles + word timings
        |
        v
Video caption plan
        |
        v
FFmpeg drawtext/filter graph
```

Burn-in changes pixels, so video encoding is required; compatible audio may still be copied. Font files are resolved explicitly to avoid platform-specific Fontconfig assumptions.

## Adaptive streaming

```text
Streaming.load(source)
        |
        v
validated rendition ladder
        |
        v
StreamingExecutionPlan
        |
        +---- HLS  -> master + variants + MPEG-TS segments
        |
        +---- DASH -> MPD + init/media fMP4 segments
        |
        +---- preview sprite -> JPEG + WebVTT xywh map
```

GOP alignment is derived from frame rate and segment duration. Windows-specific normalization ensures HLS playlist URIs use portable forward slashes and DASH relative segment templates stay rooted in the requested output directory.

## Hardware acceleration

Hardware selection is a backend decision, not a raw encoder name in application code.

```text
logical codec + provider preference
             |
             v
FFmpeg capability discovery
             |
runtime verification encode
             |
             v
HardwareAccelerationDecision
   |       |       |       |
  CPU    NVENC    QSV   AMF / VideoToolbox
             |
             v
provider-specific encoder options
```

A provider is eligible for `auto` only after a real runtime probe succeeds. This avoids choosing an encoder merely because the FFmpeg binary was compiled with its name.

## Storage and remote media

Remote/object media is materialized before media execution. FFmpeg continues to operate on local paths.

```text
local path / HTTPS / object reference
             |
             v
        Storage.resolve()
             |
 policy validation + adapter/download
             |
             v
      managed local workspace
             |
             v
 Video / Audio / Streaming / Project
```

Built-in HTTP resolution uses a conservative SSRF-resistant policy by default: HTTPS only, public-network destinations, redirect revalidation, sensitive-header stripping across origins, byte limits, and managed cleanup.

Cloud adapters are application-owned so credentials, SDK versions, retries, and provider-specific policy remain outside the deterministic media core.

## Jobs and workers

Long-running work can be detached from request lifetimes.

```text
request / application
        |
        v
serializable JobDescriptor
        |
        +---- local -> JobQueue worker pool
        |
        +---- distributed -> DistributedJobQueue / transport
                                  |
                                  v
                         DistributedJobWorker
                                  |
                                  v
                         existing Vexa SDK APIs
```

Job states are explicit: queued, running, retrying, succeeded, failed, cancelled. Running cancellation propagates through `AbortSignal` into FFmpeg execution.

Idempotency keys deduplicate submission. They do not provide exactly-once semantics for arbitrary external side effects; retry-safe handlers should use deterministic output identities or an external idempotent write contract.

## Angular browser integration

The Angular package is an adapter to a render service, not a browser build of the Node SDK.

```text
Angular component/service
          |
          v
 @vexa-video/angular
    |              |
 Signals          RxJS
    |              |
    +------ VexaRenderService
                  |
                  v
           fetch/custom transport
                  |
                  v
          Node render service
                  |
                  v
            @vexa-video/sdk
```

Transport, media/upload behavior, and render providers can be replaced independently so applications can integrate authentication, storage, GraphQL/RPC, or custom job infrastructure without changing Angular-facing components.

## Process execution rules

Node execution follows these rules:

- use `spawn()` with explicit argument arrays;
- do not build media commands through shell interpolation;
- propagate `AbortSignal` cancellation;
- enforce timeouts where appropriate;
- capture structured stdout/stderr;
- parse FFmpeg progress into typed events;
- validate incompatible combinations before starting expensive work;
- surface failures through typed SDK errors.

## Security and trust boundaries

Important trust boundaries are explicit:

- remote media URLs are untrusted input;
- uploaded media is untrusted binary data;
- cloud credentials remain application-owned;
- job payloads crossing process boundaries must stay serializable;
- browser auth headers should be scoped to the render service;
- plugins must not be allowed to bypass planning/security rules silently;
- FFmpeg itself processes untrusted codecs/containers and should run with appropriate OS/container isolation in exposed services.

See [SECURITY.md](../SECURITY.md) for deployment and reporting guidance.

## Plugin execution path

Plugins extend the Node SDK through explicit, namespaced contributions. Installed packages are never scanned or activated automatically.

```text
Application configuration
          |
          v
    PluginRegistry
          |
      register/load
          |
          +---- serializable catalog ----> browser/framework tooling
          |
          +---- video operation ----------> normal VideoPipelineAst
          +---- storage adapter ----------> Storage
          +---- job handler --------------> JobQueue
          +---- render backend -----------> plugin-owned execution
          +---- encoder provider ---------> explicit encoder resolution
```

Custom video operations expand into existing backend-neutral `VideoOperation` objects. Storage/job contributions reuse the existing `Storage` and `JobQueue` contracts. Render backends and encoder providers remain explicit application choices rather than silently replacing the default FFmpeg planner.

Plugin metadata is separated from runtime implementation functions and can be exposed to browser/framework tooling safely through shared catalog contracts.

## Optional AI extension path

`@vexa-video/ai` sits above the deterministic media SDK and normalizes provider/model output before creating captions, projects, or execution requests.

```text
transcription / vision / tracking / highlight provider
                      |
                      v
              typed adapter contract
                      |
                      v
 transcript / scenes / subject regions / highlights
                      |
        +-------------+--------------+
        |             |              |
        v             v              v
 CaptionDocument  VideoProjectAst  analysis result
        |             |              |
        +-------------+--------------+
                      |
                      v
             existing Vexa SDK paths
```

No AI/model provider SDK is a dependency of core, FFmpeg, or the normal Node SDK. The AI extension owns only stable adapter contracts and deterministic conversion helpers. Applications own provider clients, authentication, models, quotas, and provider-specific policy.

The package also includes deterministic helpers where AI is unnecessary: FFmpeg scene-boundary detection and silence-removal planning reuse existing media execution rather than introducing a second render engine.

## Architectural invariants

Contributors should preserve these invariants unless a deliberate design change is documented:

1. public media intent stays backend-neutral;
2. browser code does not import Node execution packages;
3. plans remain inspectable and deterministic where practical;
4. platform-specific behavior is isolated and tested;
5. network/storage/process boundaries validate untrusted input;
6. new execution paths reuse existing cancellation/error/progress contracts instead of inventing incompatible ones.

## Ecosystem and distribution surfaces

Distribution surfaces sit around the deterministic media core rather than bypassing it.

```text
CLI / REST / Docker / React / Vue / Angular
                  |
                  v
          serializable requests
                  |
       +----------+-----------+
       |                      |
       v                      v
 @vexa-video/editor      HostedRenderer
(browser state only)    provider adapter
                              |
                              v
                    local/cloud execution
                              |
                              v
                       @vexa-video/sdk
                              |
                              v
                    planning + FFmpeg
```

`@vexa-video/cli` invokes the same `Video`, `Streaming`, and `Hardware` APIs used by applications. The REST template submits work through `JobQueue`, and the Docker recipe runs that template with Node 24 plus FFmpeg. None of these surfaces introduce an alternate media execution semantics.

`@vexa-video/editor` is browser-safe and framework-neutral. It owns timeline interaction state and immutable project edits only; it never imports FFmpeg, local storage, or Node process code.

`HostedRenderer` is deliberately provider-neutral. The adapter contract owns cloud vendor SDKs/authentication and exposes submit/get/cancel semantics to the SDK. This keeps hosted execution replaceable without putting a specific cloud provider into core packages.

Release packaging is explicit: workspace packages declare narrow exports/files, synchronized versions, package READMEs, canonical repository metadata, and public publish settings. The release workflow verifies the repository and performs dry-run packing before a protected, explicitly confirmed npm publication step.

## Ecosystem and distribution surfaces

Distribution surfaces sit around the deterministic media core rather than bypassing it.

```text
CLI / REST / Docker / React / Vue / Angular
                  |
                  v
          serializable requests
                  |
       +----------+-----------+
       |                      |
       v                      v
 @vexa-video/editor      HostedRenderer
(browser state only)    provider adapter
                              |
                              v
                    local/cloud execution
                              |
                              v
                       @vexa-video/sdk
                              |
                              v
                    planning + FFmpeg
```

`@vexa-video/cli` invokes the same `Video`, `Streaming`, and `Hardware` APIs used by applications. The REST template submits work through `JobQueue`, and the Docker recipe runs that template with Node 24 plus FFmpeg. None of these surfaces introduce alternate media execution semantics.

`@vexa-video/editor` is browser-safe and framework-neutral. It owns timeline interaction state and immutable project edits only; it never imports FFmpeg, local storage, or Node process code.

`HostedRenderer` is deliberately provider-neutral. The adapter contract owns cloud vendor SDKs/authentication and exposes submit/get/cancel semantics to the SDK. This keeps hosted execution replaceable without putting a specific cloud provider into core packages.

Release packaging is explicit: workspace packages declare narrow exports/files, synchronized versions, package READMEs, canonical repository metadata, and public publish settings. The release workflow verifies the repository and performs dry-run packing before a protected, explicitly confirmed npm publication step.

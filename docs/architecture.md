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
| `@vexa-video/bundler` | Node.js development/build | TypeScript/TSX composition bundling, deterministic discovery/manifests, CSS/assets, source maps, and environment filtering |
| `@vexa-video/renderer` | Node.js | Bundle-backed composition planning plus executable still, single-frame, frame-range, and video rendering through shared core/FFmpeg contracts |
| `@vexa-video/studio` | Browser | Local Studio session state coordinating composition selection, Player preview, Editor timeline state, props, resolved metadata, and reload preservation |

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

## Version 2 programmable composition layer

Version 2 adds a programmable authoring/runtime layer above the existing project and media model.

The first implementation slice lives in `@vexa-video/core`. It introduces `defineComposition()`, `defineStill()`, JSON-safe default/input props, runtime prop validation hooks, sync/async dynamic metadata calculation, deterministic static metadata serialization, and `ProgrammableCompositionRegistry`. The registry discovers definitions in stable ID order and rejects duplicate IDs before any render work begins.

The second slice adds a pure programmable-timing runtime in the same shared package. Frame context is explicit data rather than hidden global state: nested scopes derive local frames while preserving the root composition frame. The timing surface also owns frame/second conversion, frame ranges, numeric and color interpolation, easing, analytic spring motion, deterministic seeded random values, loop/freeze helpers, and series offsets.

The third slice adds the normalized programmable scene graph. Groups/layers establish parent-relative timing, transforms, opacity, and z-order; leaf intent covers fills, solids, text, image, video, audio, and serializable SVG/canvas surface registrations. Assets use static references or the existing Vexa storage-source contracts, with preload/readiness state and explicit policy gates. A deterministic flattening step produces stable scene render items, and the representable subset lowers into `VideoProjectAst`; unsupported crop/playback/surface/frame-render behavior fails with typed errors instead of leaking FFmpeg details or being silently approximated.

The fourth slice adds `@vexa-video/react` as a browser/shared authoring adapter. React components collect the same programmable-scene nodes used by non-React callers, while hooks derive frame/config/props from explicit shared runtime context. Sequence, series, loop, and freeze components delegate their timing math to `@vexa-video/core/browser`. A render-readiness controller tracks asynchronous authoring work without introducing player, bundler, SDK, or FFmpeg responsibilities into the React package. Visual leaves share backend-neutral shape, effect, and transition contracts. That same transition object now survives representable scene lowering into `VideoProjectAst`; easing-aware fade, slide, wipe, zoom, and circular iris transitions execute after effects/opacity without redefining project intent. Zoom scales the completed visual layer around its authored center, while iris applies a layer-centered radial alpha mask that opens to the farthest corner; transition-bearing text uses its isolated transparent canvas for both operations. Animated transform geometry with zoom remains fail-closed. Push is deliberately different: its paired-motion graph executes only when `VideoProjectAst` provides two eligible overlapping full-canvas video clips, because a single scene leaf cannot identify the visual state it should displace. Scene-leaf push remains typed fail-closed. Slide direction names the edge a visual enters from or exits toward; wipe direction names the edge a reveal opens from or closes toward; push direction names the edge the incoming video enters from while the previous video exits oppositely.

Typography stays inside the same browser-safe scene/project boundary rather than exposing FFmpeg-shaped authoring fields. Shared text styles carry stroke, shadow, horizontal alignment, line spacing, local `fontFile`, and provider-neutral `remoteFont` references as serializable intent. `remoteFont` carries only provider/family/weight/style identity and remains mutually exclusive with `fontFile`; browser/core packages do not fetch fonts. During bundle rendering, an explicitly supplied provider adapter materializes the remote reference to an absolute local path, after which the shared FFmpeg font-preparation boundary performs the same readability check used for local fonts. Missing/failed adapters and unresolved remote references fail closed before media planning. The normal SDK project path remains local-font-only unless a caller has already materialized its font.

Composition captions reuse the existing shared `CaptionDocument` rather than creating caption-shaped scene text nodes. A programmable scene may carry one normalized caption document; representable lowering preserves that document on `VideoProjectAst`, and cue endpoints participate in inferred project duration. Node font readiness resolves caption-local `fontFile` values or the controlled platform default. The FFmpeg project backend then chains the existing caption drawtext graph after the completed visual composition, which makes the same caption intent work for still/frame/range/video execution. Word timings are executable through a browser-safe `wordMode: "active-word"` contract: non-overlapping timed words render one at a time at the cue's normal position, with `activeWordColor` controlling the active glyph color. This avoids claiming inaccurate inline sentence highlighting when the drawtext path has no shared glyph-metric layout. Sentence mode remains the default. `CaptionCue.speaker` preserves diarization identity, while the normalized document-level `speakerStyles` map applies deterministic visual overrides after cue/template defaults. Speaker overrides cannot change `fontFile` or `wordMode`, so filesystem readiness and timing semantics remain owned by the existing cue contract. AI transcription segments already expose `speaker`, and automatic caption generation now carries that identity into the same browser-safe document model.

The fifth slice adds `@vexa-video/player` as a browser-safe, framework-neutral playback package. Its deterministic controller owns frame progression, seek/step/end/loop rules, volume/mute, rate, buffering, poster-frame state, resize math, errors, and typed events. A thin DOM host maps that state to requestAnimationFrame scheduling, ResizeObserver layout, fullscreen capability, and accessible native controls; React, Angular, and future adapters can bind the same controller rather than defining framework-specific playback semantics.

The sixth slice adds `@vexa-video/bundler` as explicit Node-side development/build tooling. It uses an exported `vexaCompositions` metadata contract to discover compositions in stable ID order, emits browser ESM from TypeScript/TSX, extracts CSS, fingerprints imported assets, copies public assets, preserves dynamic-import chunking/source maps, and writes a schema-versioned deterministic bundle manifest. Only allowlisted environment values are embedded. Bundling/discovery is not a security sandbox; hosted processing of untrusted source must isolate the Node build process.

The Studio browser runtime composes `@vexa-video/player` with `@vexa-video/editor` instead of owning another playback or timeline state machine. It keeps draft props distinct from the last resolved metadata, rebuilds preview timing when dynamic metadata changes, clamps/preserves the current frame deterministically, and uses transient editor synchronization for playback-driven playhead updates without adding undo entries. Node responsibilities such as bundle watching, metadata execution, rendering, filesystem access, and hot-reload transport remain behind the development-host boundary.

The integrated Playground Studio workspace is the first concrete development-host adapter for that boundary. The Node host serves only the generated composition bundle and browser-safe package outputs through restricted local routes; Studio evaluates executable composition props/metadata/scene intent in the browser, while actual media rendering remains a request to the existing `@vexa-video/renderer` route. Render input props are forwarded through the renderer's existing `inputProps` option instead of creating Studio-specific execution semantics.

The development host also owns source watching. It recursively watches only the Vexa composition fixture tree, normalizes Windows/POSIX change paths, debounces bursts, and broadcasts revisioned change notifications through a local Server-Sent Events endpoint. The browser Studio reacts by rebuilding through the existing bundler route and reloading the executable composition catalog through `VexaStudioSession.reloadCompositions()`. Filesystem APIs never enter the browser package, and a hot reload that arrives during an active build/render is queued rather than discarded.

The renderer consumes deterministic bundle manifests for composition selection and target/range planning. Built bundles can also expose `vexaExecutableCompositions`; the Node renderer loads that executable surface, resolves input props and dynamic metadata through `@vexa-video/core`, resolves programmable-scene storage assets through the existing `@vexa-video/sdk` `Storage` layer, lowers representable scenes into `VideoProjectAst`, materializes optional remote fonts through per-render provider adapters, prepares all resulting text fonts through the shared FFmpeg readiness resolver, and then uses the shared FFmpeg layer for real still/single-frame image output, bounded-concurrency frame-range materialization, and MP4/WebM encoding. Relative local `fontFile` values resolve from the persisted bundle directory; remote adapters must return absolute local paths; all font failures are mapped to `RENDER_FONT_UNAVAILABLE` before a frame/video process starts. One managed asset workspace is created per render only when unresolved storage assets are present; local/HTTP/object references are materialized there under the configured storage policy or adapters, then the workspace is removed after all active render workers settle on success or failure. Explicit `resolvedAssets` bypass acquisition for those asset IDs. Video subranges trim the final composed video graph by exact frame index and trim audio by the equivalent frame-derived seconds, preserving exclusive-end semantics without a second intermediate render. Video execution also delegates accelerator capability detection/selection to the shared hardware layer, feeds FFmpeg's progress protocol through the existing progress parser, and propagates the same process `AbortSignal` and timeout contracts; the renderer only maps those failures into its typed public boundary. Durable job orchestration remains on the shared job-contract path rather than being duplicated inside the synchronous renderer.

V2.10 extends that renderer-owned materialization boundary without changing the core scene schema. A serializable `surface` leaf still carries only `kind`, `rendererId`, and JSON data in core/browser code. Bundle rendering may opt into a matching Node `surfaceAdapter`. Static adapters return SVG text or PNG bytes; SVG uses the existing raster bridge, PNG containers are structurally validated, and APNG stays rejected so static results cannot hide animation semantics. Frame-aware adapters expose `renderFrame()` instead and receive deterministic local frame, absolute composition frame, and normalized progress for every authored surface frame. Vexa materializes each SVG/PNG frame inside the managed workspace, encodes the complete sequence through the configured FFmpeg binary into a lossless alpha-capable QTRLE MOV, substitutes the surface as a muted video node, and then reuses ordinary `VideoProjectAst` timing, effects, transitions, frame extraction, and final video encoding. The intermediary and frame sequence share the same cancellation, timeout, and workspace cleanup lifecycle as storage downloads, shapes, and primitives. Because adapter types live in `@vexa-video/renderer`, canvas/WebGL/headless-canvas/Lottie/Rive/Three integrations can depend outward on this boundary without making core or the normal SDK depend on those integrations.

`@vexa-video/gif` is the first concrete package on that outward-facing boundary. A composition references a logical GIF `sourceId` rather than a filesystem path. The Node host supplies the source-id/path map, the adapter validates the file with the existing FFprobe wrapper, and each deterministic local frame is decoded to an RGBA PNG through the existing FFmpeg process runner before returning to the generic surface pipeline. Adapter-owned extraction directories are private and short-lived; renderer-owned PNG sequences and MOV intermediaries keep their existing lifecycle. This keeps GIF file access and decoder policy out of browser/core contracts while avoiding a second animation engine.

`@vexa-video/waveform` is the second concrete package on the outward-facing surface boundary. A composition references a logical audio `sourceId` plus optional color/background intent rather than a filesystem path. The Node host supplies the source-id/path map, the adapter verifies that the source exposes audio with the existing FFprobe wrapper, and the existing waveform compiler renders one surface-sized PNG through FFmpeg. Adapter-owned raster directories are private and short-lived, while ordinary renderer timing/effects/transitions continue through the generic static surface path. This keeps audio file access and waveform execution out of browser/core contracts without adding a second media-processing stack.

`@vexa-video/core/browser` exposes serializable programmable-composition metadata plus pure composition definition/resolution, timing, and scene runtimes. Composition definition/registry authoring remains on the normal core surface. The browser entry must remain free of Node execution, FFmpeg, Redis, filesystem, and SDK runtime imports so future React/player packages can evaluate the same scene/timing semantics directly.

`@vexa-video/sound-effects` takes a different path because sound playback is already representable by the normalized scene graph. The browser-safe package maps reusable logical IDs to static or storage-backed audio asset sources and emits ordinary `ProgrammableSceneAsset`/`ProgrammableSceneAudioNode` values with deterministic asset IDs plus optional playback defaults. There is no sound-effect renderer, decoder, filesystem boundary, or second audio graph: scene normalization, storage resolution, project lowering, cancellation, and FFmpeg execution remain exactly where existing audio nodes already execute.

Together, the generic surface path plus GIF, waveform, and sound-effect packages complete the V2.10 architectural objective: optional programmable-media integrations can extend rendering or authoring without introducing a second project model or pulling optional execution dependencies into core packages. Future Lottie/Rive/Three/canvas integrations should reuse these boundaries instead of changing them.

V2.11 begins with `@vexa-video/web-renderer` as a separate browser-safe backend boundary. Its first slice owns codec capability probing and deterministic browser/backend planning: H.264, VP9, AV1, AAC, and Opus support is queried through injectable WebCodecs-compatible hooks, and unsupported requests return typed fallback reasons suitable for routing to the existing Node/hosted renderer.

The second slice adds video-only execution behind that same plan. A caller-provided frame source is converted into `VideoFrame` instances with deterministic composition-derived microsecond timing, fed into `VideoEncoder` with bounded queue flushes and periodic keyframes, copied into owned encoded-chunk bytes, and closed immediately after enqueue. Progress and `AbortSignal` cancellation remain browser-safe; cancellation resets the encoder before cleanup. The frame-source callback deliberately keeps Canvas/DOM capture policy outside the encoder and preserves the existing composition model. Raw encoded chunks are not treated as an MP4/WebM container; muxing, browser audio, Blob/File output, and concrete capture adapters remain separate follow-on responsibilities.

The third slice keeps muxing in the same browser package but below the encoder contract. Vexa's owned VP9/AV1 chunks are serialized directly into deterministic WebM EBML structures and exposed as byte data plus a `video/webm` Blob; optional File creation is a thin browser API wrapper. This path is deliberately dependency-free and accepts only keyframe-first monotonic packet streams.

The fourth slice extends that boundary to H.264 MP4 without guessing codec-private state. `EncodedVideoChunkMetadata.decoderConfig.description` is copied into Vexa-owned bytes when WebCodecs reports a new output configuration; AVC encoding is explicitly requested in `avc` format, where the description is the `AVCDecoderConfigurationRecord`. The MP4 backend consumes that record in an `avcC` sample entry and emits a fragmented `ftyp`/`moov` + `moof`/`mdat` file. This keeps MP4 validity tied to browser-provided decoder metadata and preserves typed failure when required metadata or monotonic sample timing is absent.

The fifth slice adds audio execution beside, rather than inside, the video encoder. A deterministic sample-window context tells the caller exactly which PCM frames to materialize as browser `AudioData`; Vexa feeds those values to `AudioEncoder`, closes them immediately after enqueue, copies encoded bytes and decoder metadata into owned values, and applies the same queue, progress, cancellation, and cleanup discipline as video. AAC is requested in raw `aac` format so `AudioDecoderConfig.description` carries `AudioSpecificConfig`; Opus is requested as raw `opus` packets. This encoded-audio result is the stable input for the next MP4/WebM audio-muxing slice and does not introduce a second composition/audio model.

The sixth slice joins the independently encoded streams only at the container boundary. The MP4 path adds an `mp4a` audio track with `esds`/AudioSpecificConfig metadata beside the existing `avc1` video track and emits both tracks through one fragmented `moof`/`mdat` sequence. The WebM path adds a second `A_OPUS` track with `OpusHead` codec-private metadata and interleaves timestamp-ordered audio/video SimpleBlocks. Muxing validates zero-origin monotonic timestamps plus bounded duration skew before producing a Blob, while the authoring and composition models remain unchanged.

The seventh slice adds capture below the composition boundary rather than a new renderer model. Canvas capture returns an existing Canvas/OffscreenCanvas after the caller paints the requested frame. DOM capture is intentionally limited to serializable element trees: it clones the tree, inlines computed styles, waits for browser fonts, serializes through SVG `foreignObject`, rasterizes with `createImageBitmap`, and draws into a reusable Canvas/OffscreenCanvas before the existing VideoFrame encoder sees it. Temporary bitmaps are always closed, dimensions remain fixed for an encoder run, and canvas/video/iframe descendants fail closed rather than producing misleading frames.

V2.11 closes by testing that these layers remain composable rather than merging them: Canvas capture feeds the existing video encoder contract, owned encoded chunks feed the existing muxer, and Blob/container output is produced without changing composition semantics. Native WebCodecs support remains capability-gated at runtime, so unsupported browsers select the typed backend-fallback plan instead of entering a partial execution path.

`@vexa-video/web-renderer` does not import the SDK, Node renderer, FFmpeg, filesystem, or process execution. Browser execution extends the backend boundary without changing composition semantics.

V2.12 begins inside the existing programmable-composition boundary rather than introducing a template runtime. Definitions may attach a normalized browser-safe object `inputSchema`; `defaultProps` remain the authoritative defaults and must satisfy that schema immediately, while merged invocation props are schema-validated before the existing custom `validateProps` hook. Static metadata carries the frozen schema so Studio, services, and future agent surfaces can inspect the same contract used at execution time. The schema vocabulary is deliberately dependency-free and JSON-serializable, keeping validation available from `@vexa-video/core/browser` without pulling a third-party validator into browser bundles.

The second V2.12 slice keeps templates as discovery descriptors, not executable alternatives. A `ProgrammableTemplate` wraps one existing programmable composition plus normalized presentation metadata; `ProgrammableTemplateCatalog` sorts and exposes JSON-safe catalog entries that reuse that composition's static metadata, defaults, and `inputSchema`. Selecting a template therefore resolves back to the same composition definition used by Studio/player/render paths, preventing catalog concerns from creating another timing, scene, or rendering model.

The third V2.12 slice keeps responsive variants inside that same boundary. Template variants are normalized JSON-safe prop presets with a declared aspect ratio. Resolving one calls the wrapped composition's existing prop/schema validation and dynamic metadata calculator, then verifies the resulting width/height against the declared ratio. This lets one authored composition cover 16:9, 9:16, and 1:1 while preserving the exact player/render execution contract.

The fourth V2.12 slice adds a transport-friendly invocation envelope rather than a service-specific runtime. `templateId`, optional `variantId`, and caller props normalize into frozen deterministic JSON; catalog resolution finds the same template descriptor, applies any variant preset first, overlays caller props, and then invokes the ordinary composition resolver. Schema/custom validation, dynamic metadata, and post-resolution aspect-ratio checks therefore remain authoritative for browser, Node, hosted, and future agent callers.

The intended boundary is:

```text
TypeScript / React / agent-authored composition
                    |
                    v
       browser-safe composition runtime
                    |
          normalized scene/frame intent
                    |
          +---------+----------+
          |                    |
          v                    v
 browser player/preview   Node composition renderer
          |                    |
          |                    v
          |            existing Vexa SDK/project
          |                    |
          +--------------------+
                    |
                    v
          planning / FFmpeg / storage
```

The composition runtime owns deterministic frame/time semantics, composition metadata, sequences, animation math, input props, and browser-safe scene intent. Timing utilities must remain pure: no `Date`, wall-clock state, `Math.random()`, DOM state, or Node process execution may affect a frame result.

Likely Version 2 runtime boundaries are:

| Surface | Runtime | Rule |
| --- | --- | --- |
| composition contracts/runtime | shared/browser-safe | No Node, FFmpeg, Redis, or filesystem execution imports |
| React authoring adapter | browser/shared | React maps authoring components into Vexa composition semantics |
| player | browser | Playback/preview only; no Node SDK runtime import |
| bundler | Node/development | Builds browser-executable composition bundles |
| renderer | Node | Reuses `@vexa-video/sdk`, storage, hardware, cancellation, progress, and FFmpeg execution |
| Studio UI | browser | Reuses player/editor state; Node work goes through a development host |
| web renderer | browser | Optional Canvas/WebCodecs backend with capability detection and typed fallback |

Whenever a composition can be represented by `VideoProjectAst`, it should lower into that existing model so timeline rendering, captions, storage, hardware selection, and execution planning retain one source of media semantics.

Browser-rendered or DOM/canvas compositions that cannot be lowered cleanly may use a dedicated frame-render backend, but final encoding/process behavior must still reuse shared codec/error/progress contracts where practical.

### Independent implementation requirement

Version 2 is a Vexa-native design. Its composition contracts, package boundaries, tests, fixtures, assets, examples, browser behavior, and rendering integration must be designed from Vexa product requirements and this repository's existing architecture. Third-party source code, private implementation details, tests, fixtures, undocumented internals, and API-compatibility targets must not define Vexa runtime behavior.

See `V2_MILESTONE.md` and `V2_MILESTONE_TESTING.md` for the implementation and acceptance sequence.

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

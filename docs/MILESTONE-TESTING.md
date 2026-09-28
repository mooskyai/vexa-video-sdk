# Milestone Testing Guide

Use this document as the acceptance checklist for Vexa Video SDK milestones. A milestone is only considered confirmed after its verification items pass on the supported development environment.

## Canonical milestone sequence

The milestone sequence below is the original Vexa Video SDK delivery plan and must remain stable unless the project intentionally revises the roadmap:

`0 → 1A → 1B → 1C → 2 → 3A → 3B → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13`

Do not replace these numbered milestones with capability-only sections or renumber completed work. New fixes, regressions, examples, and acceptance findings belong inside the milestone that owns that capability.

The current active acceptance area is **Milestone 10 — Angular integration**. Milestone 11 must not begin until Milestone 10's install, build, browser-demo, and end-to-end checks pass.

## Development baseline

- Node.js must be `24.21.0` or newer.
- FFmpeg and ffprobe must be available in `PATH`, unless custom binary paths are supplied.
- The repository TypeScript line is currently `5.9.x`.
- Angular demo/build packages must stay on a version compatible with TypeScript `5.9.x`; while this baseline is in place, pin the Angular runtime/compiler/build toolchain together to a compatible Angular `21.2.x` release rather than allowing Angular 22 build tooling to pull TypeScript 6 peer requirements.
- Do not use `--force` or `--legacy-peer-deps` to hide Angular peer-dependency conflicts; fix the package versions instead.
- Run `npm install` after dependency or package metadata changes.
- Run `npm run dev` during development. It watches TypeScript, runs tests after each successful compilation, reruns tests when `*.test.ts` files change, and starts/restarts the visual playground at `http://127.0.0.1:4173` after a successful compilation.
- Run `npm run verify` before committing. It runs typecheck, tests, and a production build.

## Milestone 0 — Repository foundation

Status: complete.

Achievements:

- npm workspace monorepo exists.
- TypeScript project references build the package graph.
- `@moosky-video/core`, `@moosky-video/ffmpeg`, and `@moosky-video/sdk` have clear package boundaries.
- GitHub Actions validates supported Node versions.
- contribution, security, architecture, and roadmap documentation exists.
- Node.js `24.21.0+` is the minimum supported runtime.

Verify:

- `node -v` reports `v24.21.0` or newer.
- `npm install` completes without dependency errors.
- `npm run dev` starts the TypeScript watcher, completes the initial build/test pass, and starts the visual playground without errors.
- change a TypeScript file and save it; TypeScript should recompile and then start a fresh test run.
- change a test file and save it; a fresh one-shot test run should start automatically.
- `npm run verify` completes successfully.
- GitHub CI passes on Node `24.21.0` and Node `26.x` after pushing to `main`.

## Milestone 1A — Media probing vertical slice

Status: complete.

Achievements:

- `Video.load()` creates the public media object.
- FFmpeg and ffprobe binary discovery is implemented.
- ffprobe runs through a safe `spawn()` argument array rather than a shell command string.
- ffprobe JSON is normalized into SDK-owned metadata types.
- video codec, dimensions, FPS, pixel format, bitrate, and rotation are normalized.
- audio codec, sample rate, channels, channel layout, and bitrate are normalized.
- process timeout and cancellation plumbing exists.
- typed SDK/process/probe errors exist.

Verify:

- choose a real video file such as `sample.mp4`.
- run `npm run example:probe -- ./sample.mp4`.
- confirm `durationSeconds` is present and sensible.
- confirm `video.width` and `video.height` match the source.
- confirm `video.codec` matches the source codec.
- confirm `video.fps` is sensible, including fractional rates such as `29.97`.
- if the source contains audio, confirm `audio.codec`, `sampleRate`, and `channels` are populated.
- run `npm run verify` and confirm the probe parser tests pass.

## Milestone 1B — Core editing operations

Status: implemented; confirm locally before treating it as accepted.

Achievements:

- editing operations are immutable; calling an edit method returns a new pipeline instead of mutating the source object.
- `trim()` is available.
- `resize()` supports `contain`, `cover`, and `fill` behavior.
- `crop()` supports explicit or centered positioning.
- `rotate()` supports common right-angle rotations and general rotation handling.
- compatible visual edits compile into one FFmpeg filter chain and one render process.
- `export()` supports common video/audio codec settings.
- H.264, H.265, AV1, VP9, and video stream copy options exist.
- AAC, Opus, MP3, audio copy, and no-audio options exist.
- CRF, encoder preset, pixel format, video bitrate, and audio bitrate settings exist.
- `thumbnail()` generates still images.
- `extractAudio()` creates audio-only output.
- FFmpeg progress output is parsed into structured progress data.
- percentage progress is calculated when duration is known.
- cancellation and timeout options propagate to rendering.
- invalid operations fail through typed validation errors.
- a real FFmpeg integration test uses a synthetic fixture.

Verify:

- run `npm run verify`; every unit and integration test must pass.
- export a pipeline using `trim()` and confirm the output duration matches the requested duration.
- add `resize()` and confirm the output dimensions match the requested dimensions or fit behavior.
- add `crop()` and confirm the output frame dimensions match the crop size.
- add `rotate({ degrees: 90 })` and visually confirm orientation and dimensions are correct.
- chain trim + resize + crop + rotate and confirm one final video is produced without intermediate files being required by the public API.
- export with H.264/AAC and confirm the result plays normally.
- call `thumbnail()` and confirm a valid image file is created at the requested timestamp.
- call `extractAudio()` and confirm the produced audio file plays and contains no video stream.
- attach `onProgress` during export and confirm progress events are emitted and finish at or near 100 percent.
- test an invalid size/duration/value and confirm the SDK rejects it before a successful render is reported.
- start a longer render with an `AbortController`, cancel it, and confirm the promise rejects with the SDK cancellation error.

## Milestone 1C — Browser visual playground

Status: implemented; confirm locally before starting Milestone 2.

Achievements:

- a local HTML/CSS/JavaScript interface exists for visual media acceptance.
- the browser uploads media to a local Node playground server instead of importing Node-only SDK code.
- the server binds to `127.0.0.1` and stores temporary media under `.tmp/visual-playground`.
- source video playback and normalized probe metadata are shown in the browser.
- trim, resize, crop, and rotate controls map to the public SDK pipeline.
- current export codec and encoder controls are exposed for manual compatibility checks.
- structured FFmpeg progress is streamed to the page as NDJSON.
- the page can cancel an active render.
- rendered output can be played immediately and its metadata compared with the source.
- thumbnail output can be generated and inspected visually.
- extracted audio can be played in the browser.
- the current operation payload and an acceptance log are visible for debugging.

Verify:

- run `npm run dev` and open `http://127.0.0.1:4173`.
- upload a real MP4 with audio and confirm source playback works.
- confirm duration, dimensions, FPS, video codec, and audio codec look correct.
- enable trim, render, and confirm the visible output starts/ends where expected.
- enable resize using `contain`; verify letterboxing/padding and exact output dimensions.
- test `cover`; verify the output fills the requested frame and crops overflow.
- test `fill`; verify the output exactly matches the requested dimensions even when aspect ratio changes.
- enable crop and visually confirm the expected region/frame size.
- rotate by 90, 180, and 270 degrees and inspect orientation.
- chain trim + resize + crop + rotate, render once, and play the result.
- watch the progress bar and confirm it finishes at 100 percent.
- start a longer render, press **Cancel render**, and confirm the UI reports cancellation and no successful output is reported.
- generate a thumbnail at a known timestamp and inspect the frame.
- extract AAC/MP3/Opus audio as supported by the local FFmpeg build and play it.
- test H.264/AAC MP4 as the primary compatibility baseline.
- optionally test H.265, AV1, VP9, Opus, and MP3 and record unsupported encoders as environment capability limitations rather than SDK failures.
- run `npm run verify`; all automated checks and the production build must still pass.

Only after these checks pass should Milestone 1C be marked confirmed and Milestone 2 begin.

### Editor-style acceptance checks

- Confirm the source appears in the left media library after upload.
- Confirm the central canvas plays the source and transport controls seek/play/pause correctly.
- Upload a codec/container the browser normally cannot play (for example an H.265 MP4 or MKV when available) and confirm a temporary H.264/AAC browser preview is created while probe metadata still describes the original source.
- Confirm trim changes are reflected by the timeline clip range.
- Render H.264/AAC MP4 and switch between Source and Rendered output.
- Render a codec the browser cannot decode directly and confirm the output still receives a browser-safe preview.
- Confirm thumbnail and extracted-audio assets appear in the media panel.
- Confirm the payload tab shows the exact operation request being sent to the local Node server.

## Milestone 2 — Pipeline graph and optimizer

Status: implemented; confirm locally before starting Milestone 3.

Achievements:

- `Video.pipeline` exposes a normalized, serializable `VideoPipelineAst`.
- `Video.fromPipeline(...)` restores a pipeline from the serialized model.
- no-op trim/rotation operations are removed during normalization.
- rotation angles and resize defaults are normalized deterministically.
- FFmpeg filter compilation is separated from the SDK class.
- `Video.planExport(...)` returns a deterministic `MediaExecutionPlan`.
- the plan contains normalized operations, output container, filters, codec decisions, FFmpeg args, expected duration, and optimizer decisions.
- untouched compatible H.264/AAC MP4 sources can automatically stream-copy both streams when exporting to MP4 with no encoder overrides.
- WebM exports that require encoding automatically choose VP9 + Opus.
- codec/container incompatibilities are rejected before FFmpeg execution.
- copy mode rejects encoder-only options such as CRF, pixel format, and bitrate.
- deterministic plan tests compare identical logical pipelines.
- a real FFmpeg integration test verifies stream-copy planning and output.
- the browser playground Payload tab can display the optimizer execution plan.

Verify:

- run `npm run verify`; all unit/integration tests and the production build must pass.
- open `http://127.0.0.1:4173`, upload an H.264/AAC MP4, leave all edit and encoder controls at Auto, open **Payload**, and press **Refresh plan**.
- confirm `video.mode` and `audio.mode` are `copy` and the optimizations include `VIDEO_STREAM_COPY` and `AUDIO_STREAM_COPY`.
- enable Resize, refresh the plan, and confirm `video.mode` becomes `encode`, a scale/pad or scale/crop filter graph appears, and `SINGLE_PASS_FILTER_GRAPH` is present.
- keep Resize enabled, switch the output container to WebM, refresh the plan, and confirm video selects `vp9` and audio selects `opus`.
- choose H.264 explicitly with WebM and confirm planning fails with `INCOMPATIBLE_OUTPUT` before rendering.
- choose video `Copy`, set a CRF or pixel format, and confirm planning fails before FFmpeg starts.
- create a pipeline with `rotate({ degrees: -90 })`, serialize `video.pipeline`, restore it with `Video.fromPipeline(...)`, and confirm the restored rotation is normalized to 270 degrees.
- render the untouched Auto/MP4 source and confirm output metadata still reports the original H.264/AAC codecs.
- render an edited video and visually confirm output correctness in the editor.

Only after these checks pass should Milestone 2 be marked confirmed and Milestone 3 begin.

## Milestone 3A — Timeline composition foundation

Status: implemented; confirm locally before starting advanced timeline behavior.

Achievements:

- `VideoProjectAst` is a serializable project/timeline contract.
- `VideoProject.create(...)`, `createProject(...)`, and `VideoProject.fromAst(...)` expose the Node SDK project API.
- projects have explicit width, height, FPS, background, and optional duration.
- projects contain ordered video, audio, image, and text tracks.
- clips have explicit timeline start/duration and media clips support `sourceStart`.
- video/image clips support static position, size, fit, rotation, and opacity.
- video/audio clips support volume.
- basic fade-in/fade-out transitions are compiled into the visual/audio graph.
- video-clip audio and standalone audio clips are mixed into one output graph.
- text clips render through FFmpeg drawtext.
- text planning resolves an explicit readable font file when a clip does not provide `style.fontFile`, avoiding reliance on fontconfig-only defaults.
- image clips render as overlays.
- project inputs are validated and source duration bounds are checked before rendering.
- numeric properties have a serializable keyframe schema and Milestone 3B evaluates supported keyframes over clip-relative time.
- `project.planRender(...)` exposes deterministic `ProjectExecutionPlan`.
- `project.render(...)` renders the timeline in one FFmpeg `filter_complex`.
- the visual playground has a Project timeline mode for multi-asset video + text acceptance.

Verify automated behavior:

- run `npm run verify`; all existing tests plus the project/timeline tests must pass.
- confirm the project integration test renders two sequential video clips with mixed audio and a text overlay.
- on Windows, confirm the text integration test does not emit `Fontconfig error` and FFmpeg does not exit with `0xC0000005`; Vexa should resolve a system font such as Segoe UI/Arial explicitly.
- confirm the resulting video has the requested canvas size, H.264/AAC output, expected duration, and progress reaches 100 percent.
- create a project AST, serialize it to JSON, restore it with `VideoProject.fromAst(...)`, and confirm the restored AST is equivalent.
- request a clip duration that exceeds the underlying source and confirm project planning rejects it before FFmpeg render success is reported.

Verify visually in the editor:

- run `npm run dev` and open `http://127.0.0.1:4173`.
- upload at least two H.264/AAC video assets.
- switch the timeline to **Project** mode.
- add both assets to the timeline and confirm they appear as separate V1 clip blocks.
- confirm clip-audio blocks appear on A1.
- add a text layer and confirm a T1 block appears.
- if the machine uses a non-standard FFmpeg/font setup, set `VEXA_VIDEO_FONT_FILE` to an absolute readable `.ttf`/`.ttc` font path and rerun the text render.
- select each timeline clip and adjust start/duration; confirm the block position/width changes.
- set clip width/height or position, opacity, volume, and fade values and apply them.
- set project canvas width/height/FPS/background.
- click **Plan project** and confirm `TIMELINE_SINGLE_PASS_COMPOSITION` is present.
- for projects with clip audio, confirm `AUDIO_MIX_GRAPH` appears.
- for projects with text, confirm `TEXT_IN_FILTER_GRAPH` appears.
- render the project and confirm live progress reaches 100 percent.
- play the rendered result and visually confirm clip order, text timing, transform behavior, fades, and audio continuity.
- cancel a longer project render and confirm cancellation is reported instead of completion.

Programmatic image/audio coverage:

- create an image track and render an image clip with position/size/opacity; confirm it appears in the output.
- create an audio track and render a standalone audio clip with timeline start and volume; confirm it is mixed into the output.

Only after these checks pass should Milestone 3A be marked confirmed. Milestone 3B adds the advanced checks below.

## Milestone 3B — Advanced timeline behavior

Status: implemented; confirm locally before starting Milestone 4.

Achievements:

- numeric keyframes are normalized, sorted, validated against clip duration, and evaluated with linear/hold/ease-in/ease-out/ease-in-out interpolation.
- the FFmpeg compiler emits frame-evaluated expressions for animated x/y position, width/height, rotation, visual opacity, text opacity/font size, and audio volume.
- contiguous overlapping full-canvas video clips can use true FFmpeg `xfade` transitions: crossfade, wipe-left, and wipe-right.
- full-canvas visual clips support multiply, screen, overlay, addition, difference, darken, and lighten blend modes.
- `VideoProject.updateTrack(...)` controls hidden/muted/locked track state.
- `VideoProject.moveTrack(...)` changes visual z-order deterministically.
- locked tracks reject clip mutation through the SDK.
- the playground accepts video, audio, and image uploads and adds them to the matching timeline track.
- project timeline blocks can be dragged horizontally and trimmed from left/right handles.
- editor motion presets generate real keyframes for pan, zoom, rotation, and animated volume.
- project plans expose advanced compiler markers such as `KEYFRAME_EXPRESSION_GRAPH`, `AUDIO_KEYFRAME_EXPRESSION_GRAPH`, `VIDEO_XFADE_GRAPH`, and `BLEND_MODE_GRAPH`.

Verify automated behavior:

- run `npm run verify`; the full suite should pass with no regressions.
- confirm keyframe normalization sorts keyframes deterministically and rejects keyframes beyond clip duration.
- confirm the project compiler test emits keyframe expressions for transform and volume animation.
- confirm the transition compiler test contains FFmpeg `xfade` for an overlapping full-canvas transition.
- confirm the blend-mode compiler test contains the selected FFmpeg blend mode.
- confirm SDK tests can hide/mute/lock/move tracks and that locked tracks reject clip mutation.
- on Windows, re-confirm the text integration test still passes without Fontconfig crashes.

Verify visually in the editor:

- upload at least two videos, one image, and one audio-only file.
- confirm all four assets appear in the media library and can be added to the appropriate project timeline.
- drag a video block horizontally; confirm its start time and inspector value update.
- trim from the left handle; for video/audio confirm timeline start, duration, and source trim move together.
- trim from the right handle and confirm duration changes.
- choose **Pan left → right**, **Zoom in**, **Rotate 0 → 90°**, or **Volume 25% → 100%**, apply the clip, plan the project, and confirm a keyframe optimization marker appears.
- overlap two full-canvas videos, select crossfade/wipe on the incoming clip, and confirm `VIDEO_XFADE_GRAPH` appears.
- render the transition and visually confirm it is a real transition rather than two independent cuts.
- put a full-canvas clip on a higher visual track/order, select a non-normal blend mode, and confirm `BLEND_MODE_GRAPH` appears and the output visibly changes.
- hide a visual track and confirm it disappears from the render.
- mute a video/audio track and confirm its audio is absent while visual content remains when appropriate.
- lock a track and confirm editor mutations are blocked until the track is unlocked.
- use **Track ↑ / Track ↓** and confirm visual stacking changes.
- render the final project and confirm live progress reaches 100 percent.

Current constraints to verify explicitly:

- advanced `xfade` transitions require a contiguous overlapping full-canvas video chain; incompatible transformed/gapped transition layouts fail clearly instead of being silently approximated.
- non-normal blend modes currently require full-canvas alignment and reject x/y-positioned clips.

## Milestone 4 — Audio engine

Status: implemented; confirm locally before starting Milestone 5.

Achievements:

- `Audio.load(...)` exposes an immutable audio-first SDK pipeline.
- `trim()`, `normalize()`, `fadeIn()`, `fadeOut()`, `channels()`, and `duckUnder()` are composable operations.
- `audio.planExport(...)` returns a deterministic `AudioExecutionPlan` with filter graph, inputs, args, expected duration, and optimization markers.
- `audio.export(...)` supports AAC, MP3, Opus, or explicit stream copy when no processing is requested.
- loudness normalization uses FFmpeg `loudnorm` with configurable target LUFS, true peak, and loudness range.
- channel mapping supports source, mono, and stereo output.
- sidechain ducking uses FFmpeg `sidechaincompress` and can mix the sidechain source into the final result.
- ducking pads compressor inputs and trims back to the expected duration so FFmpeg latency does not shorten the output.
- `audio.detectSilence(...)` returns normalized silence ranges.
- `audio.waveform(...)` creates a PNG waveform image.
- the visual playground Audio inspector can plan/process the selected audio-capable asset, select another uploaded asset as a sidechain, detect silence, and generate a waveform.

Verify automated behavior:

- run `npm run verify`; all previous tests plus the audio engine tests must pass.
- confirm the audio operation-normalization tests reject duplicate singleton operations and invalid values.
- confirm the audio execution-plan tests contain `loudnorm`, `afade`, channel mapping, `sidechaincompress`, and `amix` where expected.
- confirm silence parsing returns stable `{ start, end, duration }` ranges.
- confirm waveform planning emits a one-frame `showwavespic` image.
- confirm the real integration test exports mono AAC, reaches 100 percent progress, detects the synthetic silence interval, generates a 600×120 waveform, and renders a ducked AAC mix at the expected duration.

Verify visually in the editor:

- run `npm run dev` and open `http://127.0.0.1:4173`.
- upload one audio-only asset or a video containing audio and select it in the media library.
- open **Audio** and enable Normalize; leave the default target at -16 LUFS, then click **Plan audio** and confirm `LOUDNESS_NORMALIZATION` appears.
- set Fade in/Fade out and Mono or Stereo, plan again, and confirm the filter graph/args reflect the settings.
- click **Process audio**, play the generated audio asset, and confirm it sounds continuous and uses the expected channel layout.
- upload a second audio-capable asset, select it as **Ducking sidechain**, plan/process again, and confirm `SIDECHAIN_DUCKING` appears.
- click **Detect silence** and inspect the returned ranges in the Audio output panel.
- click **Waveform** and confirm a waveform image appears under Generated assets.
- test AAC as the baseline, then MP3 and Opus if supported by the local FFmpeg build.
- with no processing operations selected, test explicit `copy` only when the target container/codec combination is appropriate; processing + copy should fail clearly.

Only after these checks pass should Milestone 4 be marked confirmed.

## Milestone 5 — Captions and text

Status: implemented; confirm locally before starting Milestone 6.

Achievements:

- SRT, WebVTT, and ASS text can be parsed into a normalized `CaptionDocument`.
- caption documents serialize back to all three supported text formats.
- cues support serializable style metadata and optional word-level timing ranges.
- reusable subtitle/headline/minimal templates can be applied without FFmpeg.
- `Video.planCaptionBurn(...)` exposes the exact caption render plan.
- `Video.burnCaptions(...)` burns styles into the selected video while preserving the existing video operation pipeline.
- captions force video encode but leave compatible audio eligible for stream copy.
- explicit font files avoid Windows Fontconfig crashes.
- fade and pop animation primitives compile into cue-level drawtext alpha expressions.
- the editor Captions panel supports parse/plan/burn acceptance with progress, cancellation, and output playback.

Verify automated behavior:

- run `npm run verify`; the full suite must pass with no regressions.
- confirm SRT/WebVTT/ASS parser and serializer tests pass.
- confirm invalid cue/word timing is rejected before FFmpeg.
- confirm the caption compiler normalizes Windows font paths and emits explicit `fontfile`.
- confirm a caption execution plan encodes video and reports `CAPTION_DRAW_TEXT_GRAPH`.
- confirm styled caption integration renders a real H.264 output at the source dimensions/duration and progress reaches 100%.

Verify visually in the editor:

- run `npm run dev` and open `http://127.0.0.1:4173`.
- upload/select a normal H.264/AAC video.
- open **Captions**.
- paste the default SRT and click **Parse**; confirm normalized cues appear.
- switch format to WebVTT/ASS and test matching source text.
- select Subtitle, Headline, and Minimal templates.
- test bottom, center, and top positions.
- test none, fade, and pop animation.
- click **Parse & preview** and confirm the first active cue is visibly overlaid on the source video at the expected timestamp before rendering.
- confirm the caption status reports that live preview and the main Render action are enabled.
- click **Plan burn-in** and confirm `CAPTION_DRAW_TEXT_GRAPH`; animated captions should also show `ANIMATED_CAPTION_PRIMITIVES`.
- click the top **Render** button or **Render with captions**, confirm progress reaches 100%, then play the rendered output and verify cue timing/style visually.
- enable trim/resize/crop/rotate and confirm caption burn-in composes with those clip edits.
- click **Full** and confirm the video stage enters fullscreen and the live caption overlay remains visible.
- cancel a longer burn and confirm cancellation instead of success.

Only after these checks pass should Milestone 5 be marked confirmed.

## Milestone 6 — Streaming

Status: implemented; confirm locally before starting Milestone 7.

Achievements:

- `Streaming.load(...)` exposes an immutable delivery-packaging SDK.
- `streaming.planPackage(...)` returns a deterministic `StreamingExecutionPlan`.
- HLS produces a master playlist, per-rendition variant playlists, and aligned MPEG-TS segments.
- MPEG-DASH produces a static MPD, video/audio adaptation sets, and fragmented MP4 init/media segments.
- `mobile`, `balanced`, and `hd` built-in adaptive-bitrate presets are available.
- custom rendition ladders validate IDs, even dimensions, bitrates, optional FPS, and uniqueness.
- segment duration is validated between 1 and 30 seconds.
- packaging reports progress and supports timeout/cancellation.
- `streaming.previewSprite(...)` creates a tiled JPEG plus a WebVTT `#xywh` seek-preview map.
- the browser Streaming inspector can plan/package HLS or DASH, inspect generated artifacts, and generate preview sprites.

Verify automated behavior:

- run `npm run verify`; the complete suite should pass with no regressions.
- confirm preset tests return the expected mobile/balanced/HD rendition IDs.
- confirm HLS plan tests contain a master playlist, variant stream map, HLS segment filename pattern, and aligned GOP settings.
- confirm DASH plan tests contain MPD output, adaptation sets, and configured segment duration.
- confirm preview-sprite tests emit the expected tile grid and WebVTT `#xywh` coordinates.
- confirm the real integration test creates a two-rendition HLS package with `.ts` segments.
- confirm the same integration test creates a two-rendition DASH package with `.m4s` files and an MPD.
- confirm the integration test creates a non-empty sprite image and WebVTT file.

Verify visually in the editor:

- run `npm run dev` and open `http://127.0.0.1:4173`.
- upload/select a video asset and open **Streaming**.
- select HLS + Mobile + a 2-second segment duration and click **Plan package**.
- confirm the plan lists 240p and 360p renditions and includes `ADAPTIVE_RENDITION_LADDER`, `ALIGNED_GOP_SEGMENTS`, `HLS_MASTER_PLAYLIST`, and `HLS_VARIANT_PLAYLISTS`.
- click **Create package**, watch progress reach 100%, and confirm the manifest output contains two `#EXT-X-STREAM-INF` entries.
- confirm the generated file list includes `master.m3u8`, `v0/index.m3u8`, `v1/index.m3u8`, and `.ts` segment files.
- open the generated master-playlist link from Generated assets.
- switch to MPEG-DASH, click **Plan package**, and confirm `DASH_MPD_MANIFEST` and `DASH_ADAPTATION_SETS`.
- package DASH and confirm `manifest.mpd`, `init-*.m4s`, and `chunk-*.m4s` files are listed.
- on Windows, confirm HLS playlist references use `/` separators and DASH `init-*.m4s` / `chunk-*.m4s` files are created inside the chosen DASH package directory rather than the repository root.
- set preview sprite interval/width/columns and click **Generate sprite + VTT**.
- confirm the sprite image appears and the VTT output contains `sprite.jpg#xywh=` cues.
- start a longer package and click **Cancel**; confirm cancellation is reported rather than successful completion.

HLS and DASH keep H.264/AAC as the delivery codec profile, while Milestone 7 can now select CPU or a verified hardware H.264 encoder without changing the streaming contract.

## Milestone 7 — Hardware acceleration

Status: implemented; confirm locally before starting storage/remote-media work.

Achievements:

- the public API uses backend-neutral provider preferences: `cpu`, `auto`, `nvidia`, `intel`, `amd`, and `apple`.
- FFmpeg capability detection parses compiled encoders and hardware-acceleration methods.
- every compiled hardware provider is runtime-verified with a tiny real encode before it is eligible for `auto`.
- NVENC maps H.264/HEVC/AV1 to `h264_nvenc`, `hevc_nvenc`, and `av1_nvenc` when available.
- Quick Sync maps H.264/HEVC/AV1/VP9 to the matching QSV encoders.
- AMF maps H.264/HEVC/AV1 to the matching AMF encoders.
- VideoToolbox maps H.264/HEVC to the matching Apple encoders.
- normal exports, caption burn-in, timeline/project rendering, and adaptive HLS/DASH all share the same hardware-selection policy.
- execution plans expose the selected provider/encoder plus CPU-fallback state and hardware optimization markers.
- generic CRF/preset settings are translated to provider-appropriate FFmpeg options instead of leaking raw backend flags into the public API.
- `Hardware.detect()` exposes diagnostics and `Hardware.benchmark(...)` runs a short real-source encoding benchmark.
- the visual playground Hardware inspector exposes provider selection, runtime detection, and benchmark output.

Verify automated behavior:

- run `npm run verify`; the complete suite should pass with no regressions.
- confirm the hardware parser identifies NVENC/QSV encoders from representative FFmpeg output.
- confirm `auto` selects a runtime-verified provider and ignores a provider whose encoder is merely compiled but whose runtime probe fails.
- confirm an unavailable explicitly requested provider falls back to `libx264` by default.
- set `hardwareFallback: false` and confirm the same unavailable provider throws `HARDWARE_ACCELERATION_UNAVAILABLE` before the main render begins.
- confirm NVENC planning uses `h264_nvenc`, translates generic quality to `-cq`, and translates the generic preset to an NVENC `p1`–`p7` preset.
- confirm normal export, project composition, and adaptive-streaming planner tests all select NVENC when supplied with verified NVIDIA capabilities.
- confirm CPU-only real integration tests remain unchanged and all previous media features still pass.

Verify on a machine with hardware encoding:

- run `npm run dev` and open the Hardware inspector.
- click **Detect hardware** and verify the expected provider has `available: true` and `runtimeAvailable: true`.
- on an NVIDIA system with a working NVENC-capable GPU/driver, select **NVIDIA NVENC**, H.264, and refresh the normal export plan; confirm `plan.hardware.selected` is `nvidia`, the encoder is `h264_nvenc`, and `NVIDIA_VIDEO_ENCODE` is present.
- render a resized H.264 MP4 and verify the output plays and has the expected dimensions/duration/audio.
- repeat planning for a Project render and an HLS/DASH package and confirm they use the same provider.
- click **Benchmark source** and confirm a successful result reports the expected encoder, elapsed time, and a non-null realtime factor.
- select an unavailable provider with CPU fallback enabled and confirm planning reports `selected: cpu`, `fallback: true`, and `HARDWARE_CPU_FALLBACK`.
- disable CPU fallback for that unavailable provider and confirm planning fails clearly rather than silently choosing CPU.

On systems where FFmpeg lists NVENC/QSV but no usable device is present, `runtimeAvailable: false` is the correct result and `auto` should fall back safely to CPU.

## Milestone 8 — Storage and remote media

Status: implemented; confirm locally before starting worker/job-system work.

Achievements:

- `Storage` resolves local paths, HTTP(S) sources, and object-storage references into local media paths.
- public HTTP handling streams directly to disk and enforces byte, redirect, timeout, and cancellation limits.
- public HTTPS is the default; plain HTTP and private-network destinations require explicit opt-in.
- loopback/private/link-local/reserved DNS/IP destinations are rejected by default.
- URL credentials are rejected and sensitive headers are stripped across cross-origin redirects.
- `MediaWorkspace` creates isolated temporary directories, blocks path traversal, and cleans recursively.
- `withResolved(...)` guarantees cleanup after success or failure.
- S3/GCS/Azure/custom adapter hooks support application-owned cloud SDKs without adding cloud SDK dependencies to Vexa.
- object URIs parse through `s3://`, `gs://`/`gcs://`, and `az://`/`azure://` references.
- local/object uploads are supported through the same storage abstraction.
- the browser playground can import a public HTTPS asset and use it like an uploaded media session.

Verify automated behavior:

- run `npm run verify`; all previous media tests plus the storage tests must pass.
- confirm local, HTTPS, S3, GCS, and Azure references normalize deterministically.
- start a loopback HTTP test server and confirm the default remote-media policy rejects it.
- explicitly enable HTTP/private-network access for the trusted test server and confirm streamed download succeeds.
- confirm redirect handling works and the byte limit rejects an oversized response.
- confirm a managed workspace rejects `../` path escape and is removed after cleanup.
- confirm `withResolved(...)` removes the managed download after its callback completes.
- confirm an S3 adapter receives the expected bucket/key for download and upload delegation.
- resolve an HTTP-served synthetic MP4 and pass the resulting path into `Video.load(...).probe()`; verify H.264/AAC metadata.

Verify visually in the editor:

- run `npm run dev` and open `http://127.0.0.1:4173`.
- paste a public HTTPS media URL into **Remote media** and click **Import**.
- confirm the asset appears in the media library with normal metadata and playback behavior.
- import a source whose codec needs browser normalization and confirm a temporary H.264/AAC preview is generated.
- try `http://...` and confirm the playground rejects it.
- try a loopback/private-network HTTPS target and confirm the import is rejected rather than reaching that service.
- use the imported asset with normal render, captions, audio, streaming, and hardware-plan actions to confirm the resolved local path is transparent to downstream SDK features.

## Milestone 9 — Worker and job system

Status: implemented; confirm locally before starting Angular integration.

Achievements:

- job contracts are plain serializable descriptors/snapshots with explicit state, attempts, progress, retry policy, result, failure, and cancellation metadata.
- `JobQueue` runs registered handlers through a bounded local worker pool.
- local jobs transition through queued/running/retrying/succeeded/failed/cancelled states and expose progress events.
- retry backoff is deterministic and capped; retries are opt-in through `maxAttempts > 1`.
- idempotency keys reuse the same job for identical work and reject conflicting type/payload reuse.
- queued jobs cancel without execution; running jobs receive an aborted signal.
- `DistributedJobQueue` and `DistributedJobWorker` reuse the same job schema.
- `RedisJobTransport` stores ready, processing, delayed-retry, job-record, cancellation, and idempotency data without depending on a specific Redis npm client.
- Redis idempotent submission is atomic through a Lua transaction.
- the browser playground can queue a normal clip render as a background job and poll/cancel it independently of the original request.

Verify automated behavior:

- run `npm run verify`; the complete suite should pass with no regressions.
- confirm default retry policy is deterministic and exponential backoff is capped.
- submit a local job, report progress, and confirm it reaches `succeeded` with result/progress metadata.
- submit identical work twice with the same idempotency key and confirm only one handler execution occurs and both handles reference the same job ID.
- reuse that idempotency key with a different payload and confirm `JOB_IDEMPOTENCY_CONFLICT`.
- configure a job to fail once then succeed with `maxAttempts: 3`; confirm attempt count is 2.
- cancel a running local job and confirm its handler sees `AbortSignal` and the terminal state is `cancelled`.
- queue three jobs with local concurrency 2 and confirm no more than two handlers run at once.
- run a `DistributedJobQueue` and `DistributedJobWorker` against a test transport and confirm result/progress/worker metadata survive serialization.
- verify `RedisJobTransport` persists idempotent submissions and can cancel queued work.

Verify visually in the editor:

- run `npm run dev`, upload/select a video, and open **Jobs**.
- optionally enter an idempotency key and set Max attempts to 1–5.
- click **Queue current render** and confirm the job moves from queued → running → succeeded.
- confirm progress in the job JSON and the main timeline progress indicator updates while the job runs.
- confirm a successful job automatically becomes the latest rendered output and can be played.
- queue a longer job and click **Cancel job**; confirm it finishes as `cancelled` rather than `succeeded`.
- submit the same render twice using the same idempotency key and unchanged settings; confirm the same job ID is returned rather than creating a second render.
- change the render payload while keeping that idempotency key and confirm the server rejects it as a conflict.
- set Max attempts above 1 and exercise a transient FFmpeg failure when practical; confirm retry attempts are visible without creating differently named output files.
- click **Refresh jobs** and confirm recent job snapshots remain inspectable in the local server process.

Retry safety note: idempotency keys deduplicate submissions, but handlers that perform external writes must still make those side effects idempotent. The playground demonstrates this by deriving the output filename from the immutable job ID so a retry overwrites the same target rather than creating duplicates.

## Milestone 10 — Angular integration

Status: implemented; local acceptance is in progress. Do not start Milestone 11 until the runnable Angular demo installs and bundles cleanly and the browser-to-render-service flow passes.

Achievements:

- `@moosky-video/angular` builds as a separate browser-facing workspace package.
- the package has no runtime import from `@moosky-video/sdk`, `node:*`, or `child_process`.
- `provideVexaVideo(...)` configures base URL, endpoint paths, polling, credentials, per-request headers, and custom fetch.
- media, render, and preview services are injectable through Angular providers.
- `VexaJobRef` exposes Angular Signals; `VexaRenderService.watch(...)` exposes RxJS polling.
- upload/render contracts use plain serializable DTOs and browser-safe shared core types.
- custom transport/media/render providers can replace default behavior.
- `@moosky-video/core/browser` provides browser-safe shared contracts without bringing Node execution code into the Angular package.
- `examples/angular-client` demonstrates standalone Angular provider/service usage.
- `examples/angular-render-service` implements compatible upload/job/output endpoints using the Node SDK.
- the render-service root route provides a developer-facing status page.
- `GET /health` provides a JSON health check.
- the render service has been started successfully on `http://127.0.0.1:4180`, and the health response has been confirmed locally.
- the runnable Angular demo is part of this milestone's acceptance scope; it must start the browser UI separately from the Node render API.

Current validation notes:

- **Passed:** `npm run example:angular-service` starts the Node render API.
- **Passed:** `GET http://127.0.0.1:4180/health` returns `status: "ok"` for `vexa-angular-render-service`.
- **Pending fix:** dependency ranges must not allow `@angular/build@22.x` to resolve while the repository remains on TypeScript `5.9.x`; pin the Angular runtime/compiler/build packages together to a compatible `21.2.x` line.
- **Pending fix:** the browser entry point must not use top-level `await`; use `bootstrapApplication(...).catch(...)` so Angular's configured browser target matrix can bundle the app.
- **Pending verification:** after those two fixes, the Angular UI must load on `http://127.0.0.1:4200` and complete upload → render job → progress → output playback.
- **Sequence rule:** Milestone 11 remains planned until every Milestone 10 acceptance item below passes.

Verify dependency/toolchain behavior:

- run `npm install` without `--force` and without `--legacy-peer-deps`.
- confirm npm resolves a single compatible Angular runtime/compiler/build toolchain for the repository TypeScript `5.9.x` baseline.
- if npm tries to install Angular build tooling that requires TypeScript 6, pin Angular packages together to the compatible `21.2.x` line and rerun `npm install`.
- confirm `npm install` completes with no `ERESOLVE` peer-dependency failure.

Verify automated behavior:

- run `npm run verify`; all existing tests plus Angular config/browser-safety tests must pass.
- confirm `packages/angular/dist` contains no `node:` or `@moosky-video/sdk` runtime imports.
- confirm config normalization rejects invalid base URLs, polling intervals, and endpoint paths.
- confirm `@moosky-video/core/browser` emits an empty runtime module while exposing browser-facing declaration types.
- compile `examples/angular-client` and `examples/angular-render-service` through the root TypeScript project graph.
- confirm the Angular browser entry point uses a promise/catch bootstrap rather than top-level `await`.

Verify the Node render service:

- start `npm run example:angular-service`.
- confirm it listens on `http://127.0.0.1:4180`.
- open `http://127.0.0.1:4180/` and confirm the Vexa Angular Render Service status page is visible.
- open `http://127.0.0.1:4180/health` and confirm a response equivalent to:

```json
{
  "status": "ok",
  "service": "vexa-angular-render-service",
  "version": 1
}
```

- upload a small H.264/AAC video to `POST /v1/media` using the raw-file contract and confirm media metadata/URL are returned.
- submit `video.render` to `POST /v1/jobs`, poll `GET /v1/jobs/:id`, and confirm queued → running → succeeded with progress.
- open the returned output URL and confirm the rendered media is served.
- submit a longer render and call `DELETE /v1/jobs/:id`; confirm cancellation reaches the underlying `JobQueue`.

Verify the runnable Angular demo:

- start the complete demo command once the dependency/bootstrap fixes are applied.
- confirm the terminal reports both endpoints:

```text
Angular UI    http://127.0.0.1:4200
Render API    http://127.0.0.1:4180
```

- confirm Angular application bundle generation succeeds with no top-level-await target error.
- open `http://127.0.0.1:4200`.
- confirm the page can reach `/health` on the render API and visibly reports the backend as available.
- upload a real H.264/AAC video from the Angular UI.
- confirm the uploaded source can be previewed.
- submit a video render from the Angular UI.
- confirm `VexaJobRef.state()` / `progress()` update through queued/running/succeeded.
- confirm progress reaches 100 percent for a successful render.
- confirm the rendered output URL is loaded and the result plays in the Angular UI.
- submit a longer render and cancel it from the UI; confirm the terminal state is `cancelled`.
- unsubscribe from `renders.watch(...)` and confirm polling stops.
- replace the default transport with `withVexaTransport(...)` in a focused test and confirm the public Angular service API remains unchanged.

Milestone 10 is confirmed only after `npm install`, `npm run verify`, the render-service checks, and the runnable Angular browser flow all pass without forced dependency resolution.

Only after Milestone 10 is confirmed should Milestone 11 be considered formally accepted. Implementation work for later optional layers may exist ahead of that acceptance gate, but it does not change the canonical sequence or mark Milestone 10 complete.

## Milestone 11 — Plugin system

Status: implemented in `main`; formal acceptance remains gated by Milestone 10.

Achievements:

- schema-versioned plugin metadata, dependency, capability, catalog, package-manifest, and encoder-selection contracts.
- explicit `PluginRegistry` lifecycle with `setup`, `start`, `stop`, and `dispose` hooks.
- namespaced custom video operations that expand into normal backend-neutral `VideoOperation` values.
- plugin storage adapters that reuse `Storage`.
- plugin job handlers that reuse `JobQueue`.
- explicit custom render-backend execution with progress/cancellation context.
- explicit encoder-provider resolution without silently replacing the default FFmpeg planner.
- conventional `vexaPlugin`/default package loading plus optional metadata/manifest verification.
- browser/framework-safe metadata/catalog types without importing Node plugin implementations.

Verify after Milestone 10 is accepted:

- run the plugin lifecycle/catalog tests and confirm deterministic registration/shutdown order.
- confirm undeclared capabilities and missing dependencies fail during registration.
- render a custom video operation and verify it still passes through the normal FFmpeg backend.
- install plugin storage/job contributions into existing `Storage` and `JobQueue` instances.
- execute a custom render backend and encoder provider explicitly and inspect progress/selection results.
- dynamically load a package exposing `vexaPlugin` and verify id/version manifest checks.

## Milestone 12 — AI extension package

Status: implemented and optional; formal sequence still depends on Milestone 10/11 acceptance.

Achievements:

- separate `@moosky-video/ai` workspace package with no mandatory AI/model provider dependency in core, FFmpeg, or the normal SDK.
- provider-neutral transcription adapter with normalized segment/word timing and confidence validation.
- automatic `CaptionDocument` generation using existing caption templates/styles.
- built-in deterministic FFmpeg scene-boundary detector plus replaceable scene adapter contract.
- silence-removal planning that reuses the existing audio silence detector and generates a serializable compacted `VideoProjectAst`.
- silence-removal rendering through the existing project renderer.
- subject-tracking adapter contract using normalized `0..1` regions.
- smart-reframe helper that turns tracking samples into animated project position/scale keyframes.
- highlight-extraction adapter contract with validated scored time ranges.
- highlight-project helper that converts selected highlights into a normal `VideoProjectAst`.

Verify automated behavior:

- confirm transcription output with valid word timings becomes a styled caption document and invalid word timing is rejected.
- confirm silence-removal range planning creates deterministic retained ranges and timeline positions.
- run the real silence-removal integration test and confirm the rendered output is shorter while retaining video/audio.
- confirm the FFmpeg scene metadata parser extracts timestamp/score pairs.
- run the real scene integration test against a synthetic hard-cut video and confirm scene boundaries are detected near the cut times.
- run the smart-reframe integration test and confirm the generated project contains animated x/y/width/height keyframes.
- run the highlight-project integration test and confirm scored highlights become deterministic timeline clips.
- confirm `@moosky-video/ai` has only internal Vexa dependencies and does not add a provider SDK to the root dependency graph.

Verify with an application-owned provider when available:

- configure a transcription adapter and generate captions from a real spoken video.
- burn the generated captions using the existing caption renderer.
- configure a subject-tracking adapter and inspect the vertical smart-reframe project before rendering.
- configure a highlight adapter and inspect/edit the generated highlight project before rendering.

## Milestone 13 — Ecosystem and distribution

Status: implemented; public-registry publication and clean-install tarball acceptance remain release-operator validation. Earlier Angular acceptance gates remain unchanged.

Achievements:

- `@moosky-video/cli` provides probe, plan, render, hardware-inspection, and HLS/DASH package commands without a command-framework dependency.
- `examples/rest-service` exposes health, raw media upload, background render jobs, cancellation, and rendered output serving through the existing `JobQueue`/`Video` APIs.
- `deploy/docker-worker` provides a Node 24 + FFmpeg container recipe and Compose example with configurable worker concurrency and persistent workspace storage.
- React and Vue source examples demonstrate upload → background job → polling → output playback without adding framework dependencies to the monorepo runtime.
- `@moosky-video/editor` provides browser-safe timeline selection/playhead/viewport state, snapping, immutable clip move/trim commands, and undo/redo history.
- `HostedRenderer` plus `HostedRenderAdapter` define a provider-neutral submit/get/cancel/wait contract for hosted/cloud execution.
- release packages contain public metadata, files/exports, package READMEs, canonical repository URLs, MIT license metadata, and public publish configuration.
- release scripts validate synchronized versions/metadata, dry-run npm package contents, and guard actual publish behind explicit confirmation.
- `.github/workflows/release.yml` performs verify → release metadata check → dry-run pack → optional provenance publish in a protected environment.
- `docs/API-STABILITY.md` defines public API scope, Semantic Versioning, deprecation, serialized-schema, and browser/runtime-boundary rules.
- `docs/ecosystem-distribution.md` and `docs/hosted-rendering.md` document deployment/integration surfaces.

Verify automated behavior:

- run `npm run verify` and confirm all existing media/plugin/AI tests plus CLI/editor/hosted-render tests pass.
- run `npm run release:check`; confirm every intended release package has the synchronized root version, canonical repository metadata, public publish config, explicit exports, and `dist` files.
- run `npm run release:pack`; inspect each `npm pack --dry-run` output and confirm no source/test/temp artifacts leak into package tarballs.
- run `npm run cli -- --help`; confirm the CLI lists probe/plan/render/hardware/stream commands.
- test `probe` and `plan` against a real local video, then render a short resized H.264/AAC output.
- run the editor tests and confirm snapping/move behavior is immutable, undo/redo is deterministic, and locked tracks reject mutation.
- run hosted-render tests with a fake adapter and confirm submit/poll/cancel behavior reaches terminal state.

Verify service/deployment examples:

- run `npm run example:rest-service`; open `http://127.0.0.1:4190/health` and confirm `vexa-rest-service` reports healthy.
- upload a small H.264/AAC source to `/v1/media`, submit `video.render`, poll the job to success, and play the returned output URL.
- build `deploy/docker-worker/Dockerfile`; confirm the image healthcheck passes and the same render flow works with the workspace mounted at `/var/lib/vexa`.
- copy the React example into a React application and the Vue example into a Vue application; point both at the REST service and confirm upload/render/playback.

Verify release controls:

- confirm normal CI never runs `npm publish`.
- confirm `npm run release:publish` refuses to publish unless `VEXA_RELEASE_CONFIRM=PUBLISH` is explicitly set.
- configure the protected `npm-release` GitHub environment/trusted publisher before the first real registry release.
- perform a release-workflow dry run with `publish=false`.
- before the first public release, install the packed tarballs into a clean external fixture and rerun representative Node/browser integration checks.

import {
  frameToSeconds,
  secondsToFrame
} from "@vexa-video/core/browser";
import type {
  FrameRoundingMode,
  ResolvedProgrammableCompositionMetadata,
  VideoProgrammableCompositionMetadata
} from "@vexa-video/core/browser";

export type VexaPlayerControlsMode = "default" | "custom" | "none";
export type VexaPlayerFitMode = "contain" | "cover" | "actual";
export type VexaPlayerStatus = "idle" | "playing" | "paused" | "ended" | "error";

export type VexaPlayerErrorCode =
  | "INVALID_PLAYER_CONFIG"
  | "INVALID_PLAYER_OPERATION"
  | "FULLSCREEN_UNAVAILABLE"
  | "PLAYER_DISPOSED";

export class VexaPlayerError extends Error {
  readonly code: VexaPlayerErrorCode;

  constructor(message: string, code: VexaPlayerErrorCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export interface VexaPlayerConfig {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly initialFrame?: number;
  readonly autoplay?: boolean;
  readonly loop?: boolean;
  readonly volume?: number;
  readonly muted?: boolean;
  readonly playbackRate?: number;
  readonly posterFrame?: number;
  readonly fit?: VexaPlayerFitMode;
  readonly controls?: VexaPlayerControlsMode;
  readonly ariaLabel?: string;
}

export interface VexaPlayerNormalizedConfig {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly initialFrame: number;
  readonly autoplay: boolean;
  readonly loop: boolean;
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
  readonly posterFrame?: number;
  readonly fit: VexaPlayerFitMode;
  readonly controls: VexaPlayerControlsMode;
  readonly ariaLabel: string;
}

export interface VexaPlayerViewportState {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
}

export interface VexaPlayerSnapshot {
  readonly status: VexaPlayerStatus;
  readonly frame: number;
  readonly presentedFrame: number;
  readonly seconds: number;
  readonly playing: boolean;
  readonly ended: boolean;
  readonly buffering: boolean;
  readonly hasStarted: boolean;
  readonly loop: boolean;
  readonly volume: number;
  readonly muted: boolean;
  readonly effectiveVolume: number;
  readonly playbackRate: number;
  readonly fullscreen: boolean;
  readonly viewport: VexaPlayerViewportState;
  readonly error?: string;
}

export interface VexaPlayerEventBase {
  readonly snapshot: VexaPlayerSnapshot;
}

export interface VexaPlayerPlayEvent extends VexaPlayerEventBase {
  readonly type: "play";
}

export interface VexaPlayerPauseEvent extends VexaPlayerEventBase {
  readonly type: "pause";
}

export interface VexaPlayerFrameEvent extends VexaPlayerEventBase {
  readonly type: "frame";
  readonly previousFrame: number;
  readonly frame: number;
}

export interface VexaPlayerSeekEvent extends VexaPlayerEventBase {
  readonly type: "seek";
  readonly previousFrame: number;
  readonly frame: number;
}

export interface VexaPlayerEndedEvent extends VexaPlayerEventBase {
  readonly type: "ended";
}

export interface VexaPlayerLoopEvent extends VexaPlayerEventBase {
  readonly type: "loop";
  readonly wraps: number;
}

export interface VexaPlayerVolumeChangeEvent extends VexaPlayerEventBase {
  readonly type: "volumechange";
}

export interface VexaPlayerRateChangeEvent extends VexaPlayerEventBase {
  readonly type: "ratechange";
}

export interface VexaPlayerBufferingChangeEvent extends VexaPlayerEventBase {
  readonly type: "bufferingchange";
}

export interface VexaPlayerResizeEvent extends VexaPlayerEventBase {
  readonly type: "resize";
}

export interface VexaPlayerFullscreenChangeEvent extends VexaPlayerEventBase {
  readonly type: "fullscreenchange";
}

export interface VexaPlayerErrorEvent extends VexaPlayerEventBase {
  readonly type: "error";
  readonly error: string;
}

export interface VexaPlayerStateChangeEvent extends VexaPlayerEventBase {
  readonly type: "statechange";
}

export interface VexaPlayerDisposeEvent extends VexaPlayerEventBase {
  readonly type: "dispose";
}

export type VexaPlayerEvent =
  | VexaPlayerPlayEvent
  | VexaPlayerPauseEvent
  | VexaPlayerFrameEvent
  | VexaPlayerSeekEvent
  | VexaPlayerEndedEvent
  | VexaPlayerLoopEvent
  | VexaPlayerVolumeChangeEvent
  | VexaPlayerRateChangeEvent
  | VexaPlayerBufferingChangeEvent
  | VexaPlayerResizeEvent
  | VexaPlayerFullscreenChangeEvent
  | VexaPlayerErrorEvent
  | VexaPlayerStateChangeEvent
  | VexaPlayerDisposeEvent;

export type VexaPlayerEventListener = (event: VexaPlayerEvent) => void;
type VexaPlayerEventWithoutSnapshot = VexaPlayerEvent extends infer Event
  ? Event extends VexaPlayerEvent
    ? Omit<Event, "snapshot">
    : never
  : never;

export interface VexaPlayerControlDescriptor {
  readonly id: "play" | "seek" | "mute" | "fullscreen";
  readonly element: "button" | "range";
  readonly ariaLabel: string;
  readonly keyboardReachable: true;
}

export const VEXA_DEFAULT_PLAYER_CONTROLS: readonly VexaPlayerControlDescriptor[] = Object.freeze([
  Object.freeze({ id: "play", element: "button", ariaLabel: "Play", keyboardReachable: true as const }),
  Object.freeze({ id: "seek", element: "range", ariaLabel: "Seek", keyboardReachable: true as const }),
  Object.freeze({ id: "mute", element: "button", ariaLabel: "Mute", keyboardReachable: true as const }),
  Object.freeze({ id: "fullscreen", element: "button", ariaLabel: "Enter fullscreen", keyboardReachable: true as const })
]);

interface MutablePlayerState {
  status: VexaPlayerStatus;
  frame: number;
  playing: boolean;
  ended: boolean;
  buffering: boolean;
  hasStarted: boolean;
  loop: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  fullscreen: boolean;
  viewport: VexaPlayerViewportState;
  error?: string;
}

function fail(message: string, code: VexaPlayerErrorCode = "INVALID_PLAYER_OPERATION"): never {
  throw new VexaPlayerError(message, code);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer.`, "INVALID_PLAYER_CONFIG");
  }
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a finite number greater than 0.`, "INVALID_PLAYER_CONFIG");
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be a finite number >= 0.`);
}

function assertFrame(frame: number, durationInFrames: number, label: string): void {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= durationInFrames) {
    fail(`${label} must be an integer between 0 and ${durationInFrames - 1}.`, "INVALID_PLAYER_CONFIG");
  }
}

function normalizeVolume(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${label} must be between 0 and 1.`);
  }
  return value;
}

function normalizeControls(value: VexaPlayerControlsMode | undefined): VexaPlayerControlsMode {
  const normalized = value ?? "default";
  if (normalized !== "default" && normalized !== "custom" && normalized !== "none") {
    fail(`controls must be default, custom, or none.`, "INVALID_PLAYER_CONFIG");
  }
  return normalized;
}

function normalizeFit(value: VexaPlayerFitMode | undefined): VexaPlayerFitMode {
  const normalized = value ?? "contain";
  if (normalized !== "contain" && normalized !== "cover" && normalized !== "actual") {
    fail(`fit must be contain, cover, or actual.`, "INVALID_PLAYER_CONFIG");
  }
  return normalized;
}

function normalizeAriaLabel(value: string | undefined): string {
  const label = value ?? "Vexa video player";
  if (!label.trim()) fail("ariaLabel cannot be empty.", "INVALID_PLAYER_CONFIG");
  return label;
}

export function normalizeVexaPlayerConfig(config: VexaPlayerConfig): VexaPlayerNormalizedConfig {
  assertPositiveInteger(config.width, "width");
  assertPositiveInteger(config.height, "height");
  assertPositiveFinite(config.fps, "fps");
  assertPositiveInteger(config.durationInFrames, "durationInFrames");

  const initialFrame = config.initialFrame ?? 0;
  assertFrame(initialFrame, config.durationInFrames, "initialFrame");
  const posterFrame = config.posterFrame;
  if (posterFrame !== undefined) assertFrame(posterFrame, config.durationInFrames, "posterFrame");
  const playbackRate = config.playbackRate ?? 1;
  assertPositiveFinite(playbackRate, "playbackRate");
  const volume = normalizeVolume(config.volume ?? 1, "volume");

  return Object.freeze({
    width: config.width,
    height: config.height,
    fps: config.fps,
    durationInFrames: config.durationInFrames,
    initialFrame,
    autoplay: config.autoplay ?? false,
    loop: config.loop ?? false,
    volume,
    muted: config.muted ?? false,
    playbackRate,
    ...(posterFrame !== undefined ? { posterFrame } : {}),
    fit: normalizeFit(config.fit),
    controls: normalizeControls(config.controls),
    ariaLabel: normalizeAriaLabel(config.ariaLabel)
  });
}

export function playerConfigFromCompositionMetadata(
  metadata: VideoProgrammableCompositionMetadata | ResolvedProgrammableCompositionMetadata,
  overrides: Omit<Partial<VexaPlayerConfig>, "width" | "height" | "fps" | "durationInFrames"> = {}
): VexaPlayerConfig {
  if (metadata.kind !== "video") {
    fail("Browser player requires video composition metadata.", "INVALID_PLAYER_CONFIG");
  }
  return {
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    durationInFrames: metadata.durationInFrames,
    ...overrides
  };
}

export function calculateVexaPlayerScale(
  compositionWidth: number,
  compositionHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  fit: VexaPlayerFitMode = "contain"
): VexaPlayerViewportState {
  assertPositiveFinite(compositionWidth, "compositionWidth");
  assertPositiveFinite(compositionHeight, "compositionHeight");
  assertNonNegativeFinite(viewportWidth, "viewportWidth");
  assertNonNegativeFinite(viewportHeight, "viewportHeight");
  const safeWidth = viewportWidth === 0 ? compositionWidth : viewportWidth;
  const safeHeight = viewportHeight === 0 ? compositionHeight : viewportHeight;
  const xScale = safeWidth / compositionWidth;
  const yScale = safeHeight / compositionHeight;
  const scale = fit === "actual" ? 1 : fit === "cover" ? Math.max(xScale, yScale) : Math.min(xScale, yScale);
  return Object.freeze({
    width: viewportWidth,
    height: viewportHeight,
    scale,
    renderedWidth: compositionWidth * scale,
    renderedHeight: compositionHeight * scale
  });
}

function freezeSnapshot(config: VexaPlayerNormalizedConfig, state: MutablePlayerState): VexaPlayerSnapshot {
  const presentedFrame = !state.hasStarted && config.posterFrame !== undefined
    ? config.posterFrame
    : state.frame;
  return Object.freeze({
    status: state.status,
    frame: state.frame,
    presentedFrame,
    seconds: frameToSeconds(state.frame, config.fps),
    playing: state.playing,
    ended: state.ended,
    buffering: state.buffering,
    hasStarted: state.hasStarted,
    loop: state.loop,
    volume: state.volume,
    muted: state.muted,
    effectiveVolume: state.muted ? 0 : state.volume,
    playbackRate: state.playbackRate,
    fullscreen: state.fullscreen,
    viewport: state.viewport,
    ...(state.error !== undefined ? { error: state.error } : {})
  });
}

export class VexaPlayerController {
  readonly config: VexaPlayerNormalizedConfig;
  readonly #listeners = new Set<VexaPlayerEventListener>();
  #state: MutablePlayerState;
  #fractionalFrames = 0;
  #disposed = false;

  constructor(config: VexaPlayerConfig) {
    this.config = normalizeVexaPlayerConfig(config);
    this.#state = {
      status: this.config.autoplay ? "playing" : "idle",
      frame: this.config.initialFrame,
      playing: this.config.autoplay,
      ended: false,
      buffering: false,
      hasStarted: this.config.autoplay,
      loop: this.config.loop,
      volume: this.config.volume,
      muted: this.config.muted,
      playbackRate: this.config.playbackRate,
      fullscreen: false,
      viewport: calculateVexaPlayerScale(
        this.config.width,
        this.config.height,
        this.config.width,
        this.config.height,
        this.config.fit
      )
    };
  }

  #assertUsable(): void {
    if (this.#disposed) fail("Player controller has been disposed.", "PLAYER_DISPOSED");
  }

  #emit(event: VexaPlayerEventWithoutSnapshot): void {
    const snapshot = this.getSnapshot();
    const fullEvent = Object.freeze({ ...event, snapshot }) as VexaPlayerEvent;
    for (const listener of [...this.#listeners]) listener(fullEvent);
  }

  #stateChanged(): void {
    this.#emit({ type: "statechange" });
  }

  getSnapshot(): VexaPlayerSnapshot {
    return freezeSnapshot(this.config, this.#state);
  }

  get durationSeconds(): number {
    return frameToSeconds(this.config.durationInFrames, this.config.fps);
  }

  get lastFrame(): number {
    return this.config.durationInFrames - 1;
  }

  subscribe(listener: VexaPlayerEventListener): () => void {
    this.#assertUsable();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  play(): void {
    this.#assertUsable();
    if (this.#state.status === "error") fail("Clear the player error before playing.");
    if (this.#state.playing) return;
    if (this.#state.ended) {
      this.#state.frame = 0;
      this.#state.ended = false;
      this.#fractionalFrames = 0;
    }
    this.#state.hasStarted = true;
    this.#state.playing = true;
    this.#state.status = "playing";
    this.#emit({ type: "play" });
    this.#stateChanged();
  }

  pause(): void {
    this.#assertUsable();
    if (!this.#state.playing && this.#state.status === "paused") return;
    this.#state.playing = false;
    if (this.#state.status !== "error" && !this.#state.ended) this.#state.status = "paused";
    this.#emit({ type: "pause" });
    this.#stateChanged();
  }

  seekToFrame(frame: number): void {
    this.#assertUsable();
    if (!Number.isFinite(frame)) fail("frame must be finite.");
    const next = Math.max(0, Math.min(this.lastFrame, Math.round(frame)));
    const previousFrame = this.#state.frame;
    this.#state.frame = next;
    this.#state.hasStarted = true;
    this.#state.ended = false;
    if (this.#state.status === "ended") this.#state.status = "paused";
    this.#fractionalFrames = 0;
    if (next !== previousFrame) this.#emit({ type: "frame", previousFrame, frame: next });
    this.#emit({ type: "seek", previousFrame, frame: next });
    this.#stateChanged();
  }

  seekToSeconds(seconds: number, rounding: FrameRoundingMode = "round"): void {
    this.#assertUsable();
    if (!Number.isFinite(seconds)) fail("seconds must be finite.");
    this.seekToFrame(secondsToFrame(Math.max(0, seconds), this.config.fps, rounding));
  }

  stepFrames(delta: number): void {
    this.#assertUsable();
    if (!Number.isSafeInteger(delta)) fail("frame step must be an integer.");
    this.seekToFrame(this.#state.frame + delta);
  }

  setLoop(loop: boolean): void {
    this.#assertUsable();
    this.#state.loop = loop;
    this.#stateChanged();
  }

  setVolume(volume: number): void {
    this.#assertUsable();
    this.#state.volume = normalizeVolume(volume, "volume");
    this.#emit({ type: "volumechange" });
    this.#stateChanged();
  }

  setMuted(muted: boolean): void {
    this.#assertUsable();
    this.#state.muted = muted;
    this.#emit({ type: "volumechange" });
    this.#stateChanged();
  }

  toggleMuted(): void {
    this.setMuted(!this.#state.muted);
  }

  setPlaybackRate(rate: number): void {
    this.#assertUsable();
    assertPositiveFinite(rate, "playbackRate");
    this.#state.playbackRate = rate;
    this.#fractionalFrames = 0;
    this.#emit({ type: "ratechange" });
    this.#stateChanged();
  }

  setBuffering(buffering: boolean): void {
    this.#assertUsable();
    if (this.#state.buffering === buffering) return;
    this.#state.buffering = buffering;
    this.#emit({ type: "bufferingchange" });
    this.#stateChanged();
  }

  resize(width: number, height: number): void {
    this.#assertUsable();
    this.#state.viewport = calculateVexaPlayerScale(
      this.config.width,
      this.config.height,
      width,
      height,
      this.config.fit
    );
    this.#emit({ type: "resize" });
    this.#stateChanged();
  }

  setFullscreen(fullscreen: boolean): void {
    this.#assertUsable();
    if (this.#state.fullscreen === fullscreen) return;
    this.#state.fullscreen = fullscreen;
    this.#emit({ type: "fullscreenchange" });
    this.#stateChanged();
  }

  setError(error: string | Error): void {
    this.#assertUsable();
    const message = typeof error === "string" ? error : error.message;
    if (!message.trim()) fail("error message cannot be empty.");
    this.#state.error = message;
    this.#state.playing = false;
    this.#state.status = "error";
    this.#emit({ type: "error", error: message });
    this.#stateChanged();
  }

  clearError(): void {
    this.#assertUsable();
    if (this.#state.error === undefined) return;
    delete this.#state.error;
    this.#state.status = this.#state.ended ? "ended" : "paused";
    this.#stateChanged();
  }

  advanceByMilliseconds(milliseconds: number): void {
    this.#assertUsable();
    assertNonNegativeFinite(milliseconds, "milliseconds");
    if (!this.#state.playing || this.#state.buffering || this.#state.status === "error" || milliseconds === 0) return;

    const exactFrames = this.#fractionalFrames + milliseconds / 1000 * this.config.fps * this.#state.playbackRate;
    const wholeFrames = Math.floor(exactFrames + Number.EPSILON);
    this.#fractionalFrames = exactFrames - wholeFrames;
    if (wholeFrames <= 0) return;

    const previousFrame = this.#state.frame;
    let target = previousFrame + wholeFrames;
    if (this.#state.loop) {
      const wraps = Math.floor(target / this.config.durationInFrames);
      target %= this.config.durationInFrames;
      this.#state.frame = target;
      this.#state.ended = false;
      if (target !== previousFrame) this.#emit({ type: "frame", previousFrame, frame: target });
      if (wraps > 0) this.#emit({ type: "loop", wraps });
      this.#stateChanged();
      return;
    }

    if (target >= this.config.durationInFrames) {
      this.#state.frame = this.lastFrame;
      this.#state.playing = false;
      this.#state.ended = true;
      this.#state.status = "ended";
      this.#fractionalFrames = 0;
      if (this.#state.frame !== previousFrame) {
        this.#emit({ type: "frame", previousFrame, frame: this.#state.frame });
      }
      this.#emit({ type: "ended" });
      this.#stateChanged();
      return;
    }

    this.#state.frame = target;
    this.#emit({ type: "frame", previousFrame, frame: target });
    this.#stateChanged();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#state.playing = false;
    this.#emit({ type: "dispose" });
    this.#listeners.clear();
    this.#disposed = true;
  }
}

export function createVexaPlayerController(config: VexaPlayerConfig): VexaPlayerController {
  return new VexaPlayerController(config);
}

export interface VexaFullscreenTarget {
  requestFullscreen?: () => Promise<void> | void;
}

export interface VexaFullscreenDocument {
  readonly fullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
}

export interface VexaFullscreenCapability {
  readonly request: boolean;
  readonly exit: boolean;
  readonly active: boolean;
}

export function getVexaFullscreenCapability(
  target: VexaFullscreenTarget,
  documentLike: VexaFullscreenDocument
): VexaFullscreenCapability {
  return Object.freeze({
    request: typeof target.requestFullscreen === "function",
    exit: typeof documentLike.exitFullscreen === "function",
    active: documentLike.fullscreenElement != null
  });
}

export async function requestVexaFullscreen(
  target: VexaFullscreenTarget,
  documentLike: VexaFullscreenDocument
): Promise<void> {
  const capability = getVexaFullscreenCapability(target, documentLike);
  if (!capability.request) fail("Fullscreen request is unavailable.", "FULLSCREEN_UNAVAILABLE");
  await target.requestFullscreen!();
}

export async function exitVexaFullscreen(documentLike: VexaFullscreenDocument): Promise<void> {
  const capability = getVexaFullscreenCapability({}, documentLike);
  if (!capability.exit) fail("Fullscreen exit is unavailable.", "FULLSCREEN_UNAVAILABLE");
  await documentLike.exitFullscreen!();
}

export interface VexaPlayerRenderFrameContext {
  readonly frame: number;
  readonly state: VexaPlayerSnapshot;
  readonly viewport: HTMLElement;
}

export interface MountVexaPlayerOptions {
  readonly renderFrame: (context: VexaPlayerRenderFrameContext) => void;
  readonly controls?: VexaPlayerControlsMode;
  readonly ariaLabel?: string;
}

export interface MountedVexaPlayer {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly controls: HTMLElement | null;
  readonly controller: VexaPlayerController;
  refreshLayout(): void;
  requestFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  dispose(): void;
}

function button(documentRef: Document, label: string): HTMLButtonElement {
  const element = documentRef.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", label);
  element.tabIndex = 0;
  return element;
}

function renderDefaultControls(
  documentRef: Document,
  root: HTMLElement,
  controller: VexaPlayerController,
  onRequestFullscreen: () => void
): { controls: HTMLElement; sync: (snapshot: VexaPlayerSnapshot) => void; dispose: () => void } {
  const controls = documentRef.createElement("div");
  controls.dataset.vexaPlayerControls = "default";

  const play = button(documentRef, "Play");
  play.dataset.vexaPlayerControl = "play";
  const seek = documentRef.createElement("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = String(controller.lastFrame);
  seek.step = "1";
  seek.setAttribute("aria-label", "Seek");
  seek.tabIndex = 0;
  seek.dataset.vexaPlayerControl = "seek";
  const mute = button(documentRef, "Mute");
  mute.dataset.vexaPlayerControl = "mute";
  const fullscreen = button(documentRef, "Enter fullscreen");
  fullscreen.dataset.vexaPlayerControl = "fullscreen";

  const onPlay = () => controller.getSnapshot().playing ? controller.pause() : controller.play();
  const onSeek = () => controller.seekToFrame(Number(seek.value));
  const onMute = () => controller.toggleMuted();
  play.addEventListener("click", onPlay);
  seek.addEventListener("input", onSeek);
  mute.addEventListener("click", onMute);
  fullscreen.addEventListener("click", onRequestFullscreen);

  controls.append(play, seek, mute, fullscreen);
  root.append(controls);

  const sync = (snapshot: VexaPlayerSnapshot): void => {
    play.textContent = snapshot.playing ? "Pause" : "Play";
    play.setAttribute("aria-label", snapshot.playing ? "Pause" : "Play");
    seek.value = String(snapshot.frame);
    mute.textContent = snapshot.muted ? "Unmute" : "Mute";
    mute.setAttribute("aria-label", snapshot.muted ? "Unmute" : "Mute");
  };

  return {
    controls,
    sync,
    dispose: () => {
      play.removeEventListener("click", onPlay);
      seek.removeEventListener("input", onSeek);
      mute.removeEventListener("click", onMute);
      fullscreen.removeEventListener("click", onRequestFullscreen);
    }
  };
}

export function mountVexaPlayer(
  container: HTMLElement,
  controller: VexaPlayerController,
  options: MountVexaPlayerOptions
): MountedVexaPlayer {
  const documentRef = container.ownerDocument;
  const controlsMode = options.controls ?? controller.config.controls;
  const root = documentRef.createElement("div");
  root.dataset.vexaPlayerRoot = "true";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.ariaLabel ?? controller.config.ariaLabel);

  const viewport = documentRef.createElement("div");
  viewport.dataset.vexaPlayerViewport = "true";
  viewport.style.width = `${controller.config.width}px`;
  viewport.style.height = `${controller.config.height}px`;
  viewport.style.transformOrigin = "top left";
  root.append(viewport);
  container.append(root);

  let disposed = false;
  let lastTimestamp: number | undefined;
  let animationFrame: number | undefined;
  let observer: ResizeObserver | undefined;

  const render = (snapshot = controller.getSnapshot()): void => {
    viewport.style.transform = `scale(${snapshot.viewport.scale})`;
    options.renderFrame({ frame: snapshot.presentedFrame, state: snapshot, viewport });
  };

  const refreshLayout = (): void => {
    const rect = container.getBoundingClientRect();
    controller.resize(rect.width, rect.height);
  };

  const requestFullscreen = async (): Promise<void> => {
    await requestVexaFullscreen(root, documentRef);
  };

  const exitFullscreen = async (): Promise<void> => {
    await exitVexaFullscreen(documentRef);
  };

  const onRequestFullscreen = (): void => {
    void (controller.getSnapshot().fullscreen ? exitFullscreen() : requestFullscreen()).catch((error: unknown) => {
      controller.setError(error instanceof Error ? error : String(error));
    });
  };

  const controlsBinding = controlsMode === "default"
    ? renderDefaultControls(documentRef, root, controller, onRequestFullscreen)
    : null;

  const unsubscribe = controller.subscribe((event) => {
    controlsBinding?.sync(event.snapshot);
    if (event.type !== "dispose") render(event.snapshot);
  });

  const onFullscreenChange = (): void => {
    controller.setFullscreen(documentRef.fullscreenElement === root);
  };
  documentRef.addEventListener("fullscreenchange", onFullscreenChange);

  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) controller.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
  } else {
    refreshLayout();
  }

  const clock = (timestamp: number): void => {
    if (disposed) return;
    const snapshot = controller.getSnapshot();
    if (snapshot.playing && !snapshot.buffering) {
      if (lastTimestamp !== undefined) controller.advanceByMilliseconds(Math.max(0, timestamp - lastTimestamp));
      lastTimestamp = timestamp;
    } else {
      lastTimestamp = undefined;
    }
    animationFrame = requestAnimationFrame(clock);
  };
  if (typeof requestAnimationFrame === "function") animationFrame = requestAnimationFrame(clock);

  controlsBinding?.sync(controller.getSnapshot());
  render();

  return Object.freeze({
    root,
    viewport,
    controls: controlsBinding?.controls ?? null,
    controller,
    refreshLayout,
    requestFullscreen,
    exitFullscreen,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      controlsBinding?.dispose();
      observer?.disconnect();
      documentRef.removeEventListener("fullscreenchange", onFullscreenChange);
      if (animationFrame !== undefined && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(animationFrame);
      }
      root.remove();
    }
  });
}

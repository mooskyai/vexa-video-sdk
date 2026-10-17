import type {
  JsonObject,
  JsonValue,
  ProgrammableCompositionStaticMetadata,
  ResolvedProgrammableComposition,
  ResolvedProgrammableCompositionMetadata,
  VideoProjectAst
} from "@vexa-video/core/browser";
import {
  TimelineHistory,
  createTimelineEditorState
} from "@vexa-video/editor";
import type { TimelineEditorState } from "@vexa-video/editor";
import {
  createVexaPlayerController,
  playerConfigFromCompositionMetadata
} from "@vexa-video/player";
import type {
  VexaPlayerController,
  VexaPlayerSnapshot
} from "@vexa-video/player";

export type VexaStudioErrorCode =
  | "INVALID_STUDIO_CONFIG"
  | "COMPOSITION_NOT_FOUND"
  | "COMPOSITION_MISMATCH"
  | "PLAYBACK_UNAVAILABLE"
  | "STUDIO_DISPOSED";

export class VexaStudioError extends Error {
  readonly code: VexaStudioErrorCode;

  constructor(message: string, code: VexaStudioErrorCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export interface VexaStudioReloadOptions {
  readonly preserveFrame?: boolean;
  readonly preserveProps?: boolean;
}

export interface VexaStudioSessionOptions {
  readonly compositions: readonly ProgrammableCompositionStaticMetadata[];
  readonly selectedCompositionId?: string;
}

export interface VexaStudioSessionSnapshot {
  readonly compositions: readonly ProgrammableCompositionStaticMetadata[];
  readonly selectedComposition: ProgrammableCompositionStaticMetadata;
  readonly resolvedMetadata: ResolvedProgrammableCompositionMetadata;
  readonly props: Readonly<JsonObject>;
  readonly propsDirty: boolean;
  readonly validationError?: string;
  readonly frame: number;
  readonly playing: boolean;
  readonly player: VexaPlayerSnapshot | null;
  readonly timeline: TimelineEditorState;
  readonly revision: number;
}

export type VexaStudioSessionListener = (snapshot: VexaStudioSessionSnapshot) => void;

function fail(message: string, code: VexaStudioErrorCode = "INVALID_STUDIO_CONFIG"): never {
  throw new VexaStudioError(message, code);
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function freezeJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must contain finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => freezeJsonValue(item, `${path}[${index}]`)));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${path} must contain plain JSON objects only.`);
    }
    return Object.freeze(Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort(compareStableText)
        .map((key) => [key, freezeJsonValue((value as Record<string, unknown>)[key], `${path}.${key}`)])
    )) as JsonObject;
  }
  fail(`${path} must contain JSON-compatible values only.`);
}

function freezeJsonObject(value: JsonObject, path = "props"): Readonly<JsonObject> {
  const normalized = freezeJsonValue(value, path);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    fail(`${path} must be a JSON object.`);
  }
  return normalized as Readonly<JsonObject>;
}

function cloneStaticMetadata(
  metadata: ProgrammableCompositionStaticMetadata
): ProgrammableCompositionStaticMetadata {
  if (!metadata.id.trim()) fail("Studio composition id cannot be empty.");
  const defaultProps = freezeJsonObject(metadata.defaultProps, `composition ${metadata.id}.defaultProps`);
  if (metadata.kind === "video") {
    return Object.freeze({
      schemaVersion: metadata.schemaVersion,
      kind: "video" as const,
      id: metadata.id,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      durationInFrames: metadata.durationInFrames,
      defaultProps
    });
  }
  return Object.freeze({
    schemaVersion: metadata.schemaVersion,
    kind: "still" as const,
    id: metadata.id,
    width: metadata.width,
    height: metadata.height,
    defaultProps
  });
}

function normalizeCatalog(
  compositions: readonly ProgrammableCompositionStaticMetadata[]
): readonly ProgrammableCompositionStaticMetadata[] {
  if (!Array.isArray(compositions) || compositions.length === 0) {
    fail("Studio requires at least one composition.");
  }
  const seen = new Set<string>();
  const normalized = compositions.map((metadata) => {
    const copy = cloneStaticMetadata(metadata);
    if (seen.has(copy.id)) fail(`Duplicate Studio composition id: ${copy.id}.`);
    seen.add(copy.id);
    return copy;
  });
  normalized.sort((left, right) => compareStableText(left.id, right.id));
  return Object.freeze(normalized);
}

function resolvedFromStatic(
  metadata: ProgrammableCompositionStaticMetadata
): ResolvedProgrammableCompositionMetadata {
  if (metadata.kind === "video") {
    return Object.freeze({
      schemaVersion: metadata.schemaVersion,
      kind: "video" as const,
      id: metadata.id,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      durationInFrames: metadata.durationInFrames
    });
  }
  return Object.freeze({
    schemaVersion: metadata.schemaVersion,
    kind: "still" as const,
    id: metadata.id,
    width: metadata.width,
    height: metadata.height
  });
}

function cloneResolvedMetadata(
  metadata: ResolvedProgrammableCompositionMetadata
): ResolvedProgrammableCompositionMetadata {
  if (!metadata.id.trim()) fail("Resolved Studio composition id cannot be empty.");
  if (metadata.kind === "video") {
    if (!Number.isFinite(metadata.fps) || metadata.fps <= 0) fail("Resolved Studio fps must be greater than 0.");
    if (!Number.isSafeInteger(metadata.durationInFrames) || metadata.durationInFrames <= 0) {
      fail("Resolved Studio durationInFrames must be a positive integer.");
    }
    return Object.freeze({ ...metadata });
  }
  return Object.freeze({ ...metadata });
}

function timelineProject(metadata: ResolvedProgrammableCompositionMetadata): VideoProjectAst {
  const fps = metadata.kind === "video" ? metadata.fps : 1;
  const durationInFrames = metadata.kind === "video" ? metadata.durationInFrames : 1;
  return {
    schemaVersion: 1,
    id: `studio-${metadata.id}`,
    name: `Studio preview: ${metadata.id}`,
    canvas: {
      width: metadata.width,
      height: metadata.height,
      fps,
      duration: durationInFrames / fps
    },
    tracks: []
  };
}

function createTimeline(
  metadata: ResolvedProgrammableCompositionMetadata,
  initialFrame: number
): TimelineHistory {
  const fps = metadata.kind === "video" ? metadata.fps : 1;
  const state = createTimelineEditorState(timelineProject(metadata), {
    snapSeconds: 1 / fps,
    zoom: 80,
    scrollSeconds: 0
  });
  const history = new TimelineHistory(state);
  if (initialFrame > 0) {
    history.sync({ type: "playhead", seconds: initialFrame / fps });
  }
  return history;
}

export function preserveVexaStudioFrame(
  frame: number,
  metadata: ResolvedProgrammableCompositionMetadata
): number {
  if (!Number.isFinite(frame)) fail("Studio frame must be finite.");
  if (metadata.kind === "still") return 0;
  return Math.max(0, Math.min(metadata.durationInFrames - 1, Math.round(frame)));
}

export class VexaStudioSession {
  #catalog: readonly ProgrammableCompositionStaticMetadata[];
  #selected: ProgrammableCompositionStaticMetadata;
  #resolved: ResolvedProgrammableCompositionMetadata;
  #props: Readonly<JsonObject>;
  #propsDirty = false;
  #validationError: string | undefined;
  #timeline: TimelineHistory;
  #player: VexaPlayerController | null = null;
  #unsubscribePlayer: (() => void) | null = null;
  #listeners = new Set<VexaStudioSessionListener>();
  #revision = 0;
  #disposed = false;

  constructor(options: VexaStudioSessionOptions) {
    this.#catalog = normalizeCatalog(options.compositions);
    const selectedId = options.selectedCompositionId ?? this.#catalog[0]!.id;
    const selected = this.#catalog.find((candidate) => candidate.id === selectedId);
    if (!selected) fail(`Studio composition was not found: ${selectedId}.`, "COMPOSITION_NOT_FOUND");
    this.#selected = selected;
    this.#resolved = resolvedFromStatic(selected);
    this.#props = freezeJsonObject(selected.defaultProps);
    this.#timeline = createTimeline(this.#resolved, 0);
    this.#rebuildPlayer(0);
  }

  #assertUsable(): void {
    if (this.#disposed) fail("Studio session has been disposed.", "STUDIO_DISPOSED");
  }

  #emit(): void {
    this.#revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of [...this.#listeners]) listener(snapshot);
  }

  #currentFrame(): number {
    return this.#player?.getSnapshot().frame ?? 0;
  }

  #rebuildPlayer(frame: number): void {
    this.#unsubscribePlayer?.();
    this.#unsubscribePlayer = null;
    this.#player?.dispose();
    this.#player = null;

    if (this.#resolved.kind !== "video") return;
    const initialFrame = preserveVexaStudioFrame(frame, this.#resolved);
    const player = createVexaPlayerController(playerConfigFromCompositionMetadata(this.#resolved, {
      initialFrame,
      controls: "custom"
    }));
    this.#player = player;
    this.#unsubscribePlayer = player.subscribe((event) => {
      if (event.type !== "statechange") return;
      this.#timeline.sync({ type: "playhead", seconds: event.snapshot.seconds });
      this.#emit();
    });
  }

  #resetRuntime(metadata: ResolvedProgrammableCompositionMetadata, frame: number): void {
    this.#resolved = cloneResolvedMetadata(metadata);
    const preserved = preserveVexaStudioFrame(frame, this.#resolved);
    this.#timeline = createTimeline(this.#resolved, preserved);
    this.#rebuildPlayer(preserved);
  }

  getSnapshot(): VexaStudioSessionSnapshot {
    this.#assertUsable();
    const player = this.#player?.getSnapshot() ?? null;
    return Object.freeze({
      compositions: this.#catalog,
      selectedComposition: this.#selected,
      resolvedMetadata: this.#resolved,
      props: this.#props,
      propsDirty: this.#propsDirty,
      ...(this.#validationError !== undefined ? { validationError: this.#validationError } : {}),
      frame: player?.frame ?? 0,
      playing: player?.playing ?? false,
      player,
      timeline: this.#timeline.state,
      revision: this.#revision
    });
  }

  subscribe(listener: VexaStudioSessionListener): () => void {
    this.#assertUsable();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  selectComposition(id: string): VexaStudioSessionSnapshot {
    this.#assertUsable();
    const selected = this.#catalog.find((candidate) => candidate.id === id);
    if (!selected) fail(`Studio composition was not found: ${id}.`, "COMPOSITION_NOT_FOUND");
    if (selected.id === this.#selected.id) return this.getSnapshot();
    this.#selected = selected;
    this.#props = freezeJsonObject(selected.defaultProps);
    this.#propsDirty = false;
    this.#validationError = undefined;
    this.#resetRuntime(resolvedFromStatic(selected), 0);
    this.#emit();
    return this.getSnapshot();
  }

  setProps(props: JsonObject): VexaStudioSessionSnapshot {
    this.#assertUsable();
    this.#props = freezeJsonObject(props);
    this.#propsDirty = true;
    this.#validationError = undefined;
    this.#emit();
    return this.getSnapshot();
  }

  setValidationError(error: string | Error | null): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (error === null) {
      this.#validationError = undefined;
    } else {
      const message = typeof error === "string" ? error : error.message;
      if (!message.trim()) fail("Studio validation error cannot be empty.");
      this.#validationError = message;
    }
    this.#emit();
    return this.getSnapshot();
  }

  applyResolvedComposition(
    resolved: ResolvedProgrammableComposition
  ): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (resolved.metadata.id !== this.#selected.id) {
      fail(
        `Resolved composition "${resolved.metadata.id}" does not match selected composition "${this.#selected.id}".`,
        "COMPOSITION_MISMATCH"
      );
    }
    const frame = this.#currentFrame();
    this.#props = freezeJsonObject(resolved.props);
    this.#propsDirty = false;
    this.#validationError = undefined;
    this.#resetRuntime(resolved.metadata, frame);
    this.#emit();
    return this.getSnapshot();
  }

  reloadCompositions(
    compositions: readonly ProgrammableCompositionStaticMetadata[],
    options: VexaStudioReloadOptions = {}
  ): VexaStudioSessionSnapshot {
    this.#assertUsable();
    const nextCatalog = normalizeCatalog(compositions);
    const previousId = this.#selected.id;
    const previousKind = this.#selected.kind;
    const previousFrame = this.#currentFrame();
    const previousProps = this.#props;
    const selected = nextCatalog.find((candidate) => candidate.id === previousId) ?? nextCatalog[0]!;
    const sameComposition = selected.id === previousId && selected.kind === previousKind;

    this.#catalog = nextCatalog;
    this.#selected = selected;
    const preserveProps = sameComposition && (options.preserveProps ?? this.#propsDirty);
    this.#props = preserveProps ? previousProps : freezeJsonObject(selected.defaultProps);
    this.#propsDirty = preserveProps ? this.#propsDirty : false;
    this.#validationError = undefined;
    const frame = sameComposition && (options.preserveFrame ?? true) ? previousFrame : 0;
    this.#resetRuntime(resolvedFromStatic(selected), frame);
    this.#emit();
    return this.getSnapshot();
  }

  seekFrame(frame: number): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (!this.#player) {
      this.#timeline.sync({ type: "playhead", seconds: 0 });
      this.#emit();
      return this.getSnapshot();
    }
    this.#player.seekToFrame(frame);
    return this.getSnapshot();
  }

  stepFrames(delta: number): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (!Number.isSafeInteger(delta)) fail("Studio frame step must be an integer.");
    if (!this.#player) return this.seekFrame(0);
    this.#player.stepFrames(delta);
    return this.getSnapshot();
  }

  play(): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (!this.#player) fail("Still compositions do not support playback.", "PLAYBACK_UNAVAILABLE");
    this.#player.play();
    return this.getSnapshot();
  }

  pause(): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (!this.#player) return this.getSnapshot();
    this.#player.pause();
    return this.getSnapshot();
  }

  advanceByMilliseconds(milliseconds: number): VexaStudioSessionSnapshot {
    this.#assertUsable();
    if (!this.#player) return this.getSnapshot();
    this.#player.advanceByMilliseconds(milliseconds);
    return this.getSnapshot();
  }

  setTimelineViewport(options: { zoom?: number; scrollSeconds?: number }): VexaStudioSessionSnapshot {
    this.#assertUsable();
    this.#timeline.sync({ type: "viewport", ...options });
    this.#emit();
    return this.getSnapshot();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#unsubscribePlayer?.();
    this.#unsubscribePlayer = null;
    this.#player?.dispose();
    this.#player = null;
    this.#listeners.clear();
    this.#disposed = true;
  }
}

export function createVexaStudioSession(options: VexaStudioSessionOptions): VexaStudioSession {
  return new VexaStudioSession(options);
}

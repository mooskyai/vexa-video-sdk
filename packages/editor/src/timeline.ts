import type { TimelineClip, VideoProjectAst } from "@moosky-video/core/browser";

export interface TimelineSelection {
  trackId: string;
  clipId: string;
}

export interface TimelineViewport {
  zoom: number;
  scrollSeconds: number;
}

export interface TimelineEditorState {
  schemaVersion: 1;
  project: VideoProjectAst;
  selection: TimelineSelection | null;
  playheadSeconds: number;
  snapSeconds: number;
  viewport: TimelineViewport;
  revision: number;
}

export interface TimelineEditorOptions {
  snapSeconds?: number;
  zoom?: number;
  scrollSeconds?: number;
}

export type TimelineEditorCommand =
  | { type: "select"; selection: TimelineSelection | null }
  | { type: "playhead"; seconds: number }
  | { type: "viewport"; zoom?: number; scrollSeconds?: number }
  | { type: "snap"; seconds: number }
  | { type: "move-clip"; trackId: string; clipId: string; start: number; snap?: boolean }
  | { type: "trim-clip"; trackId: string; clipId: string; start?: number; duration: number; sourceStart?: number; snap?: boolean };

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite number >= 0.`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a finite number > 0.`);
  return value;
}

function cloneProject(project: VideoProjectAst): VideoProjectAst {
  return {
    ...project,
    canvas: { ...project.canvas },
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        ...("transform" in clip && clip.transform ? { transform: { ...clip.transform } } : {}),
        ...(clip.transitions ? { transitions: { ...clip.transitions } } : {})
      } as TimelineClip))
    }))
  };
}

function findClip(project: VideoProjectAst, trackId: string, clipId: string): { trackIndex: number; clipIndex: number; clip: TimelineClip } {
  const trackIndex = project.tracks.findIndex((track) => track.id === trackId);
  if (trackIndex < 0) throw new TypeError(`Timeline track was not found: ${trackId}`);
  const track = project.tracks[trackIndex]!;
  if (track.locked) throw new TypeError(`Timeline track is locked: ${trackId}`);
  const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
  if (clipIndex < 0) throw new TypeError(`Timeline clip was not found: ${clipId}`);
  return { trackIndex, clipIndex, clip: track.clips[clipIndex]! };
}

export function snapTimelineTime(seconds: number, snapSeconds: number): number {
  finiteNonNegative(seconds, "seconds");
  positive(snapSeconds, "snapSeconds");
  return Math.max(0, Math.round(seconds / snapSeconds) * snapSeconds);
}

export function createTimelineEditorState(project: VideoProjectAst, options: TimelineEditorOptions = {}): TimelineEditorState {
  if (!project || project.schemaVersion !== 1) throw new TypeError("Timeline editor requires a VideoProjectAst schemaVersion 1 project.");
  return {
    schemaVersion: 1,
    project: cloneProject(project),
    selection: null,
    playheadSeconds: 0,
    snapSeconds: positive(options.snapSeconds ?? 0.1, "snapSeconds"),
    viewport: {
      zoom: positive(options.zoom ?? 80, "zoom"),
      scrollSeconds: finiteNonNegative(options.scrollSeconds ?? 0, "scrollSeconds")
    },
    revision: 0
  };
}

function replaceClip(project: VideoProjectAst, trackId: string, clipId: string, update: (clip: TimelineClip) => TimelineClip): VideoProjectAst {
  const { trackIndex, clipIndex, clip } = findClip(project, trackId, clipId);
  const tracks = project.tracks.map((track, index) => {
    if (index !== trackIndex) return track;
    const clips = track.clips.map((value, current) => current === clipIndex ? update(clip) : value);
    return { ...track, clips };
  });
  return { ...project, tracks };
}

export function applyTimelineEditorCommand(state: TimelineEditorState, command: TimelineEditorCommand): TimelineEditorState {
  if (!state || state.schemaVersion !== 1) throw new TypeError("Invalid timeline editor state.");

  switch (command.type) {
    case "select":
      if (command.selection) findClip(state.project, command.selection.trackId, command.selection.clipId);
      return { ...state, selection: command.selection ? { ...command.selection } : null, revision: state.revision + 1 };

    case "playhead":
      return { ...state, playheadSeconds: finiteNonNegative(command.seconds, "playheadSeconds"), revision: state.revision + 1 };

    case "viewport":
      return {
        ...state,
        viewport: {
          zoom: command.zoom === undefined ? state.viewport.zoom : positive(command.zoom, "zoom"),
          scrollSeconds: command.scrollSeconds === undefined
            ? state.viewport.scrollSeconds
            : finiteNonNegative(command.scrollSeconds, "scrollSeconds")
        },
        revision: state.revision + 1
      };

    case "snap":
      return { ...state, snapSeconds: positive(command.seconds, "snapSeconds"), revision: state.revision + 1 };

    case "move-clip": {
      const rawStart = finiteNonNegative(command.start, "clip.start");
      const start = command.snap === false ? rawStart : snapTimelineTime(rawStart, state.snapSeconds);
      return {
        ...state,
        project: replaceClip(state.project, command.trackId, command.clipId, (clip) => ({ ...clip, start })),
        revision: state.revision + 1
      };
    }

    case "trim-clip": {
      const durationRaw = positive(command.duration, "clip.duration");
      const duration = command.snap === false ? durationRaw : Math.max(state.snapSeconds, snapTimelineTime(durationRaw, state.snapSeconds));
      const startRaw = command.start;
      const sourceStartRaw = command.sourceStart;
      return {
        ...state,
        project: replaceClip(state.project, command.trackId, command.clipId, (clip) => {
          const next: TimelineClip = {
            ...clip,
            duration,
            ...(startRaw !== undefined
              ? { start: command.snap === false ? finiteNonNegative(startRaw, "clip.start") : snapTimelineTime(startRaw, state.snapSeconds) }
              : {})
          };
          if ((clip.kind === "video" || clip.kind === "audio") && sourceStartRaw !== undefined) {
            return { ...next, sourceStart: finiteNonNegative(sourceStartRaw, "clip.sourceStart") } as TimelineClip;
          }
          return next;
        }),
        revision: state.revision + 1
      };
    }
  }
}

export class TimelineHistory {
  #state: TimelineEditorState;
  #undo: TimelineEditorState[] = [];
  #redo: TimelineEditorState[] = [];
  readonly limit: number;

  constructor(initial: TimelineEditorState, limit = 100) {
    if (!Number.isInteger(limit) || limit <= 0) throw new TypeError("Timeline history limit must be a positive integer.");
    this.#state = initial;
    this.limit = limit;
  }

  get state(): TimelineEditorState { return this.#state; }
  get canUndo(): boolean { return this.#undo.length > 0; }
  get canRedo(): boolean { return this.#redo.length > 0; }

  dispatch(command: TimelineEditorCommand): TimelineEditorState {
    const next = applyTimelineEditorCommand(this.#state, command);
    this.#undo.push(this.#state);
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo = [];
    this.#state = next;
    return next;
  }

  undo(): TimelineEditorState {
    const previous = this.#undo.pop();
    if (!previous) return this.#state;
    this.#redo.push(this.#state);
    this.#state = previous;
    return this.#state;
  }

  redo(): TimelineEditorState {
    const next = this.#redo.pop();
    if (!next) return this.#state;
    this.#undo.push(this.#state);
    this.#state = next;
    return this.#state;
  }
}

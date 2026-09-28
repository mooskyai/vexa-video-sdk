import { InvalidProjectError } from "./errors.js";
import type {
  AudioCodec,
  EncoderPreset,
  MediaProgress,
  ProcessControlOptions,
  ResizeFit,
  VideoCodec
} from "./editing.js";
import type { HardwareAccelerationDecision, HardwareAccelerationOptions } from "./hardware.js";

export type ProjectTrackType = "video" | "audio" | "image" | "text";
export type ClipKind = ProjectTrackType;
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "addition"
  | "difference"
  | "darken"
  | "lighten";
export type TransitionType = "fade" | "crossfade" | "wipe-left" | "wipe-right";
export type KeyframeEasing = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";

export interface NumericKeyframe {
  time: number;
  value: number;
  easing?: KeyframeEasing;
}

/**
 * Numeric properties can be static or keyframed. Keyframe times are relative
 * to the owning clip and remain plain JSON so browser clients and workers can
 * exchange the project without serializing live SDK objects.
 */
export type NumericProperty = number | {
  value: number;
  keyframes?: readonly NumericKeyframe[];
};

export interface ClipTransform {
  x?: NumericProperty;
  y?: NumericProperty;
  width?: NumericProperty;
  height?: NumericProperty;
  rotation?: NumericProperty;
  fit?: ResizeFit;
}

export interface ClipTransitions {
  in?: {
    type: TransitionType;
    duration: number;
  };
  out?: {
    type: TransitionType;
    duration: number;
  };
}

export interface TimelineClipBase {
  id: string;
  start: number;
  duration: number;
  enabled?: boolean;
  opacity?: NumericProperty;
  transform?: ClipTransform;
  blendMode?: BlendMode;
  transitions?: ClipTransitions;
}

export interface VideoTimelineClip extends TimelineClipBase {
  kind: "video";
  source: string;
  sourceStart?: number;
  includeAudio?: boolean;
  volume?: NumericProperty;
}

export interface AudioTimelineClip extends Omit<TimelineClipBase, "transform" | "blendMode"> {
  kind: "audio";
  source: string;
  sourceStart?: number;
  volume?: NumericProperty;
}

export interface ImageTimelineClip extends TimelineClipBase {
  kind: "image";
  source: string;
}

export interface TextStyle {
  fontSize?: NumericProperty;
  color?: string;
  fontFile?: string;
  boxColor?: string;
  boxPadding?: number;
}

export interface TextTimelineClip extends Omit<TimelineClipBase, "blendMode"> {
  kind: "text";
  text: string;
  style?: TextStyle;
}

export type TimelineClip =
  | VideoTimelineClip
  | AudioTimelineClip
  | ImageTimelineClip
  | TextTimelineClip;

export interface ProjectTrack {
  id: string;
  type: ProjectTrackType;
  name?: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  clips: readonly TimelineClip[];
}

export interface ProjectCanvas {
  width: number;
  height: number;
  fps: number;
  duration?: number;
  background?: string;
}

export interface VideoProjectAst {
  schemaVersion: 1;
  id: string;
  name?: string;
  canvas: ProjectCanvas;
  tracks: readonly ProjectTrack[];
}

export interface ProjectRenderOptions extends ProcessControlOptions, HardwareAccelerationOptions {
  overwrite?: boolean;
  videoCodec?: Exclude<VideoCodec, "copy">;
  audioCodec?: Exclude<AudioCodec, "copy">;
  crf?: number;
  preset?: EncoderPreset;
  pixelFormat?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  onProgress?: (progress: MediaProgress) => void;
}

export interface ProjectInputDescriptor {
  index: number;
  clipId: string;
  kind: "video" | "audio" | "image";
  source: string;
}

export interface ProjectExecutionPlan {
  schemaVersion: 1;
  backend: "ffmpeg";
  task: "project-render";
  projectId: string;
  output: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  inputs: readonly ProjectInputDescriptor[];
  filterComplex: string;
  videoMap: string;
  audioMap: string | null;
  args: readonly string[];
  optimizations: readonly string[];
  hardware: HardwareAccelerationDecision | null;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidProjectError(`${label} must be a finite number greater than or equal to 0.`);
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidProjectError(`${label} must be a finite number greater than 0.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidProjectError(`${label} must be a positive integer.`);
  }
}

function easingValue(progress: number, easing: KeyframeEasing): number {
  const t = Math.min(1, Math.max(0, progress));
  switch (easing) {
    case "hold": return 0;
    case "ease-in": return t * t;
    case "ease-out": return 1 - ((1 - t) * (1 - t));
    case "ease-in-out":
      return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    case "linear":
    default:
      return t;
  }
}

function normalizedNumericProperty(
  property: NumericProperty | undefined,
  fallback: number,
  label: string,
  clipDuration?: number
): NumericProperty {
  if (property === undefined) return fallback;
  if (typeof property === "number") {
    if (!Number.isFinite(property)) throw new InvalidProjectError(`${label} must be finite.`);
    return property;
  }

  if (!Number.isFinite(property.value)) {
    throw new InvalidProjectError(`${label}.value must be finite.`);
  }

  const keyframes = [...(property.keyframes ?? [])]
    .map((keyframe) => {
      assertFiniteNonNegative(keyframe.time, `${label}.keyframes.time`);
      if (!Number.isFinite(keyframe.value)) {
        throw new InvalidProjectError(`${label}.keyframes.value must be finite.`);
      }
      if (clipDuration !== undefined && keyframe.time > clipDuration + 1e-6) {
        throw new InvalidProjectError(
          `${label} keyframe at ${keyframe.time}s exceeds the clip duration of ${clipDuration}s.`
        );
      }
      return {
        time: keyframe.time,
        value: keyframe.value,
        easing: keyframe.easing ?? "linear"
      } satisfies NumericKeyframe;
    })
    .sort((a, b) => a.time - b.time);

  for (let index = 1; index < keyframes.length; index += 1) {
    if (Math.abs(keyframes[index]!.time - keyframes[index - 1]!.time) < 1e-9) {
      throw new InvalidProjectError(`${label} cannot contain duplicate keyframe times.`);
    }
  }

  return {
    value: property.value,
    ...(keyframes.length ? { keyframes } : {})
  };
}

export function numericPropertyValue(
  property: NumericProperty | undefined,
  fallback: number,
  label = "property"
): number {
  const normalized = normalizedNumericProperty(property, fallback, label);
  return typeof normalized === "number" ? normalized : normalized.value;
}

export function numericPropertyHasKeyframes(property: NumericProperty | undefined): boolean {
  return typeof property === "object" && Boolean(property.keyframes?.length);
}

export function numericPropertyValueAt(
  property: NumericProperty | undefined,
  time: number,
  fallback: number,
  label = "property"
): number {
  assertFiniteNonNegative(time, `${label}.time`);
  const normalized = normalizedNumericProperty(property, fallback, label);
  if (typeof normalized === "number" || !normalized.keyframes?.length) {
    return typeof normalized === "number" ? normalized : normalized.value;
  }

  let previousTime = 0;
  let previousValue = normalized.value;
  for (const keyframe of normalized.keyframes) {
    if (time < keyframe.time) {
      if (keyframe.easing === "hold") return previousValue;
      const span = keyframe.time - previousTime;
      if (span <= 0) return keyframe.value;
      const progress = easingValue((time - previousTime) / span, keyframe.easing ?? "linear");
      return previousValue + (keyframe.value - previousValue) * progress;
    }
    previousTime = keyframe.time;
    previousValue = keyframe.value;
  }
  return previousValue;
}

function normalizeTransition(
  transition: ClipTransitions["in"] | undefined,
  label: string,
  clipDuration: number
): ClipTransitions["in"] | undefined {
  if (!transition) return undefined;
  if (!["fade", "crossfade", "wipe-left", "wipe-right"].includes(transition.type)) {
    throw new InvalidProjectError(`${label}.type is not supported.`);
  }
  assertFinitePositive(transition.duration, `${label}.duration`);
  if (transition.duration > clipDuration) {
    throw new InvalidProjectError(`${label}.duration cannot exceed the clip duration.`);
  }
  return { type: transition.type, duration: transition.duration };
}

function normalizeClip(clip: TimelineClip, track: ProjectTrack): TimelineClip {
  if (!clip.id.trim()) throw new InvalidProjectError("Every clip requires a non-empty id.");
  if (clip.kind !== track.type) {
    throw new InvalidProjectError(
      `Clip "${clip.id}" has kind "${clip.kind}" but is inside a "${track.type}" track.`
    );
  }
  assertFiniteNonNegative(clip.start, `clip ${clip.id}.start`);
  assertFinitePositive(clip.duration, `clip ${clip.id}.duration`);

  const enabled = clip.enabled !== false;
  const opacity = normalizedNumericProperty(
    clip.opacity,
    1,
    `clip ${clip.id}.opacity`,
    clip.duration
  );
  const opacityValues = typeof opacity === "number"
    ? [opacity]
    : [opacity.value, ...(opacity.keyframes ?? []).map((keyframe) => keyframe.value)];
  if (opacityValues.some((value) => value < 0 || value > 1)) {
    throw new InvalidProjectError(`clip ${clip.id}.opacity must stay between 0 and 1.`);
  }

  const transformSource = "transform" in clip ? clip.transform : undefined;
  const transform = transformSource
    ? {
        ...(transformSource.x !== undefined
          ? { x: normalizedNumericProperty(transformSource.x, 0, `clip ${clip.id}.transform.x`, clip.duration) }
          : {}),
        ...(transformSource.y !== undefined
          ? { y: normalizedNumericProperty(transformSource.y, 0, `clip ${clip.id}.transform.y`, clip.duration) }
          : {}),
        ...(transformSource.width !== undefined
          ? { width: normalizedNumericProperty(transformSource.width, 0, `clip ${clip.id}.transform.width`, clip.duration) }
          : {}),
        ...(transformSource.height !== undefined
          ? { height: normalizedNumericProperty(transformSource.height, 0, `clip ${clip.id}.transform.height`, clip.duration) }
          : {}),
        ...(transformSource.rotation !== undefined
          ? { rotation: normalizedNumericProperty(transformSource.rotation, 0, `clip ${clip.id}.transform.rotation`, clip.duration) }
          : {}),
        ...(transformSource.fit ? { fit: transformSource.fit } : {})
      }
    : undefined;

  if (transform?.width !== undefined) {
    const values = typeof transform.width === "number"
      ? [transform.width]
      : [transform.width.value, ...(transform.width.keyframes ?? []).map((keyframe) => keyframe.value)];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new InvalidProjectError(`clip ${clip.id}.transform.width must stay greater than 0.`);
    }
  }
  if (transform?.height !== undefined) {
    const values = typeof transform.height === "number"
      ? [transform.height]
      : [transform.height.value, ...(transform.height.keyframes ?? []).map((keyframe) => keyframe.value)];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new InvalidProjectError(`clip ${clip.id}.transform.height must stay greater than 0.`);
    }
  }

  const transitionIn = normalizeTransition(
    clip.transitions?.in,
    `clip ${clip.id}.transitions.in`,
    clip.duration
  );
  const transitionOut = normalizeTransition(
    clip.transitions?.out,
    `clip ${clip.id}.transitions.out`,
    clip.duration
  );
  const transitions = transitionIn || transitionOut
    ? { ...(transitionIn ? { in: transitionIn } : {}), ...(transitionOut ? { out: transitionOut } : {}) }
    : undefined;

  const base = {
    ...clip,
    enabled,
    opacity,
    ...(transform ? { transform } : {}),
    ...(transitions && (transitions.in || transitions.out) ? { transitions } : {})
  } as TimelineClip;

  if (base.kind === "video" || base.kind === "audio") {
    if (!base.source.trim()) throw new InvalidProjectError(`Clip "${base.id}" requires a source.`);
    const sourceStart = base.sourceStart ?? 0;
    assertFiniteNonNegative(sourceStart, `clip ${base.id}.sourceStart`);
    const volume = normalizedNumericProperty(
      base.volume,
      1,
      `clip ${base.id}.volume`,
      base.duration
    );
    const volumeValues = typeof volume === "number"
      ? [volume]
      : [volume.value, ...(volume.keyframes ?? []).map((keyframe) => keyframe.value)];
    if (volumeValues.some((value) => value < 0)) {
      throw new InvalidProjectError(`clip ${base.id}.volume must stay greater than or equal to 0.`);
    }
    return { ...base, sourceStart, volume } as TimelineClip;
  }

  if (base.kind === "image") {
    if (!base.source.trim()) throw new InvalidProjectError(`Clip "${base.id}" requires a source.`);
    return base;
  }

  if (!base.text.trim()) throw new InvalidProjectError(`Text clip "${base.id}" requires text.`);
  if (base.style?.fontSize !== undefined) {
    const fontSize = normalizedNumericProperty(
      base.style.fontSize,
      48,
      `clip ${base.id}.style.fontSize`,
      base.duration
    );
    const values = typeof fontSize === "number"
      ? [fontSize]
      : [fontSize.value, ...(fontSize.keyframes ?? []).map((keyframe) => keyframe.value)];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new InvalidProjectError(`clip ${base.id}.style.fontSize must stay greater than 0.`);
    }
    return { ...base, style: { ...base.style, fontSize } };
  }
  return base;
}

export function normalizeVideoProject(project: VideoProjectAst): VideoProjectAst {
  if (project.schemaVersion !== 1) {
    throw new InvalidProjectError(`Unsupported project schema version: ${String(project.schemaVersion)}.`);
  }
  if (!project.id.trim()) throw new InvalidProjectError("Project id cannot be empty.");
  assertPositiveInteger(project.canvas.width, "project.canvas.width");
  assertPositiveInteger(project.canvas.height, "project.canvas.height");
  assertFinitePositive(project.canvas.fps, "project.canvas.fps");
  if (project.canvas.duration !== undefined) {
    assertFinitePositive(project.canvas.duration, "project.canvas.duration");
  }

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const tracks = project.tracks.map((track) => {
    if (!track.id.trim()) throw new InvalidProjectError("Every track requires a non-empty id.");
    if (trackIds.has(track.id)) throw new InvalidProjectError(`Duplicate track id: ${track.id}.`);
    trackIds.add(track.id);

    const clips = track.clips.map((clip) => {
      if (clipIds.has(clip.id)) throw new InvalidProjectError(`Duplicate clip id: ${clip.id}.`);
      clipIds.add(clip.id);
      return normalizeClip(clip, track);
    });

    return {
      ...track,
      muted: track.muted === true,
      hidden: track.hidden === true,
      locked: track.locked === true,
      clips
    };
  });

  const normalized: VideoProjectAst = {
    schemaVersion: 1,
    id: project.id,
    ...(project.name ? { name: project.name } : {}),
    canvas: {
      width: project.canvas.width,
      height: project.canvas.height,
      fps: project.canvas.fps,
      ...(project.canvas.duration !== undefined ? { duration: project.canvas.duration } : {}),
      background: project.canvas.background ?? "black"
    },
    tracks
  };

  const duration = projectDurationSeconds(normalized);
  if (normalized.canvas.duration !== undefined) {
    for (const track of normalized.tracks) {
      for (const clip of track.clips) {
        if (clip.enabled !== false && clip.start + clip.duration > normalized.canvas.duration + 1e-6) {
          throw new InvalidProjectError(
            `Clip "${clip.id}" ends after the explicit project duration of ${normalized.canvas.duration}s.`
          );
        }
      }
    }
  }

  return normalized;
}

export function projectDurationSeconds(project: VideoProjectAst): number {
  if (project.canvas.duration !== undefined) return project.canvas.duration;
  let duration = 0;
  for (const track of project.tracks) {
    if (track.hidden && track.type !== "audio") continue;
    if (track.muted && track.type === "audio") continue;
    for (const clip of track.clips) {
      if (clip.enabled === false) continue;
      duration = Math.max(duration, clip.start + clip.duration);
    }
  }
  return duration;
}

export function createVideoProjectAst(options: {
  id: string;
  name?: string;
  width: number;
  height: number;
  fps?: number;
  duration?: number;
  background?: string;
}): VideoProjectAst {
  return normalizeVideoProject({
    schemaVersion: 1,
    id: options.id,
    ...(options.name ? { name: options.name } : {}),
    canvas: {
      width: options.width,
      height: options.height,
      fps: options.fps ?? 30,
      ...(options.duration !== undefined ? { duration: options.duration } : {}),
      ...(options.background ? { background: options.background } : {})
    },
    tracks: []
  });
}

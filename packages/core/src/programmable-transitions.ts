import {
  easeInOutQuad,
  easeInQuad,
  easeOutQuad,
  linearEasing
} from "./programmable-timing.js";

export type ProgrammableTransitionErrorCode = "INVALID_PROGRAMMABLE_TRANSITION";

export class InvalidProgrammableTransitionError extends Error {
  readonly code = "INVALID_PROGRAMMABLE_TRANSITION" as const;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export type ProgrammableTransitionEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out";

export type ProgrammableTransitionDirection =
  | "left"
  | "right"
  | "up"
  | "down";

export interface ProgrammableFadeTransition {
  readonly kind: "fade";
  readonly durationInFrames: number;
  readonly easing?: ProgrammableTransitionEasing;
}

export interface ProgrammableSlideTransition {
  readonly kind: "slide";
  readonly durationInFrames: number;
  readonly easing?: ProgrammableTransitionEasing;
  readonly direction?: ProgrammableTransitionDirection;
}

export interface ProgrammableWipeTransition {
  readonly kind: "wipe";
  readonly durationInFrames: number;
  readonly easing?: ProgrammableTransitionEasing;
  readonly direction?: ProgrammableTransitionDirection;
}

export interface ProgrammablePushTransition {
  readonly kind: "push";
  readonly durationInFrames: number;
  readonly easing?: ProgrammableTransitionEasing;
  readonly direction?: ProgrammableTransitionDirection;
}

export interface ProgrammableZoomTransition {
  readonly kind: "zoom";
  readonly durationInFrames: number;
  readonly easing?: ProgrammableTransitionEasing;
}

export interface ProgrammableIrisTransition {
  /** Circular iris reveal/close. */
  readonly kind: "iris";
  readonly durationInFrames: number;
  readonly easing?: ProgrammableTransitionEasing;
}

export type ProgrammableTransition =
  | ProgrammableFadeTransition
  | ProgrammableSlideTransition
  | ProgrammableWipeTransition
  | ProgrammablePushTransition
  | ProgrammableZoomTransition
  | ProgrammableIrisTransition;

export type ProgrammableTransitionKind = ProgrammableTransition["kind"];

export interface ProgrammableTransitions {
  readonly in?: ProgrammableTransition;
  readonly out?: ProgrammableTransition;
}

const DEFAULT_EASING: ProgrammableTransitionEasing = "linear";
const DEFAULT_DIRECTION: ProgrammableTransitionDirection = "left";

function normalizeDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidProgrammableTransitionError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeEasing(
  value: ProgrammableTransitionEasing | undefined,
  label: string
): ProgrammableTransitionEasing {
  const normalized = value ?? DEFAULT_EASING;
  if (
    normalized !== "linear" &&
    normalized !== "ease-in" &&
    normalized !== "ease-out" &&
    normalized !== "ease-in-out"
  ) {
    throw new InvalidProgrammableTransitionError(`${label} is not supported.`);
  }
  return normalized;
}

function normalizeDirection(
  value: ProgrammableTransitionDirection | undefined,
  label: string
): ProgrammableTransitionDirection {
  const normalized = value ?? DEFAULT_DIRECTION;
  if (
    normalized !== "left" &&
    normalized !== "right" &&
    normalized !== "up" &&
    normalized !== "down"
  ) {
    throw new InvalidProgrammableTransitionError(`${label} is not supported.`);
  }
  return normalized;
}

export function normalizeProgrammableTransition(
  transition: ProgrammableTransition
): ProgrammableTransition {
  const durationInFrames = normalizeDuration(
    transition.durationInFrames,
    `transition.${transition.kind}.durationInFrames`
  );
  const easing = normalizeEasing(
    transition.easing,
    `transition.${transition.kind}.easing`
  );

  switch (transition.kind) {
    case "fade":
      return Object.freeze({ kind: "fade", durationInFrames, easing });

    case "slide":
    case "wipe":
    case "push":
      return Object.freeze({
        kind: transition.kind,
        durationInFrames,
        easing,
        direction: normalizeDirection(
          transition.direction,
          `transition.${transition.kind}.direction`
        )
      });

    case "zoom":
      return Object.freeze({ kind: "zoom", durationInFrames, easing });

    case "iris":
      return Object.freeze({ kind: "iris", durationInFrames, easing });

    default: {
      const exhaustive: never = transition;
      void exhaustive;
      throw new InvalidProgrammableTransitionError("transition.kind is not supported.");
    }
  }
}

export function normalizeProgrammableTransitions(
  transitions: ProgrammableTransitions
): ProgrammableTransitions {
  if (transitions.in === undefined && transitions.out === undefined) {
    throw new InvalidProgrammableTransitionError(
      "transitions must define an in or out transition."
    );
  }
  return Object.freeze({
    ...(transitions.in !== undefined
      ? { in: normalizeProgrammableTransition(transitions.in) }
      : {}),
    ...(transitions.out !== undefined
      ? { out: normalizeProgrammableTransition(transitions.out) }
      : {})
  });
}

export type ProgrammableTransitionEdge = "in" | "out";

function transitionEasingValue(
  easing: ProgrammableTransitionEasing,
  progress: number
): number {
  switch (easing) {
    case "ease-in": return easeInQuad(progress);
    case "ease-out": return easeOutQuad(progress);
    case "ease-in-out": return easeInOutQuad(progress);
    case "linear": return linearEasing(progress);
  }
  const exhaustive: never = easing;
  return exhaustive;
}

export function programmableTransitionVisibility(
  transition: ProgrammableTransition,
  edge: ProgrammableTransitionEdge,
  localFrame: number,
  clipDurationInFrames: number
): number {
  const normalized = normalizeProgrammableTransition(transition);
  if (edge !== "in" && edge !== "out") {
    throw new InvalidProgrammableTransitionError("transition edge must be in or out.");
  }
  if (!Number.isSafeInteger(localFrame) || localFrame < 0) {
    throw new InvalidProgrammableTransitionError(
      "transition localFrame must be a non-negative safe integer."
    );
  }
  if (!Number.isSafeInteger(clipDurationInFrames) || clipDurationInFrames <= 0) {
    throw new InvalidProgrammableTransitionError(
      "transition clipDurationInFrames must be a positive safe integer."
    );
  }
  const rawProgress = edge === "in"
    ? localFrame / normalized.durationInFrames
    : (localFrame - (clipDurationInFrames - normalized.durationInFrames)) /
      normalized.durationInFrames;
  const progress = Math.min(1, Math.max(0, rawProgress));
  const eased = transitionEasingValue(normalized.easing ?? "linear", progress);
  return edge === "in" ? eased : 1 - eased;
}

export function serializeProgrammableTransition(
  transition: ProgrammableTransition
): string {
  return JSON.stringify(normalizeProgrammableTransition(transition));
}

export function serializeProgrammableTransitions(
  transitions: ProgrammableTransitions
): string {
  return JSON.stringify(normalizeProgrammableTransitions(transitions));
}

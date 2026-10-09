export type ProgrammableEffectErrorCode = "INVALID_PROGRAMMABLE_EFFECT";

export class InvalidProgrammableEffectError extends Error {
  readonly code = "INVALID_PROGRAMMABLE_EFFECT" as const;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ProgrammableBlurEffect {
  readonly kind: "blur";
  /** Blur radius in logical pixels. */
  readonly radius: number;
}

export interface ProgrammableBrightnessEffect {
  readonly kind: "brightness";
  /** Multiplicative brightness factor. 1 is neutral. */
  readonly amount: number;
}

export interface ProgrammableContrastEffect {
  readonly kind: "contrast";
  /** Multiplicative contrast factor. 1 is neutral. */
  readonly amount: number;
}

export interface ProgrammableSaturationEffect {
  readonly kind: "saturation";
  /** Multiplicative saturation factor. 1 is neutral. */
  readonly amount: number;
}

export interface ProgrammableHueEffect {
  readonly kind: "hue";
  /** Hue rotation in degrees. Normalization canonicalizes to [0, 360). */
  readonly degrees: number;
}

export interface ProgrammableGrayscaleEffect {
  readonly kind: "grayscale";
  /** Blend amount from original (0) to fully grayscale (1). */
  readonly amount: number;
}

export interface ProgrammableSepiaEffect {
  readonly kind: "sepia";
  /** Blend amount from original (0) to full sepia (1). */
  readonly amount: number;
}

export interface ProgrammableShadowEffect {
  readonly kind: "shadow";
  readonly offsetX: number;
  readonly offsetY: number;
  /** Shadow blur radius in logical pixels. 0 creates a hard shadow. */
  readonly blur: number;
  readonly color: string;
  readonly opacity?: number;
}

export interface ProgrammableGlowEffect {
  readonly kind: "glow";
  readonly radius: number;
  readonly color: string;
  readonly opacity?: number;
}

export interface ProgrammableNoiseEffect {
  readonly kind: "noise";
  /** Normalized strength from 0 to 1. */
  readonly amount: number;
  /** Deterministic non-negative integer seed. */
  readonly seed?: number;
  readonly monochrome?: boolean;
}

export interface ProgrammableVignetteEffect {
  readonly kind: "vignette";
  /** Normalized strength from 0 to 1. */
  readonly amount: number;
  /** Edge falloff softness from 0 (hard) to 1 (soft). */
  readonly softness?: number;
}

export type ProgrammableEffect =
  | ProgrammableBlurEffect
  | ProgrammableBrightnessEffect
  | ProgrammableContrastEffect
  | ProgrammableSaturationEffect
  | ProgrammableHueEffect
  | ProgrammableGrayscaleEffect
  | ProgrammableSepiaEffect
  | ProgrammableShadowEffect
  | ProgrammableGlowEffect
  | ProgrammableNoiseEffect
  | ProgrammableVignetteEffect;

export type ProgrammableEffectKind = ProgrammableEffect["kind"];

const DEFAULT_NOISE_SEED = 0;
const DEFAULT_VIGNETTE_SOFTNESS = 0.5;

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new InvalidProgrammableEffectError(`${label} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

function assertNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidProgrammableEffectError(`${label} must be a finite number greater than or equal to 0.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidProgrammableEffectError(`${label} must be a finite number between 0 and 1.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InvalidProgrammableEffectError(`${label} cannot be empty.`);
  return normalized;
}

function normalizeDegrees(value: number, label: string): number {
  const finite = assertFinite(value, label);
  const normalized = ((finite % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizeSeed(value: number | undefined, label: string): number {
  const normalized = value ?? DEFAULT_NOISE_SEED;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new InvalidProgrammableEffectError(`${label} must be a non-negative safe integer.`);
  }
  return normalized;
}

export function normalizeProgrammableEffect(effect: ProgrammableEffect): ProgrammableEffect {
  switch (effect.kind) {
    case "blur":
      return Object.freeze({
        kind: "blur",
        radius: assertNonNegative(effect.radius, "effect.blur.radius")
      });

    case "brightness":
      return Object.freeze({
        kind: "brightness",
        amount: assertNonNegative(effect.amount, "effect.brightness.amount")
      });

    case "contrast":
      return Object.freeze({
        kind: "contrast",
        amount: assertNonNegative(effect.amount, "effect.contrast.amount")
      });

    case "saturation":
      return Object.freeze({
        kind: "saturation",
        amount: assertNonNegative(effect.amount, "effect.saturation.amount")
      });

    case "hue":
      return Object.freeze({
        kind: "hue",
        degrees: normalizeDegrees(effect.degrees, "effect.hue.degrees")
      });

    case "grayscale":
      return Object.freeze({
        kind: "grayscale",
        amount: assertUnitInterval(effect.amount, "effect.grayscale.amount")
      });

    case "sepia":
      return Object.freeze({
        kind: "sepia",
        amount: assertUnitInterval(effect.amount, "effect.sepia.amount")
      });

    case "shadow":
      return Object.freeze({
        kind: "shadow",
        offsetX: assertFinite(effect.offsetX, "effect.shadow.offsetX"),
        offsetY: assertFinite(effect.offsetY, "effect.shadow.offsetY"),
        blur: assertNonNegative(effect.blur, "effect.shadow.blur"),
        color: assertNonEmpty(effect.color, "effect.shadow.color"),
        opacity: assertUnitInterval(effect.opacity ?? 1, "effect.shadow.opacity")
      });

    case "glow":
      return Object.freeze({
        kind: "glow",
        radius: assertNonNegative(effect.radius, "effect.glow.radius"),
        color: assertNonEmpty(effect.color, "effect.glow.color"),
        opacity: assertUnitInterval(effect.opacity ?? 1, "effect.glow.opacity")
      });

    case "noise":
      return Object.freeze({
        kind: "noise",
        amount: assertUnitInterval(effect.amount, "effect.noise.amount"),
        seed: normalizeSeed(effect.seed, "effect.noise.seed"),
        monochrome: effect.monochrome ?? false
      });

    case "vignette":
      return Object.freeze({
        kind: "vignette",
        amount: assertUnitInterval(effect.amount, "effect.vignette.amount"),
        softness: assertUnitInterval(
          effect.softness ?? DEFAULT_VIGNETTE_SOFTNESS,
          "effect.vignette.softness"
        )
      });

    default: {
      const exhaustive: never = effect;
      void exhaustive;
      throw new InvalidProgrammableEffectError("effect.kind is not supported.");
    }
  }
}

export function normalizeProgrammableEffects(
  effects: readonly ProgrammableEffect[]
): readonly ProgrammableEffect[] {
  return Object.freeze(effects.map((effect) => normalizeProgrammableEffect(effect)));
}

export function serializeProgrammableEffect(effect: ProgrammableEffect): string {
  return JSON.stringify(normalizeProgrammableEffect(effect));
}

export function serializeProgrammableEffects(effects: readonly ProgrammableEffect[]): string {
  return JSON.stringify(normalizeProgrammableEffects(effects));
}

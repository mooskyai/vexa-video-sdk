export type TimingExtrapolationMode = "extend" | "clamp" | "identity";
export type FrameRoundingMode = "none" | "floor" | "ceil" | "round";
export type TimingEasingFunction = (progress: number) => number;
export type DeterministicRandomSeed = string | number;

export class InvalidProgrammableTimingError extends Error {
  readonly code = "INVALID_PROGRAMMABLE_TIMING" as const;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface FrameContext {
  /** Frame visible to the current sequence or nested scope. */
  readonly frame: number;
  /** Root composition frame. This remains stable through nested offsets/freeze helpers. */
  readonly absoluteFrame: number;
  readonly fps: number;
}

export interface FrameRange {
  readonly startFrame: number;
  readonly durationInFrames: number;
  readonly endFrameExclusive: number;
  readonly lastFrame: number;
}

export interface InterpolateOptions {
  readonly extrapolateLeft?: TimingExtrapolationMode;
  readonly extrapolateRight?: TimingExtrapolationMode;
  readonly easing?: TimingEasingFunction;
}

export interface InterpolateColorOptions {
  readonly extrapolateLeft?: Exclude<TimingExtrapolationMode, "identity">;
  readonly extrapolateRight?: Exclude<TimingExtrapolationMode, "identity">;
  readonly easing?: TimingEasingFunction;
}

export interface SpringOptions {
  readonly frame: number;
  readonly fps: number;
  readonly from?: number;
  readonly to?: number;
  readonly mass?: number;
  readonly stiffness?: number;
  readonly damping?: number;
  /** Initial velocity in output-units per second. */
  readonly velocity?: number;
  readonly overshootClamping?: boolean;
}

export interface SeriesSectionInput {
  readonly id?: string;
  readonly durationInFrames: number;
  /** Relative shift from the previous section end. Negative values overlap sections. */
  readonly offsetFrames?: number;
}

export interface ResolvedSeriesSection extends FrameRange {
  readonly index: number;
  readonly id?: string;
  readonly offsetFrames: number;
}

interface ParsedColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

function fail(message: string): never {
  throw new InvalidProgrammableTimingError(message);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) fail(`${label} must be finite.`);
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) fail(`${label} must be a safe integer.`);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer.`);
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) fail(`${label} must be a finite number greater than 0.`);
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be finite and greater than or equal to 0.`);
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function validateFrameContext(context: Readonly<FrameContext>): void {
  assertInteger(context.frame, "context.frame");
  assertInteger(context.absoluteFrame, "context.absoluteFrame");
  if (context.absoluteFrame < 0) fail("context.absoluteFrame must be greater than or equal to 0.");
  assertPositiveFinite(context.fps, "context.fps");
}

export function createFrameContext(frame: number, fps: number): Readonly<FrameContext> {
  assertInteger(frame, "frame");
  if (frame < 0) fail("frame must be greater than or equal to 0 at the root composition level.");
  assertPositiveFinite(fps, "fps");
  return freeze({ frame, absoluteFrame: frame, fps });
}

/**
 * Creates a nested timing scope. Local frames may be negative before the nested
 * section begins; absoluteFrame always continues to identify the root frame.
 */
export function offsetFrameContext(
  context: Readonly<FrameContext>,
  offsetFrames: number
): Readonly<FrameContext> {
  validateFrameContext(context);
  assertInteger(offsetFrames, "offsetFrames");
  return freeze({
    frame: context.frame - offsetFrames,
    absoluteFrame: context.absoluteFrame,
    fps: context.fps
  });
}

/** Makes child evaluation observe one fixed local frame while root time continues. */
export function freezeFrameContext(
  context: Readonly<FrameContext>,
  frame: number
): Readonly<FrameContext> {
  validateFrameContext(context);
  assertInteger(frame, "frozen frame");
  return freeze({ frame, absoluteFrame: context.absoluteFrame, fps: context.fps });
}

export function frameToSeconds(frame: number, fps: number): number {
  assertFinite(frame, "frame");
  assertPositiveFinite(fps, "fps");
  return frame / fps;
}

export function secondsToFrame(
  seconds: number,
  fps: number,
  rounding: FrameRoundingMode = "round"
): number {
  assertFinite(seconds, "seconds");
  assertPositiveFinite(fps, "fps");
  const exact = seconds * fps;
  assertFinite(exact, "converted frame");
  switch (rounding) {
    case "none": return exact;
    case "floor": return Math.floor(exact);
    case "ceil": return Math.ceil(exact);
    case "round": return Math.round(exact);
    default: return fail(`Unsupported frame rounding mode: ${String(rounding)}.`);
  }
}

export function createFrameRange(startFrame: number, durationInFrames: number): Readonly<FrameRange> {
  assertInteger(startFrame, "startFrame");
  assertPositiveInteger(durationInFrames, "durationInFrames");
  const endFrameExclusive = startFrame + durationInFrames;
  assertInteger(endFrameExclusive, "endFrameExclusive");
  return freeze({
    startFrame,
    durationInFrames,
    endFrameExclusive,
    lastFrame: endFrameExclusive - 1
  });
}

export function frameRangeContains(range: Readonly<FrameRange>, frame: number): boolean {
  assertInteger(frame, "frame");
  return frame >= range.startFrame && frame < range.endFrameExclusive;
}

export function frameRangeLocalFrame(range: Readonly<FrameRange>, frame: number): number {
  assertInteger(frame, "frame");
  return frame - range.startFrame;
}

export function clampFrameToRange(range: Readonly<FrameRange>, frame: number): number {
  assertInteger(frame, "frame");
  return Math.min(range.lastFrame, Math.max(range.startFrame, frame));
}

export const linearEasing: TimingEasingFunction = (progress) => progress;
export const easeInQuad: TimingEasingFunction = (progress) => progress * progress;
export const easeOutQuad: TimingEasingFunction = (progress) => 1 - ((1 - progress) * (1 - progress));
export const easeInOutQuad: TimingEasingFunction = (progress) => (
  progress < 0.5
    ? 2 * progress * progress
    : 1 - (((-2 * progress) + 2) ** 2) / 2
);

function validateRanges(
  inputRange: readonly number[],
  outputRange: readonly number[]
): void {
  if (inputRange.length < 2) fail("inputRange must contain at least two values.");
  if (inputRange.length !== outputRange.length) {
    fail("inputRange and outputRange must contain the same number of values.");
  }

  for (let index = 0; index < inputRange.length; index += 1) {
    const input = inputRange[index]!;
    const output = outputRange[index]!;
    assertFinite(input, `inputRange[${index}]`);
    assertFinite(output, `outputRange[${index}]`);
    if (index > 0 && input <= inputRange[index - 1]!) {
      fail("inputRange values must be strictly increasing.");
    }
  }
}

function applyExtrapolation(
  input: number,
  edgeInput: number,
  edgeOutput: number,
  mode: TimingExtrapolationMode
): number | undefined {
  switch (mode) {
    case "clamp": return edgeOutput;
    case "identity": return input;
    case "extend": return undefined;
    default: return fail(`Unsupported extrapolation mode: ${String(mode)}.`);
  }
}

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {}
): number {
  assertFinite(input, "input");
  validateRanges(inputRange, outputRange);

  const leftMode = options.extrapolateLeft ?? "extend";
  const rightMode = options.extrapolateRight ?? "extend";
  const firstInput = inputRange[0]!;
  const lastInput = inputRange[inputRange.length - 1]!;

  if (input < firstInput) {
    const result = applyExtrapolation(input, firstInput, outputRange[0]!, leftMode);
    if (result !== undefined) return result;
  }
  if (input > lastInput) {
    const result = applyExtrapolation(input, lastInput, outputRange[outputRange.length - 1]!, rightMode);
    if (result !== undefined) return result;
  }

  let segment = inputRange.length - 2;
  for (let index = 0; index < inputRange.length - 1; index += 1) {
    if (input <= inputRange[index + 1]!) {
      segment = index;
      break;
    }
  }

  const inputStart = inputRange[segment]!;
  const inputEnd = inputRange[segment + 1]!;
  const outputStart = outputRange[segment]!;
  const outputEnd = outputRange[segment + 1]!;
  const rawProgress = (input - inputStart) / (inputEnd - inputStart);
  const easing = options.easing ?? linearEasing;
  const progress = easing(rawProgress);
  assertFinite(progress, "easing result");
  return outputStart + ((outputEnd - outputStart) * progress);
}

function parseHexColor(color: string): ParsedColor | null {
  if (!/^#[0-9a-f]+$/i.test(color)) return null;
  const hex = color.slice(1);
  if (![3, 4, 6, 8].includes(hex.length)) return null;

  const expanded = hex.length <= 4
    ? [...hex].map((character) => character + character).join("")
    : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const alpha = expanded.length === 8
    ? Number.parseInt(expanded.slice(6, 8), 16) / 255
    : 1;
  return { red, green, blue, alpha };
}

function parseFunctionalColor(color: string): ParsedColor | null {
  const match = /^rgba?\(\s*([^)]*)\s*\)$/i.exec(color);
  if (!match) return null;
  const parts = match[1]!.split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [red, green, blue] = values;
  const alpha = values[3] ?? 1;
  if (
    red === undefined || green === undefined || blue === undefined ||
    red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255 ||
    alpha < 0 || alpha > 1
  ) return null;
  return { red, green, blue, alpha };
}

function parseColor(color: string): ParsedColor {
  const normalized = color.trim();
  const parsed = parseHexColor(normalized) ?? parseFunctionalColor(normalized);
  if (!parsed) {
    return fail(
      `Unsupported color "${color}". Use #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), or rgba().`
    );
  }
  return parsed;
}

function formatAlpha(alpha: number): string {
  const rounded = Math.round(alpha * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function formatColor(color: ParsedColor): string {
  const red = Math.round(Math.min(255, Math.max(0, color.red)));
  const green = Math.round(Math.min(255, Math.max(0, color.green)));
  const blue = Math.round(Math.min(255, Math.max(0, color.blue)));
  const alpha = Math.min(1, Math.max(0, color.alpha));
  return `rgba(${red}, ${green}, ${blue}, ${formatAlpha(alpha)})`;
}

export function interpolateColor(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly string[],
  options: InterpolateColorOptions = {}
): string {
  assertFinite(input, "input");
  if (inputRange.length < 2) fail("inputRange must contain at least two values.");
  if (inputRange.length !== outputRange.length) {
    fail("inputRange and outputRange must contain the same number of values.");
  }
  const colors = outputRange.map(parseColor);
  const numericProbe = outputRange.map((_, index) => index);
  validateRanges(inputRange, numericProbe);

  const channelOptions: InterpolateOptions = {
    extrapolateLeft: options.extrapolateLeft ?? "extend",
    extrapolateRight: options.extrapolateRight ?? "extend",
    ...(options.easing ? { easing: options.easing } : {})
  };

  return formatColor({
    red: interpolate(input, inputRange, colors.map((color) => color.red), channelOptions),
    green: interpolate(input, inputRange, colors.map((color) => color.green), channelOptions),
    blue: interpolate(input, inputRange, colors.map((color) => color.blue), channelOptions),
    alpha: interpolate(input, inputRange, colors.map((color) => color.alpha), channelOptions)
  });
}

export function spring(options: SpringOptions): number {
  assertNonNegativeFinite(options.frame, "spring.frame");
  assertPositiveFinite(options.fps, "spring.fps");
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  const mass = options.mass ?? 1;
  const stiffness = options.stiffness ?? 100;
  const damping = options.damping ?? 10;
  const velocity = options.velocity ?? 0;
  assertFinite(from, "spring.from");
  assertFinite(to, "spring.to");
  assertPositiveFinite(mass, "spring.mass");
  assertPositiveFinite(stiffness, "spring.stiffness");
  assertNonNegativeFinite(damping, "spring.damping");
  assertFinite(velocity, "spring.velocity");

  if (options.frame === 0 || (from === to && velocity === 0)) return from;

  const time = options.frame / options.fps;
  const naturalFrequency = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const initialDisplacement = from - to;
  let displacement: number;

  if (dampingRatio < 1 - 1e-12) {
    const dampedFrequency = naturalFrequency * Math.sqrt(1 - (dampingRatio ** 2));
    const coefficient = (
      velocity + (dampingRatio * naturalFrequency * initialDisplacement)
    ) / dampedFrequency;
    displacement = Math.exp(-dampingRatio * naturalFrequency * time) * (
      (initialDisplacement * Math.cos(dampedFrequency * time)) +
      (coefficient * Math.sin(dampedFrequency * time))
    );
  } else if (dampingRatio > 1 + 1e-12) {
    const ratioRoot = Math.sqrt((dampingRatio ** 2) - 1);
    const rootOne = -naturalFrequency * (dampingRatio - ratioRoot);
    const rootTwo = -naturalFrequency * (dampingRatio + ratioRoot);
    const coefficientOne = (velocity - (rootTwo * initialDisplacement)) / (rootOne - rootTwo);
    const coefficientTwo = initialDisplacement - coefficientOne;
    displacement = (coefficientOne * Math.exp(rootOne * time)) +
      (coefficientTwo * Math.exp(rootTwo * time));
  } else {
    displacement = Math.exp(-naturalFrequency * time) * (
      initialDisplacement + ((velocity + (naturalFrequency * initialDisplacement)) * time)
    );
  }

  let value = to + displacement;
  if (options.overshootClamping) {
    if (from < to) value = Math.min(to, value);
    if (from > to) value = Math.max(to, value);
  }
  return value;
}

function stableSeedText(seed: DeterministicRandomSeed, index: number): string {
  if (typeof seed === "number") {
    assertFinite(seed, "seed");
  }
  assertInteger(index, "random index");
  return `${typeof seed}:${Object.is(seed, -0) ? "-0" : String(seed)}:${index}`;
}

/** FNV-1a plus an integer avalanche; all operations are explicit unsigned 32-bit math. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function seededRandom(seed: DeterministicRandomSeed, index = 0): number {
  let state = hashSeed(stableSeedText(seed, index));
  state = (state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

export function loopFrame(frame: number, durationInFrames: number): number {
  assertInteger(frame, "frame");
  assertPositiveInteger(durationInFrames, "durationInFrames");
  return ((frame % durationInFrames) + durationInFrames) % durationInFrames;
}

export function loopFrameContext(
  context: Readonly<FrameContext>,
  durationInFrames: number
): Readonly<FrameContext> {
  validateFrameContext(context);
  return freeze({
    frame: loopFrame(context.frame, durationInFrames),
    absoluteFrame: context.absoluteFrame,
    fps: context.fps
  });
}

export function resolveSeries(
  sections: readonly SeriesSectionInput[]
): readonly Readonly<ResolvedSeriesSection>[] {
  let previousEnd = 0;
  const ids = new Set<string>();
  const resolved = sections.map((section, index) => {
    assertPositiveInteger(section.durationInFrames, `sections[${index}].durationInFrames`);
    const offsetFrames = section.offsetFrames ?? 0;
    assertInteger(offsetFrames, `sections[${index}].offsetFrames`);
    if (section.id !== undefined) {
      if (!section.id.trim()) fail(`sections[${index}].id cannot be empty.`);
      if (ids.has(section.id)) fail(`Duplicate series section id: ${section.id}.`);
      ids.add(section.id);
    }

    const range = createFrameRange(previousEnd + offsetFrames, section.durationInFrames);
    previousEnd = range.endFrameExclusive;
    return freeze({
      index,
      ...(section.id !== undefined ? { id: section.id } : {}),
      offsetFrames,
      ...range
    });
  });
  return Object.freeze(resolved);
}

export function seriesSectionAtFrame(
  sections: readonly Readonly<ResolvedSeriesSection>[],
  frame: number
): readonly Readonly<ResolvedSeriesSection>[] {
  assertInteger(frame, "frame");
  return sections.filter((section) => frameRangeContains(section, frame));
}

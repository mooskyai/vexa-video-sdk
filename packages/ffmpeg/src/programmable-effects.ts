import { InvalidProjectError, type ProgrammableEffect } from "@vexa-video/core";

const MAX_GBLUR_SIGMA = 1024;
const MAX_NOISE_SEED = 2_147_483_645;

function formatEffectNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.isInteger(normalized)
    ? String(normalized)
    : String(Number(normalized.toFixed(6)));
}

interface ColorMatrix {
  readonly rr: number;
  readonly rg: number;
  readonly rb: number;
  readonly gr: number;
  readonly gg: number;
  readonly gb: number;
  readonly br: number;
  readonly bg: number;
  readonly bb: number;
}

function colorMatrixFilter(matrix: ColorMatrix): string {
  const options = [
    `rr=${formatEffectNumber(matrix.rr)}`,
    `rg=${formatEffectNumber(matrix.rg)}`,
    `rb=${formatEffectNumber(matrix.rb)}`,
    `gr=${formatEffectNumber(matrix.gr)}`,
    `gg=${formatEffectNumber(matrix.gg)}`,
    `gb=${formatEffectNumber(matrix.gb)}`,
    `br=${formatEffectNumber(matrix.br)}`,
    `bg=${formatEffectNumber(matrix.bg)}`,
    `bb=${formatEffectNumber(matrix.bb)}`
  ];
  return `colorchannelmixer=${options.join(":")}`;
}

function saturationFilter(amount: number, clipId: string): string {
  if (amount > 2) {
    throw new InvalidProjectError(
      `clip ${clipId}.effects saturation amount cannot exceed 2 in the FFmpeg color-matrix backend.`
    );
  }
  return colorMatrixFilter({
    rr: 0.2126 + (0.7874 * amount),
    rg: 0.7152 - (0.7152 * amount),
    rb: 0.0722 - (0.0722 * amount),
    gr: 0.2126 - (0.2126 * amount),
    gg: 0.7152 + (0.2848 * amount),
    gb: 0.0722 - (0.0722 * amount),
    br: 0.2126 - (0.2126 * amount),
    bg: 0.7152 - (0.7152 * amount),
    bb: 0.0722 + (0.9278 * amount)
  });
}

function grayscaleFilter(amount: number): string {
  return colorMatrixFilter({
    rr: 1 - (0.7874 * amount),
    rg: 0.7152 * amount,
    rb: 0.0722 * amount,
    gr: 0.2126 * amount,
    gg: 1 - (0.2848 * amount),
    gb: 0.0722 * amount,
    br: 0.2126 * amount,
    bg: 0.7152 * amount,
    bb: 1 - (0.9278 * amount)
  });
}

function sepiaFilter(amount: number): string {
  return colorMatrixFilter({
    rr: 1 - (0.607 * amount),
    rg: 0.769 * amount,
    rb: 0.189 * amount,
    gr: 0.349 * amount,
    gg: 1 - (0.314 * amount),
    gb: 0.168 * amount,
    br: 0.272 * amount,
    bg: 0.534 * amount,
    bb: 1 - (0.869 * amount)
  });
}

function noiseFilters(
  effect: Extract<ProgrammableEffect, { kind: "noise" }>,
  clipId: string
): readonly string[] {
  if (effect.amount === 0) return [];
  const seed = effect.seed ?? 0;
  if (seed > MAX_NOISE_SEED) {
    throw new InvalidProjectError(
      `clip ${clipId}.effects noise seed cannot exceed ${MAX_NOISE_SEED} in the FFmpeg backend.`
    );
  }
  const strength = Math.max(1, Math.round(effect.amount * 100));
  const seeds = effect.monochrome
    ? [seed, seed, seed]
    : [seed, seed + 1, seed + 2];
  const options = [
    `c0s=${strength}`,
    `c1s=${strength}`,
    `c2s=${strength}`,
    `c0_seed=${seeds[0]}`,
    `c1_seed=${seeds[1]}`,
    `c2_seed=${seeds[2]}`,
    "c0f=u",
    "c1f=u",
    "c2f=u"
  ];
  return [
    "format=gbrap",
    `noise=${options.join(":")}`,
    "format=rgba"
  ];
}

function vignetteFilter(
  effect: Extract<ProgrammableEffect, { kind: "vignette" }>
): string | null {
  if (effect.amount === 0) return null;
  const amount = formatEffectNumber(effect.amount);
  const softnessValue = effect.softness ?? 0.5;
  const distance = "sqrt(((X-W/2)/(W/2))*((X-W/2)/(W/2))+((Y-H/2)/(H/2))*((Y-H/2)/(H/2)))";
  let factor: string;
  if (softnessValue === 0) {
    factor = `if(gte(${distance},1),${formatEffectNumber(1 - effect.amount)},1)`;
  } else {
    const softness = formatEffectNumber(softnessValue);
    const inner = formatEffectNumber(1 - softnessValue);
    const progress = `clip((${distance}-${inner})/${softness},0,1)`;
    const smooth = `((${progress})*(${progress})*(3-2*(${progress})))`;
    factor = `(1-${amount}*${smooth})`;
  }
  return `geq=r='r(X,Y)*${factor}':g='g(X,Y)*${factor}':b='b(X,Y)*${factor}':a='alpha(X,Y)'`;
}

export function compileProgrammableEffectFilters(
  effects: readonly ProgrammableEffect[] | undefined,
  clipId: string
): readonly string[] {
  if (!effects?.length) return [];
  const filters: string[] = [];

  for (const effect of effects) {
    switch (effect.kind) {
      case "blur":
        if (effect.radius === 0) break;
        if (effect.radius > MAX_GBLUR_SIGMA) {
          throw new InvalidProjectError(
            `clip ${clipId}.effects blur radius cannot exceed ${MAX_GBLUR_SIGMA} in the FFmpeg backend.`
          );
        }
        filters.push(`gblur=sigma=${formatEffectNumber(effect.radius)}:steps=2`);
        break;

      case "brightness":
        if (effect.amount === 1) break;
        filters.push(
          `lutrgb=r='clip(val*${formatEffectNumber(effect.amount)},minval,maxval)':g='clip(val*${formatEffectNumber(effect.amount)},minval,maxval)':b='clip(val*${formatEffectNumber(effect.amount)},minval,maxval)'`
        );
        break;

      case "contrast":
        if (effect.amount === 1) break;
        filters.push(
          `lutrgb=r='clip((val-maxval/2)*${formatEffectNumber(effect.amount)}+maxval/2,minval,maxval)':g='clip((val-maxval/2)*${formatEffectNumber(effect.amount)}+maxval/2,minval,maxval)':b='clip((val-maxval/2)*${formatEffectNumber(effect.amount)}+maxval/2,minval,maxval)'`
        );
        break;

      case "saturation":
        if (effect.amount === 1) break;
        filters.push(saturationFilter(effect.amount, clipId));
        break;

      case "hue":
        if (effect.degrees === 0) break;
        filters.push(`hue=h=${formatEffectNumber(effect.degrees)}`);
        break;

      case "grayscale":
        if (effect.amount === 0) break;
        filters.push(grayscaleFilter(effect.amount));
        break;

      case "sepia":
        if (effect.amount === 0) break;
        filters.push(sepiaFilter(effect.amount));
        break;

      case "noise":
        filters.push(...noiseFilters(effect, clipId));
        break;

      case "vignette": {
        const filter = vignetteFilter(effect);
        if (filter) filters.push(filter);
        break;
      }

      case "shadow":
      case "glow":
        throw new InvalidProjectError(
          `clip ${clipId}.effects ${effect.kind} requires compositor branch execution and is not supported by the linear FFmpeg effect path yet.`
        );

      default: {
        const exhaustive: never = effect;
        void exhaustive;
        throw new InvalidProjectError(`clip ${clipId}.effects contains an unsupported effect.`);
      }
    }
  }

  return filters;
}

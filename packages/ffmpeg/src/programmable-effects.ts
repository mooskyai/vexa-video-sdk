import { InvalidProjectError, type ProgrammableEffect } from "@vexa-video/core";

const MAX_GBLUR_SIGMA = 1024;
const MAX_NOISE_SEED = 2_147_483_645;
const MAX_EFFECT_PADDING = 4096;

export interface ProgrammableEffectPadding {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const ZERO_PADDING: ProgrammableEffectPadding = Object.freeze({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0
});

function formatEffectNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.isInteger(normalized)
    ? String(normalized)
    : String(Number(normalized.toFixed(6)));
}

function assertBlurRadius(value: number, clipId: string, kind: "blur" | "shadow" | "glow"): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_GBLUR_SIGMA) {
    throw new InvalidProjectError(
      `clip ${clipId}.effects ${kind} radius cannot exceed ${MAX_GBLUR_SIGMA} in the FFmpeg backend.`
    );
  }
}

function compositorColorToken(value: string, clipId: string, kind: "shadow" | "glow"): string {
  if (!value || !/^[a-zA-Z0-9#._-]+$/u.test(value) || value.toLowerCase() === "transparent") {
    throw new InvalidProjectError(
      `clip ${clipId}.effects ${kind} color is not supported by the FFmpeg compositor backend.`
    );
  }
  return value;
}

function compositorLabel(clipId: string, effectIndex: number): string {
  const safeClip = clipId.replace(/[^a-zA-Z0-9_]/gu, "_").slice(0, 48) || "clip";
  return `vexa_fx_${safeClip}_${effectIndex}`;
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

function alphaMaskFilters(opacity: number, blur: number, clipId: string, kind: "shadow" | "glow"): string[] {
  assertBlurRadius(blur, clipId, kind);
  const filters = ["alphaextract"];
  if (opacity < 1) filters.push(`lut=y='val*${formatEffectNumber(opacity)}'`);
  if (blur > 0) filters.push(`gblur=sigma=${formatEffectNumber(blur)}:steps=2`);
  return filters;
}

function shadowCompositorFilter(
  effect: Extract<ProgrammableEffect, { kind: "shadow" }>,
  clipId: string,
  effectIndex: number
): string | null {
  const opacity = effect.opacity ?? 1;
  if (opacity === 0) return null;
  const color = compositorColorToken(effect.color, clipId, "shadow");
  const stem = compositorLabel(clipId, effectIndex);
  const mask = alphaMaskFilters(opacity, effect.blur, clipId, "shadow").join(",");
  return [
    `split=4[${stem}_orig][${stem}_color_src][${stem}_alpha_src][${stem}_blank_src]`,
    `[${stem}_color_src]drawbox=x=0:y=0:w=iw:h=ih:color=${color}:t=fill:replace=1[${stem}_color]`,
    `[${stem}_alpha_src]${mask}[${stem}_mask]`,
    `[${stem}_color][${stem}_mask]alphamerge[${stem}_shadow]`,
    `[${stem}_blank_src]colorchannelmixer=aa=0[${stem}_blank]`,
    `[${stem}_blank][${stem}_shadow]overlay=x=${formatEffectNumber(effect.offsetX)}:y=${formatEffectNumber(effect.offsetY)}:eof_action=pass:shortest=1:format=auto[${stem}_placed]`,
    `[${stem}_placed][${stem}_orig]overlay=x=0:y=0:eof_action=pass:shortest=1:format=auto`
  ].join(";");
}

function glowCompositorFilter(
  effect: Extract<ProgrammableEffect, { kind: "glow" }>,
  clipId: string,
  effectIndex: number
): string | null {
  const opacity = effect.opacity ?? 1;
  if (opacity === 0) return null;
  const color = compositorColorToken(effect.color, clipId, "glow");
  const stem = compositorLabel(clipId, effectIndex);
  const mask = alphaMaskFilters(opacity, effect.radius, clipId, "glow").join(",");
  return [
    `split=3[${stem}_orig][${stem}_color_src][${stem}_alpha_src]`,
    `[${stem}_color_src]drawbox=x=0:y=0:w=iw:h=ih:color=${color}:t=fill:replace=1[${stem}_color]`,
    `[${stem}_alpha_src]${mask}[${stem}_mask]`,
    `[${stem}_color][${stem}_mask]alphamerge[${stem}_glow]`,
    `[${stem}_glow][${stem}_orig]overlay=x=0:y=0:eof_action=pass:shortest=1:format=auto`
  ].join(";");
}

function addPadding(
  padding: { left: number; right: number; top: number; bottom: number },
  additions: ProgrammableEffectPadding,
  clipId: string
): void {
  padding.left += additions.left;
  padding.right += additions.right;
  padding.top += additions.top;
  padding.bottom += additions.bottom;
  if (Math.max(padding.left, padding.right, padding.top, padding.bottom) > MAX_EFFECT_PADDING) {
    throw new InvalidProjectError(
      `clip ${clipId}.effects requires more than ${MAX_EFFECT_PADDING}px compositor padding on one side.`
    );
  }
}

export function programmableEffectPadding(
  effects: readonly ProgrammableEffect[] | undefined,
  clipId: string
): ProgrammableEffectPadding {
  if (!effects?.length) return ZERO_PADDING;
  const padding = { left: 0, right: 0, top: 0, bottom: 0 };

  for (const effect of effects) {
    if (effect.kind === "glow") {
      if ((effect.opacity ?? 1) === 0 || effect.radius === 0) continue;
      assertBlurRadius(effect.radius, clipId, "glow");
      const extent = Math.ceil(effect.radius * 3);
      addPadding(padding, { left: extent, right: extent, top: extent, bottom: extent }, clipId);
      continue;
    }
    if (effect.kind === "shadow") {
      if ((effect.opacity ?? 1) === 0) continue;
      assertBlurRadius(effect.blur, clipId, "shadow");
      const extent = Math.ceil(effect.blur * 3);
      addPadding(padding, {
        left: extent + Math.ceil(Math.max(0, -effect.offsetX)),
        right: extent + Math.ceil(Math.max(0, effect.offsetX)),
        top: extent + Math.ceil(Math.max(0, -effect.offsetY)),
        bottom: extent + Math.ceil(Math.max(0, effect.offsetY))
      }, clipId);
    }
  }

  return Object.freeze(padding);
}

export function hasProgrammableCompositorEffects(
  effects: readonly ProgrammableEffect[] | undefined
): boolean {
  return Boolean(effects?.some((effect) =>
    (effect.kind === "shadow" || effect.kind === "glow") && (effect.opacity ?? 1) > 0
  ));
}

export function compileProgrammableEffectFilters(
  effects: readonly ProgrammableEffect[] | undefined,
  clipId: string
): readonly string[] {
  if (!effects?.length) return [];
  const filters: string[] = [];

  for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
    const effect = effects[effectIndex]!;
    switch (effect.kind) {
      case "blur":
        if (effect.radius === 0) break;
        assertBlurRadius(effect.radius, clipId, "blur");
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

      case "shadow": {
        const filter = shadowCompositorFilter(effect, clipId, effectIndex);
        if (filter) filters.push(filter);
        break;
      }

      case "glow": {
        const filter = glowCompositorFilter(effect, clipId, effectIndex);
        if (filter) filters.push(filter);
        break;
      }

      default: {
        const exhaustive: never = effect;
        void exhaustive;
        throw new InvalidProjectError(`clip ${clipId}.effects contains an unsupported effect.`);
      }
    }
  }

  return filters;
}

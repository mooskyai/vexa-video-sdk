import type {
  ProgrammableSceneAsset,
  ProgrammableSceneAssetSource,
  ProgrammableSceneAudioNode,
  ProgrammableScenePreloadMode
} from "@vexa-video/core";

export type VexaSoundEffectErrorCode =
  | "INVALID_SOUND_EFFECT_LIBRARY"
  | "INVALID_SOUND_EFFECT_INSTANCE"
  | "SOUND_EFFECT_NOT_FOUND";

export class VexaSoundEffectError extends Error {
  readonly code: VexaSoundEffectErrorCode;
  readonly effectId?: string;

  constructor(
    message: string,
    code: VexaSoundEffectErrorCode,
    options: { readonly effectId?: string } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.effectId !== undefined) this.effectId = options.effectId;
  }
}

export interface VexaSoundEffectDefinition {
  readonly source: ProgrammableSceneAssetSource;
  readonly preload?: ProgrammableScenePreloadMode;
  readonly sourceStartSeconds?: number;
  readonly playbackRate?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

export type VexaSoundEffectInput = ProgrammableSceneAssetSource | VexaSoundEffectDefinition;

export interface VexaSoundEffectLibraryOptions {
  readonly effects: Readonly<Record<string, VexaSoundEffectInput>>;
  readonly assetIdPrefix?: string;
}

export interface VexaSoundEffectInstanceOptions {
  readonly id: string;
  readonly startFrame?: number;
  readonly durationInFrames?: number;
  readonly sourceStartSeconds?: number;
  readonly playbackRate?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

export interface VexaSoundEffectLibrary {
  readonly effectIds: readonly string[];
  readonly assets: readonly ProgrammableSceneAsset[];

  has(effectId: string): boolean;
  getAsset(effectId: string): ProgrammableSceneAsset;
  createNode(effectId: string, options: VexaSoundEffectInstanceOptions): ProgrammableSceneAudioNode;
}

interface NormalizedSoundEffectDefinition {
  readonly effectId: string;
  readonly asset: ProgrammableSceneAsset;
  readonly sourceStartSeconds?: number;
  readonly playbackRate?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyText(
  value: unknown,
  label: string,
  code: Extract<VexaSoundEffectErrorCode, "INVALID_SOUND_EFFECT_LIBRARY" | "INVALID_SOUND_EFFECT_INSTANCE">,
  effectId?: string
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new VexaSoundEffectError(
      `${label} must be a non-empty string.`,
      code,
      effectId === undefined ? {} : { effectId }
    );
  }
  return value.trim();
}

function assertNonNegativeFinite(
  value: number | undefined,
  label: string,
  code: Extract<VexaSoundEffectErrorCode, "INVALID_SOUND_EFFECT_LIBRARY" | "INVALID_SOUND_EFFECT_INSTANCE">,
  effectId?: string
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new VexaSoundEffectError(
      `${label} must be a finite number greater than or equal to 0.`,
      code,
      effectId === undefined ? {} : { effectId }
    );
  }
  return value;
}

function assertPositiveFinite(
  value: number | undefined,
  label: string,
  code: Extract<VexaSoundEffectErrorCode, "INVALID_SOUND_EFFECT_LIBRARY" | "INVALID_SOUND_EFFECT_INSTANCE">,
  effectId?: string
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new VexaSoundEffectError(
      `${label} must be a finite number greater than 0.`,
      code,
      effectId === undefined ? {} : { effectId }
    );
  }
  return value;
}

function assertNonNegativeInteger(value: number | undefined, label: string, effectId: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VexaSoundEffectError(
      `${label} must be a safe integer greater than or equal to 0.`,
      "INVALID_SOUND_EFFECT_INSTANCE",
      { effectId }
    );
  }
  return value;
}

function assertPositiveInteger(value: number | undefined, label: string, effectId: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new VexaSoundEffectError(
      `${label} must be a positive safe integer.`,
      "INVALID_SOUND_EFFECT_INSTANCE",
      { effectId }
    );
  }
  return value;
}

function normalizePreload(value: ProgrammableScenePreloadMode | undefined, effectId: string): ProgrammableScenePreloadMode | undefined {
  if (value === undefined) return undefined;
  if (value !== "auto" && value !== "metadata" && value !== "none") {
    throw new VexaSoundEffectError(
      `Sound effect "${effectId}" preload is not supported.`,
      "INVALID_SOUND_EFFECT_LIBRARY",
      { effectId }
    );
  }
  return value;
}

function normalizeSource(source: ProgrammableSceneAssetSource, effectId: string): ProgrammableSceneAssetSource {
  if (!isRecord(source)) {
    throw new VexaSoundEffectError(
      `Sound effect "${effectId}" source must be an asset source object.`,
      "INVALID_SOUND_EFFECT_LIBRARY",
      { effectId }
    );
  }

  if (source.kind === "static") {
    const src = assertNonEmptyText(
      source.src,
      `Sound effect "${effectId}" static source`,
      "INVALID_SOUND_EFFECT_LIBRARY",
      effectId
    );
    return Object.freeze({ kind: "static", src });
  }

  if (source.kind === "storage") {
    if (!isRecord(source.source)) {
      throw new VexaSoundEffectError(
        `Sound effect "${effectId}" storage source must be an object.`,
        "INVALID_SOUND_EFFECT_LIBRARY",
        { effectId }
      );
    }
    return Object.freeze({ kind: "storage", source: source.source });
  }

  throw new VexaSoundEffectError(
    `Sound effect "${effectId}" source kind is not supported.`,
    "INVALID_SOUND_EFFECT_LIBRARY",
    { effectId }
  );
}

function normalizeDefinitionInput(input: VexaSoundEffectInput, effectId: string): NormalizedSoundEffectDefinition {
  if (!isRecord(input)) {
    throw new VexaSoundEffectError(
      `Sound effect "${effectId}" definition must be an object.`,
      "INVALID_SOUND_EFFECT_LIBRARY",
      { effectId }
    );
  }

  const isDirectSource = input.kind === "static" || input.kind === "storage";
  const definition = isDirectSource ? undefined : input as unknown as VexaSoundEffectDefinition;
  const source = normalizeSource(
    (isDirectSource ? input : definition?.source) as ProgrammableSceneAssetSource,
    effectId
  );
  const preload = normalizePreload(definition?.preload, effectId);
  const sourceStartSeconds = assertNonNegativeFinite(
    definition?.sourceStartSeconds,
    `Sound effect "${effectId}" sourceStartSeconds`,
    "INVALID_SOUND_EFFECT_LIBRARY",
    effectId
  );
  const playbackRate = assertPositiveFinite(
    definition?.playbackRate,
    `Sound effect "${effectId}" playbackRate`,
    "INVALID_SOUND_EFFECT_LIBRARY",
    effectId
  );
  const volume = assertNonNegativeFinite(
    definition?.volume,
    `Sound effect "${effectId}" volume`,
    "INVALID_SOUND_EFFECT_LIBRARY",
    effectId
  );
  if (definition?.muted !== undefined && typeof definition.muted !== "boolean") {
    throw new VexaSoundEffectError(
      `Sound effect "${effectId}" muted must be boolean when provided.`,
      "INVALID_SOUND_EFFECT_LIBRARY",
      { effectId }
    );
  }

  return {
    effectId,
    asset: Object.freeze({
      id: "",
      kind: "audio",
      source,
      ...(preload !== undefined ? { preload } : {})
    }),
    ...(sourceStartSeconds !== undefined ? { sourceStartSeconds } : {}),
    ...(playbackRate !== undefined ? { playbackRate } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(definition?.muted !== undefined ? { muted: definition.muted } : {})
  };
}

function normalizeLookupId(effectId: string): string {
  if (typeof effectId !== "string") return "";
  return effectId.trim();
}

export function createSoundEffectLibrary(options: VexaSoundEffectLibraryOptions): VexaSoundEffectLibrary {
  if (!options || typeof options !== "object" || !isRecord(options.effects)) {
    throw new VexaSoundEffectError(
      "Sound effect library options require an effects map.",
      "INVALID_SOUND_EFFECT_LIBRARY"
    );
  }

  const assetIdPrefix = options.assetIdPrefix === undefined
    ? "sfx."
    : assertNonEmptyText(options.assetIdPrefix, "assetIdPrefix", "INVALID_SOUND_EFFECT_LIBRARY");
  const definitions = new Map<string, NormalizedSoundEffectDefinition>();

  for (const [rawEffectId, input] of Object.entries(options.effects)) {
    const effectId = assertNonEmptyText(
      rawEffectId,
      "sound effect id",
      "INVALID_SOUND_EFFECT_LIBRARY"
    );
    if (definitions.has(effectId)) {
      throw new VexaSoundEffectError(
        `Sound effect id "${effectId}" is duplicated after normalization.`,
        "INVALID_SOUND_EFFECT_LIBRARY",
        { effectId }
      );
    }

    const normalized = normalizeDefinitionInput(input, effectId);
    definitions.set(effectId, Object.freeze({
      ...normalized,
      asset: Object.freeze({
        ...normalized.asset,
        id: `${assetIdPrefix}${effectId}`
      })
    }));
  }

  if (definitions.size === 0) {
    throw new VexaSoundEffectError(
      "Sound effect library must contain at least one effect.",
      "INVALID_SOUND_EFFECT_LIBRARY"
    );
  }

  const effectIds = Object.freeze([...definitions.keys()].sort());
  const assets = Object.freeze(effectIds.map((effectId) => definitions.get(effectId)!.asset));

  const lookup = (effectId: string): NormalizedSoundEffectDefinition => {
    const normalizedId = normalizeLookupId(effectId);
    const definition = definitions.get(normalizedId);
    if (!definition) {
      throw new VexaSoundEffectError(
        `Sound effect "${normalizedId || effectId}" is not registered.`,
        "SOUND_EFFECT_NOT_FOUND",
        normalizedId ? { effectId: normalizedId } : {}
      );
    }
    return definition;
  };

  return Object.freeze({
    effectIds,
    assets,
    has(effectId: string): boolean {
      const normalizedId = normalizeLookupId(effectId);
      return normalizedId !== "" && definitions.has(normalizedId);
    },
    getAsset(effectId: string): ProgrammableSceneAsset {
      return lookup(effectId).asset;
    },
    createNode(effectId: string, options: VexaSoundEffectInstanceOptions): ProgrammableSceneAudioNode {
      const definition = lookup(effectId);
      if (!options || typeof options !== "object") {
        throw new VexaSoundEffectError(
          `Sound effect "${definition.effectId}" instance options are required.`,
          "INVALID_SOUND_EFFECT_INSTANCE",
          { effectId: definition.effectId }
        );
      }

      const id = assertNonEmptyText(
        options.id,
        `Sound effect "${definition.effectId}" node id`,
        "INVALID_SOUND_EFFECT_INSTANCE",
        definition.effectId
      );
      const startFrame = assertNonNegativeInteger(
        options.startFrame,
        `Sound effect "${definition.effectId}" startFrame`,
        definition.effectId
      );
      const durationInFrames = assertPositiveInteger(
        options.durationInFrames,
        `Sound effect "${definition.effectId}" durationInFrames`,
        definition.effectId
      );
      const sourceStartSeconds = assertNonNegativeFinite(
        options.sourceStartSeconds ?? definition.sourceStartSeconds,
        `Sound effect "${definition.effectId}" sourceStartSeconds`,
        "INVALID_SOUND_EFFECT_INSTANCE",
        definition.effectId
      );
      const playbackRate = assertPositiveFinite(
        options.playbackRate ?? definition.playbackRate,
        `Sound effect "${definition.effectId}" playbackRate`,
        "INVALID_SOUND_EFFECT_INSTANCE",
        definition.effectId
      );
      const volume = assertNonNegativeFinite(
        options.volume ?? definition.volume,
        `Sound effect "${definition.effectId}" volume`,
        "INVALID_SOUND_EFFECT_INSTANCE",
        definition.effectId
      );
      const muted = options.muted ?? definition.muted;
      if (muted !== undefined && typeof muted !== "boolean") {
        throw new VexaSoundEffectError(
          `Sound effect "${definition.effectId}" muted must be boolean when provided.`,
          "INVALID_SOUND_EFFECT_INSTANCE",
          { effectId: definition.effectId }
        );
      }

      return Object.freeze({
        kind: "audio",
        id,
        assetId: definition.asset.id,
        ...(startFrame !== undefined ? { startFrame } : {}),
        ...(durationInFrames !== undefined ? { durationInFrames } : {}),
        ...(sourceStartSeconds !== undefined ? { sourceStartSeconds } : {}),
        ...(playbackRate !== undefined ? { playbackRate } : {}),
        ...(volume !== undefined ? { volume } : {}),
        ...(muted !== undefined ? { muted } : {})
      });
    }
  });
}

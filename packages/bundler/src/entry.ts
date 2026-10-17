export const VEXA_BUNDLE_DISCOVERY_EXPORT = "vexaCompositions" as const;

export type VexaBundledCompositionKind = "video" | "still";

export interface VexaBundledCompositionDescriptor {
  readonly id: string;
  readonly kind: VexaBundledCompositionKind;
  readonly width: number;
  readonly height: number;
  readonly fps?: number;
  readonly durationInFrames?: number;
}

export class InvalidVexaBundleCompositionError extends Error {
  readonly code = "INVALID_BUNDLE_COMPOSITION" as const;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidVexaBundleCompositionError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new InvalidVexaBundleCompositionError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function requirePositiveFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InvalidVexaBundleCompositionError(`${label} must be a positive finite number.`);
  }
  return value;
}

function normalizeDescriptor(
  input: VexaBundledCompositionDescriptor,
  index: number
): VexaBundledCompositionDescriptor {
  if (!input || typeof input !== "object") {
    throw new InvalidVexaBundleCompositionError(`Composition at index ${index} must be an object.`);
  }

  const id = requireNonEmptyText(input.id, `Composition ${index} id`);
  const kind = input.kind;
  if (kind !== "video" && kind !== "still") {
    throw new InvalidVexaBundleCompositionError(
      `Composition "${id}" kind must be either "video" or "still".`
    );
  }

  const width = requirePositiveInteger(input.width, `Composition "${id}" width`);
  const height = requirePositiveInteger(input.height, `Composition "${id}" height`);

  if (kind === "still") {
    if (input.fps !== undefined || input.durationInFrames !== undefined) {
      throw new InvalidVexaBundleCompositionError(
        `Still composition "${id}" must not declare fps or durationInFrames.`
      );
    }
    return Object.freeze({ id, kind, width, height });
  }

  const fps = requirePositiveFinite(input.fps, `Composition "${id}" fps`);
  const durationInFrames = requirePositiveInteger(
    input.durationInFrames,
    `Composition "${id}" durationInFrames`
  );
  return Object.freeze({ id, kind, width, height, fps, durationInFrames });
}

export function defineBundleCompositions(
  descriptors: readonly VexaBundledCompositionDescriptor[]
): readonly VexaBundledCompositionDescriptor[] {
  if (!Array.isArray(descriptors)) {
    throw new InvalidVexaBundleCompositionError("Bundle compositions must be an array.");
  }

  const seen = new Set<string>();
  const normalized = descriptors.map((descriptor, index) => {
    const value = normalizeDescriptor(descriptor, index);
    if (seen.has(value.id)) {
      throw new InvalidVexaBundleCompositionError(
        `Bundle composition id "${value.id}" is duplicated.`
      );
    }
    seen.add(value.id);
    return value;
  });

  normalized.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return Object.freeze(normalized);
}

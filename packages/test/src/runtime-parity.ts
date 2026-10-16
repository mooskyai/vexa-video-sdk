export type VexaRuntimeParityErrorCode =
  | "INVALID_RUNTIME_PARITY_OPTIONS"
  | "RUNTIME_PARITY_MISMATCH";

export class VexaRuntimeParityError extends Error {
  readonly code: VexaRuntimeParityErrorCode;
  readonly comparison?: VexaRuntimeParityComparison;

  constructor(
    message: string,
    code: VexaRuntimeParityErrorCode,
    options: { readonly comparison?: VexaRuntimeParityComparison } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.comparison !== undefined) this.comparison = options.comparison;
  }
}

export interface VexaRuntimeParityCheckpoint {
  readonly name: string;
  readonly frame: number;
}

export interface VexaRuntimeParityContract {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly checkpoints: readonly VexaRuntimeParityCheckpoint[];
}

export interface VexaRuntimeCheckpointExpectation {
  readonly name: string;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly timestampUs: number;
  readonly durationUs: number;
}

export interface VexaRuntimeCheckpointObservation extends VexaRuntimeCheckpointExpectation {
  readonly runtime: string;
}

export type VexaRuntimeParityMismatchField =
  | "observation"
  | "frame"
  | "width"
  | "height"
  | "fps"
  | "durationInFrames"
  | "timestampUs"
  | "durationUs";

export interface VexaRuntimeParityMismatch {
  readonly runtime: string;
  readonly name: string;
  readonly field: VexaRuntimeParityMismatchField;
  readonly expected: number | string;
  readonly actual: number | string;
}

export interface VexaRuntimeParityComparison {
  readonly matches: boolean;
  readonly expectations: readonly VexaRuntimeCheckpointExpectation[];
  readonly observations: readonly VexaRuntimeCheckpointObservation[];
  readonly mismatches: readonly VexaRuntimeParityMismatch[];
}

export interface VexaRuntimeParityOptions {
  readonly requiredRuntimes: readonly string[];
}

const CHECKPOINT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

function invalidOptions(message: string): VexaRuntimeParityError {
  return new VexaRuntimeParityError(message, "INVALID_RUNTIME_PARITY_OPTIONS");
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidOptions(`${label} must be a positive safe integer.`);
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw invalidOptions(`${label} must be a finite number greater than 0.`);
  }
  return value;
}

function normalizeName(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !CHECKPOINT_NAME_PATTERN.test(value)
  ) {
    throw invalidOptions(`${label} must match ${CHECKPOINT_NAME_PATTERN.source}.`);
  }
  return value;
}

function normalizeRuntime(value: string, label: string): string {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0) {
    throw invalidOptions(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function normalizeContract(contract: VexaRuntimeParityContract): VexaRuntimeParityContract {
  if (!contract || typeof contract !== "object") {
    throw invalidOptions("runtime parity contract is required.");
  }
  const width = positiveInteger(contract.width, "width");
  const height = positiveInteger(contract.height, "height");
  const fps = positiveFinite(contract.fps, "fps");
  const durationInFrames = positiveInteger(contract.durationInFrames, "durationInFrames");
  if (!Array.isArray(contract.checkpoints) || contract.checkpoints.length === 0) {
    throw invalidOptions("checkpoints must contain at least one runtime parity checkpoint.");
  }

  const names = new Set<string>();
  const checkpoints = contract.checkpoints.map((checkpoint, index) => {
    if (!checkpoint || typeof checkpoint !== "object") {
      throw invalidOptions(`checkpoints[${index}] must be an object.`);
    }
    const name = normalizeName(checkpoint.name, `checkpoints[${index}].name`);
    if (!Number.isSafeInteger(checkpoint.frame) || checkpoint.frame < 0 || checkpoint.frame >= durationInFrames) {
      throw invalidOptions(
        `checkpoints[${index}].frame must be an integer between 0 and ${durationInFrames - 1}.`
      );
    }
    if (names.has(name)) throw invalidOptions(`checkpoint name "${name}" is duplicated.`);
    names.add(name);
    return Object.freeze({ name, frame: checkpoint.frame });
  });

  return Object.freeze({
    width,
    height,
    fps,
    durationInFrames,
    checkpoints: Object.freeze(checkpoints)
  });
}

function normalizeRequiredRuntimes(runtimes: readonly string[]): readonly string[] {
  if (!Array.isArray(runtimes) || runtimes.length === 0) {
    throw invalidOptions("requiredRuntimes must contain at least one runtime name.");
  }
  const seen = new Set<string>();
  const normalized = runtimes.map((runtime, index) => {
    const name = normalizeRuntime(runtime, `requiredRuntimes[${index}]`);
    if (seen.has(name)) throw invalidOptions(`required runtime "${name}" is duplicated.`);
    seen.add(name);
    return name;
  });
  return Object.freeze(normalized);
}

function normalizeObservation(
  observation: VexaRuntimeCheckpointObservation,
  index: number,
  checkpointNames: ReadonlySet<string>
): VexaRuntimeCheckpointObservation {
  if (!observation || typeof observation !== "object") {
    throw invalidOptions(`observations[${index}] must be an object.`);
  }
  const runtime = normalizeRuntime(observation.runtime, `observations[${index}].runtime`);
  const name = normalizeName(observation.name, `observations[${index}].name`);
  if (!checkpointNames.has(name)) {
    throw invalidOptions(`observations[${index}] references unknown checkpoint "${name}".`);
  }

  const nonNegativeFields = [
    ["frame", observation.frame],
    ["timestampUs", observation.timestampUs]
  ] as const;
  for (const [field, value] of nonNegativeFields) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalidOptions(`observations[${index}].${field} must be a non-negative safe integer.`);
    }
  }
  positiveInteger(observation.width, `observations[${index}].width`);
  positiveInteger(observation.height, `observations[${index}].height`);
  positiveInteger(observation.durationInFrames, `observations[${index}].durationInFrames`);
  positiveInteger(observation.durationUs, `observations[${index}].durationUs`);
  positiveFinite(observation.fps, `observations[${index}].fps`);

  return Object.freeze({
    runtime,
    name,
    frame: observation.frame,
    width: observation.width,
    height: observation.height,
    fps: observation.fps,
    durationInFrames: observation.durationInFrames,
    timestampUs: observation.timestampUs,
    durationUs: observation.durationUs
  });
}

export function createRuntimeCheckpointExpectations(
  contract: VexaRuntimeParityContract
): readonly VexaRuntimeCheckpointExpectation[] {
  const normalized = normalizeContract(contract);
  const durationUs = Math.max(1, Math.round(1_000_000 / normalized.fps));
  return Object.freeze(normalized.checkpoints.map((checkpoint) => Object.freeze({
    name: checkpoint.name,
    frame: checkpoint.frame,
    width: normalized.width,
    height: normalized.height,
    fps: normalized.fps,
    durationInFrames: normalized.durationInFrames,
    timestampUs: Math.round((checkpoint.frame * 1_000_000) / normalized.fps),
    durationUs
  })));
}

export function compareRuntimeCheckpointParity(
  contract: VexaRuntimeParityContract,
  observations: readonly VexaRuntimeCheckpointObservation[],
  options: VexaRuntimeParityOptions
): VexaRuntimeParityComparison {
  const expectations = createRuntimeCheckpointExpectations(contract);
  if (!Array.isArray(observations)) throw invalidOptions("observations must be an array.");
  if (!options || typeof options !== "object") throw invalidOptions("runtime parity options are required.");
  const requiredRuntimes = normalizeRequiredRuntimes(options.requiredRuntimes);
  const checkpointNames = new Set(expectations.map((expectation) => expectation.name));
  const normalizedObservations = observations.map((observation, index) =>
    normalizeObservation(observation, index, checkpointNames)
  );

  const observationByKey = new Map<string, VexaRuntimeCheckpointObservation>();
  for (const observation of normalizedObservations) {
    const key = `${observation.runtime}\u0000${observation.name}`;
    if (observationByKey.has(key)) {
      throw invalidOptions(
        `runtime "${observation.runtime}" contains duplicate checkpoint observation "${observation.name}".`
      );
    }
    observationByKey.set(key, observation);
  }

  const expectationByName = new Map(expectations.map((expectation) => [expectation.name, expectation] as const));
  const mismatches: VexaRuntimeParityMismatch[] = [];
  const fields = ["frame", "width", "height", "fps", "durationInFrames", "timestampUs", "durationUs"] as const;

  for (const runtime of requiredRuntimes) {
    for (const expectation of expectations) {
      const observation = observationByKey.get(`${runtime}\u0000${expectation.name}`);
      if (observation === undefined) {
        mismatches.push(Object.freeze({
          runtime,
          name: expectation.name,
          field: "observation" as const,
          expected: "present",
          actual: "missing"
        }));
        continue;
      }
      for (const field of fields) {
        if (observation[field] === expectation[field]) continue;
        mismatches.push(Object.freeze({
          runtime,
          name: expectation.name,
          field,
          expected: expectation[field],
          actual: observation[field]
        }));
      }
    }
  }

  for (const observation of normalizedObservations) {
    const expectation = expectationByName.get(observation.name)!;
    if (requiredRuntimes.includes(observation.runtime)) continue;
    for (const field of fields) {
      if (observation[field] === expectation[field]) continue;
      mismatches.push(Object.freeze({
        runtime: observation.runtime,
        name: expectation.name,
        field,
        expected: expectation[field],
        actual: observation[field]
      }));
    }
  }

  return Object.freeze({
    matches: mismatches.length === 0,
    expectations,
    observations: Object.freeze(normalizedObservations),
    mismatches: Object.freeze(mismatches)
  });
}

export function assertRuntimeCheckpointParity(
  contract: VexaRuntimeParityContract,
  observations: readonly VexaRuntimeCheckpointObservation[],
  options: VexaRuntimeParityOptions
): VexaRuntimeParityComparison {
  const comparison = compareRuntimeCheckpointParity(contract, observations, options);
  if (!comparison.matches) {
    const first = comparison.mismatches[0]!;
    throw new VexaRuntimeParityError(
      `Runtime parity mismatch for "${first.runtime}" checkpoint "${first.name}" field ${first.field}: expected ${String(first.expected)}, received ${String(first.actual)}.`,
      "RUNTIME_PARITY_MISMATCH",
      { comparison }
    );
  }
  return comparison;
}

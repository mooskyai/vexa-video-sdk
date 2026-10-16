export type VexaMediaSyncErrorCode =
  | "INVALID_MEDIA_SYNC_OPTIONS"
  | "MEDIA_DURATION_MISMATCH"
  | "MEDIA_SYNC_MISMATCH";

export type VexaMediaStreamKind = "video" | "audio";

export interface VexaMediaTimelineContract {
  readonly fps: number;
  readonly durationInFrames: number;
}

export interface VexaMediaDurationObservation {
  readonly kind: VexaMediaStreamKind;
  readonly durationSeconds: number;
}

export interface VexaMediaDurationSyncOptions {
  /** Maximum absolute difference between each observed stream and the frame-derived duration. */
  readonly durationToleranceSeconds?: number;
  /** Maximum absolute duration skew between the observed audio and video streams. */
  readonly audioVideoSkewToleranceSeconds?: number;
}

export interface VexaMediaDurationSyncComparison {
  readonly expectedDurationSeconds: number;
  readonly durationToleranceSeconds: number;
  readonly audioVideoSkewToleranceSeconds: number;
  readonly observations: readonly VexaMediaDurationObservation[];
  readonly maximumExpectedDurationDeltaSeconds: number;
  readonly audioVideoSkewSeconds?: number;
  readonly durationMatches: boolean;
  readonly syncMatches: boolean;
  readonly matches: boolean;
}

export class VexaMediaSyncError extends Error {
  readonly code: VexaMediaSyncErrorCode;
  readonly comparison?: VexaMediaDurationSyncComparison;

  constructor(
    message: string,
    code: VexaMediaSyncErrorCode,
    options: { readonly comparison?: VexaMediaDurationSyncComparison } = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.comparison !== undefined) this.comparison = options.comparison;
  }
}

function invalidOptions(message: string): VexaMediaSyncError {
  return new VexaMediaSyncError(message, "INVALID_MEDIA_SYNC_OPTIONS");
}

function normalizeTolerance(value: number | undefined, label: string): number {
  const normalized = value ?? 0;
  if (typeof normalized !== "number" || !Number.isFinite(normalized) || normalized < 0) {
    throw invalidOptions(`${label} must be a finite number greater than or equal to 0.`);
  }
  return normalized;
}

function normalizeContract(contract: VexaMediaTimelineContract): VexaMediaTimelineContract {
  if (!contract || typeof contract !== "object") {
    throw invalidOptions("media timeline contract is required.");
  }
  if (typeof contract.fps !== "number" || !Number.isFinite(contract.fps) || contract.fps <= 0) {
    throw invalidOptions("fps must be a finite number greater than 0.");
  }
  if (!Number.isSafeInteger(contract.durationInFrames) || contract.durationInFrames <= 0) {
    throw invalidOptions("durationInFrames must be a positive safe integer.");
  }
  return Object.freeze({ fps: contract.fps, durationInFrames: contract.durationInFrames });
}

function normalizeObservations(
  observations: readonly VexaMediaDurationObservation[]
): readonly VexaMediaDurationObservation[] {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw invalidOptions("observations must contain at least one media stream duration.");
  }

  const byKind = new Map<VexaMediaStreamKind, VexaMediaDurationObservation>();
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (!observation || typeof observation !== "object") {
      throw invalidOptions(`observations[${index}] must be an object.`);
    }
    if (observation.kind !== "video" && observation.kind !== "audio") {
      throw invalidOptions(`observations[${index}].kind must be video or audio.`);
    }
    if (
      typeof observation.durationSeconds !== "number" ||
      !Number.isFinite(observation.durationSeconds) ||
      observation.durationSeconds <= 0
    ) {
      throw invalidOptions(`observations[${index}].durationSeconds must be a finite number greater than 0.`);
    }
    if (byKind.has(observation.kind)) {
      throw invalidOptions(`observation kind "${observation.kind}" is duplicated.`);
    }
    byKind.set(
      observation.kind,
      Object.freeze({ kind: observation.kind, durationSeconds: observation.durationSeconds })
    );
  }

  return Object.freeze(
    (["video", "audio"] as const)
      .map((kind) => byKind.get(kind))
      .filter((item): item is VexaMediaDurationObservation => item !== undefined)
  );
}

export function compareMediaDurationSync(
  contract: VexaMediaTimelineContract,
  observations: readonly VexaMediaDurationObservation[],
  options: VexaMediaDurationSyncOptions = {}
): VexaMediaDurationSyncComparison {
  const normalizedContract = normalizeContract(contract);
  const normalizedObservations = normalizeObservations(observations);
  const durationToleranceSeconds = normalizeTolerance(
    options.durationToleranceSeconds,
    "durationToleranceSeconds"
  );
  const audioVideoSkewToleranceSeconds = normalizeTolerance(
    options.audioVideoSkewToleranceSeconds,
    "audioVideoSkewToleranceSeconds"
  );
  const expectedDurationSeconds = normalizedContract.durationInFrames / normalizedContract.fps;
  const deltas = normalizedObservations.map((observation) =>
    Math.abs(observation.durationSeconds - expectedDurationSeconds)
  );
  const maximumExpectedDurationDeltaSeconds = Math.max(...deltas);
  const durationMatches = maximumExpectedDurationDeltaSeconds <= durationToleranceSeconds;
  const video = normalizedObservations.find((observation) => observation.kind === "video");
  const audio = normalizedObservations.find((observation) => observation.kind === "audio");
  const audioVideoSkewSeconds = video && audio
    ? Math.abs(video.durationSeconds - audio.durationSeconds)
    : undefined;
  const syncMatches =
    audioVideoSkewSeconds === undefined ||
    audioVideoSkewSeconds <= audioVideoSkewToleranceSeconds;

  return Object.freeze({
    expectedDurationSeconds,
    durationToleranceSeconds,
    audioVideoSkewToleranceSeconds,
    observations: normalizedObservations,
    maximumExpectedDurationDeltaSeconds,
    ...(audioVideoSkewSeconds !== undefined ? { audioVideoSkewSeconds } : {}),
    durationMatches,
    syncMatches,
    matches: durationMatches && syncMatches
  });
}

export function assertMediaDurationSync(
  contract: VexaMediaTimelineContract,
  observations: readonly VexaMediaDurationObservation[],
  options: VexaMediaDurationSyncOptions = {}
): VexaMediaDurationSyncComparison {
  const comparison = compareMediaDurationSync(contract, observations, options);
  if (!comparison.durationMatches) {
    throw new VexaMediaSyncError(
      `Media duration mismatch: expected ${comparison.expectedDurationSeconds.toFixed(6)}s, maximum stream delta ${comparison.maximumExpectedDurationDeltaSeconds.toFixed(6)}s exceeds tolerance ${comparison.durationToleranceSeconds.toFixed(6)}s.`,
      "MEDIA_DURATION_MISMATCH",
      { comparison }
    );
  }
  if (!comparison.syncMatches) {
    throw new VexaMediaSyncError(
      `Audio/video duration skew ${comparison.audioVideoSkewSeconds?.toFixed(6) ?? "unknown"}s exceeds tolerance ${comparison.audioVideoSkewToleranceSeconds.toFixed(6)}s.`,
      "MEDIA_SYNC_MISMATCH",
      { comparison }
    );
  }
  return comparison;
}

export const PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION = 1 as const;

export type ProgrammableCompositionSchemaVersion = typeof PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION;
export type ProgrammableCompositionKind = "video" | "still";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ProgrammableCompositionErrorCode =
  | "INVALID_COMPOSITION"
  | "INVALID_COMPOSITION_PROPS"
  | "COMPOSITION_CONFLICT"
  | "COMPOSITION_NOT_FOUND"
  | "COMPOSITION_METADATA_FAILED";

export class ProgrammableCompositionError extends Error {
  readonly code: ProgrammableCompositionErrorCode;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ProgrammableCompositionErrorCode,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = options?.cause;
  }
}

export class InvalidProgrammableCompositionError extends ProgrammableCompositionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "INVALID_COMPOSITION", options);
  }
}

export class InvalidProgrammableCompositionPropsError extends ProgrammableCompositionError {
  readonly compositionId: string;

  constructor(compositionId: string, message: string, options?: { cause?: unknown }) {
    super(
      `Invalid props for composition "${compositionId}": ${message}`,
      "INVALID_COMPOSITION_PROPS",
      options
    );
    this.compositionId = compositionId;
  }
}

export class ProgrammableCompositionConflictError extends ProgrammableCompositionError {
  readonly compositionId: string;

  constructor(compositionId: string) {
    super(
      `A programmable composition with id "${compositionId}" is already registered.`,
      "COMPOSITION_CONFLICT"
    );
    this.compositionId = compositionId;
  }
}

export class ProgrammableCompositionNotFoundError extends ProgrammableCompositionError {
  readonly compositionId: string;

  constructor(compositionId: string) {
    super(`Programmable composition was not found: ${compositionId}`, "COMPOSITION_NOT_FOUND");
    this.compositionId = compositionId;
  }
}

export class ProgrammableCompositionMetadataError extends ProgrammableCompositionError {
  readonly compositionId: string;

  constructor(compositionId: string, message: string, options?: { cause?: unknown }) {
    super(
      `Failed to calculate metadata for composition "${compositionId}": ${message}`,
      "COMPOSITION_METADATA_FAILED",
      options
    );
    this.compositionId = compositionId;
  }
}

export interface ProgrammableCompositionDimensions {
  readonly width: number;
  readonly height: number;
}

export interface VideoProgrammableCompositionTiming {
  readonly fps: number;
  readonly durationInFrames: number;
}

export interface VideoProgrammableCompositionMetadata
  extends ProgrammableCompositionDimensions,
    VideoProgrammableCompositionTiming {
  readonly schemaVersion: ProgrammableCompositionSchemaVersion;
  readonly kind: "video";
  readonly id: string;
  readonly defaultProps: JsonObject;
}

export interface StillProgrammableCompositionMetadata extends ProgrammableCompositionDimensions {
  readonly schemaVersion: ProgrammableCompositionSchemaVersion;
  readonly kind: "still";
  readonly id: string;
  readonly defaultProps: JsonObject;
}

export type ProgrammableCompositionStaticMetadata =
  | VideoProgrammableCompositionMetadata
  | StillProgrammableCompositionMetadata;

export type VideoProgrammableCompositionMetadataOverride = Partial<
  ProgrammableCompositionDimensions & VideoProgrammableCompositionTiming
>;

export type StillProgrammableCompositionMetadataOverride = Partial<ProgrammableCompositionDimensions>;

export interface ProgrammableCompositionMetadataContext<
  Props extends JsonObject,
  Metadata extends ProgrammableCompositionStaticMetadata
> {
  readonly props: Readonly<Props>;
  readonly staticMetadata: Metadata;
}

export type ProgrammableCompositionPropsValidator<Props extends JsonObject> = (
  props: Readonly<Props>
) => void;

export type ProgrammableCompositionMetadataCalculator<
  Props extends JsonObject,
  Metadata extends ProgrammableCompositionStaticMetadata,
  Override
> = (
  context: ProgrammableCompositionMetadataContext<Props, Metadata>
) => Override | Promise<Override>;

interface ProgrammableCompositionDefinitionBase<Props extends JsonObject> {
  readonly schemaVersion: ProgrammableCompositionSchemaVersion;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly defaultProps: Readonly<Props>;
  readonly validateProps?: ProgrammableCompositionPropsValidator<Props>;
}

export interface VideoProgrammableCompositionDefinition<Props extends JsonObject = JsonObject>
  extends ProgrammableCompositionDefinitionBase<Props> {
  readonly kind: "video";
  readonly fps: number;
  readonly durationInFrames: number;
  readonly calculateMetadata?: ProgrammableCompositionMetadataCalculator<
    Props,
    VideoProgrammableCompositionMetadata,
    VideoProgrammableCompositionMetadataOverride
  >;
}

export interface StillProgrammableCompositionDefinition<Props extends JsonObject = JsonObject>
  extends ProgrammableCompositionDefinitionBase<Props> {
  readonly kind: "still";
  readonly calculateMetadata?: ProgrammableCompositionMetadataCalculator<
    Props,
    StillProgrammableCompositionMetadata,
    StillProgrammableCompositionMetadataOverride
  >;
}

export type ProgrammableCompositionDefinition<Props extends JsonObject = JsonObject> =
  | VideoProgrammableCompositionDefinition<Props>
  | StillProgrammableCompositionDefinition<Props>;

export interface DefineProgrammableCompositionOptions<Props extends JsonObject = JsonObject> {
  readonly schemaVersion?: number;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly defaultProps?: Props;
  readonly validateProps?: ProgrammableCompositionPropsValidator<Props>;
  readonly calculateMetadata?: ProgrammableCompositionMetadataCalculator<
    Props,
    VideoProgrammableCompositionMetadata,
    VideoProgrammableCompositionMetadataOverride
  >;
}

export interface DefineProgrammableStillOptions<Props extends JsonObject = JsonObject> {
  readonly schemaVersion?: number;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly defaultProps?: Props;
  readonly validateProps?: ProgrammableCompositionPropsValidator<Props>;
  readonly calculateMetadata?: ProgrammableCompositionMetadataCalculator<
    Props,
    StillProgrammableCompositionMetadata,
    StillProgrammableCompositionMetadataOverride
  >;
}

export type ResolvedProgrammableCompositionMetadata =
  | Omit<VideoProgrammableCompositionMetadata, "defaultProps">
  | Omit<StillProgrammableCompositionMetadata, "defaultProps">;

export interface ResolvedProgrammableComposition<Props extends JsonObject = JsonObject> {
  readonly metadata: ResolvedProgrammableCompositionMetadata;
  readonly props: Readonly<Props>;
}

type AnyProgrammableCompositionDefinition = ProgrammableCompositionDefinition<any>;

function assertSupportedSchemaVersion(schemaVersion: number | undefined): void {
  const effectiveVersion = schemaVersion ?? PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION;
  if (effectiveVersion !== PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION) {
    throw new InvalidProgrammableCompositionError(
      `Unsupported programmable composition schema version: ${String(effectiveVersion)}.`
    );
  }
}

function assertCompositionId(id: string): void {
  if (!id.trim()) {
    throw new InvalidProgrammableCompositionError("Composition id cannot be empty.");
  }
  if (id !== id.trim()) {
    throw new InvalidProgrammableCompositionError(
      `Composition id "${id}" cannot contain leading or trailing whitespace.`
    );
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidProgrammableCompositionError(`${label} must be a positive integer.`);
  }
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidProgrammableCompositionError(`${label} must be a finite number greater than 0.`);
  }
}


function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  invalid: (message: string) => ProgrammableCompositionError
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalid(`${path} must contain only finite numbers.`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`, invalid));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStableText)
        .map((key) => [key, normalizeJsonValue(value[key], `${path}.${key}`, invalid)])
    ) as Record<string, JsonValue>;
  }

  throw invalid(
    `${path} must contain JSON-compatible values only; received ${Object.prototype.toString.call(value)}.`
  );
}

function freezeJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freezeJsonValue(item);
    return Object.freeze(value) as T;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) freezeJsonValue(item as JsonValue);
    return Object.freeze(value) as T;
  }
  return value;
}

function normalizeDefaultProps<Props extends JsonObject>(
  compositionId: string,
  props: Props | undefined
): Readonly<Props> {
  const normalized = normalizeJsonValue(
    props ?? {},
    `composition ${compositionId}.defaultProps`,
    (message) => new InvalidProgrammableCompositionError(message)
  );

  if (!isPlainObject(normalized)) {
    throw new InvalidProgrammableCompositionError(
      `composition ${compositionId}.defaultProps must be a JSON object.`
    );
  }

  return freezeJsonValue(normalized) as Props;
}

function normalizeResolvedProps<Props extends JsonObject>(
  compositionId: string,
  defaultProps: Readonly<Props>,
  inputProps: Partial<Props> | undefined
): Readonly<Props> {
  const merged = {
    ...defaultProps,
    ...(inputProps ?? {})
  };
  const normalized = normalizeJsonValue(
    merged,
    `composition ${compositionId}.props`,
    (message) => new InvalidProgrammableCompositionPropsError(compositionId, message)
  );

  if (!isPlainObject(normalized)) {
    throw new InvalidProgrammableCompositionPropsError(
      compositionId,
      "resolved props must be a JSON object."
    );
  }

  return freezeJsonValue(normalized) as Props;
}

function validateResolvedProps<Props extends JsonObject>(
  definition: ProgrammableCompositionDefinition<Props>,
  props: Readonly<Props>
): void {
  if (!definition.validateProps) return;
  try {
    definition.validateProps(props);
  } catch (cause) {
    if (cause instanceof InvalidProgrammableCompositionPropsError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new InvalidProgrammableCompositionPropsError(definition.id, message, { cause });
  }
}

function videoStaticMetadata<Props extends JsonObject>(
  definition: VideoProgrammableCompositionDefinition<Props>
): VideoProgrammableCompositionMetadata {
  return Object.freeze({
    schemaVersion: PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION,
    kind: "video",
    id: definition.id,
    width: definition.width,
    height: definition.height,
    fps: definition.fps,
    durationInFrames: definition.durationInFrames,
    defaultProps: definition.defaultProps
  });
}

function stillStaticMetadata<Props extends JsonObject>(
  definition: StillProgrammableCompositionDefinition<Props>
): StillProgrammableCompositionMetadata {
  return Object.freeze({
    schemaVersion: PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION,
    kind: "still",
    id: definition.id,
    width: definition.width,
    height: definition.height,
    defaultProps: definition.defaultProps
  });
}

export function defineComposition<Props extends JsonObject = JsonObject>(
  options: DefineProgrammableCompositionOptions<Props>
): VideoProgrammableCompositionDefinition<Props> {
  assertSupportedSchemaVersion(options.schemaVersion);
  assertCompositionId(options.id);
  assertPositiveInteger(options.width, `composition ${options.id}.width`);
  assertPositiveInteger(options.height, `composition ${options.id}.height`);
  assertPositiveFinite(options.fps, `composition ${options.id}.fps`);
  assertPositiveInteger(options.durationInFrames, `composition ${options.id}.durationInFrames`);

  return Object.freeze({
    schemaVersion: PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION,
    kind: "video",
    id: options.id,
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationInFrames: options.durationInFrames,
    defaultProps: normalizeDefaultProps(options.id, options.defaultProps),
    ...(options.validateProps ? { validateProps: options.validateProps } : {}),
    ...(options.calculateMetadata ? { calculateMetadata: options.calculateMetadata } : {})
  });
}

export function defineStill<Props extends JsonObject = JsonObject>(
  options: DefineProgrammableStillOptions<Props>
): StillProgrammableCompositionDefinition<Props> {
  assertSupportedSchemaVersion(options.schemaVersion);
  assertCompositionId(options.id);
  assertPositiveInteger(options.width, `composition ${options.id}.width`);
  assertPositiveInteger(options.height, `composition ${options.id}.height`);

  return Object.freeze({
    schemaVersion: PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION,
    kind: "still",
    id: options.id,
    width: options.width,
    height: options.height,
    defaultProps: normalizeDefaultProps(options.id, options.defaultProps),
    ...(options.validateProps ? { validateProps: options.validateProps } : {}),
    ...(options.calculateMetadata ? { calculateMetadata: options.calculateMetadata } : {})
  });
}

export function getProgrammableCompositionStaticMetadata<Props extends JsonObject>(
  definition: ProgrammableCompositionDefinition<Props>
): ProgrammableCompositionStaticMetadata {
  return definition.kind === "video"
    ? videoStaticMetadata(definition)
    : stillStaticMetadata(definition);
}

export function serializeProgrammableCompositionMetadata<Props extends JsonObject>(
  definition: ProgrammableCompositionDefinition<Props>
): string {
  return JSON.stringify(getProgrammableCompositionStaticMetadata(definition));
}

function normalizeVideoOverride(
  compositionId: string,
  override: VideoProgrammableCompositionMetadataOverride | undefined,
  fallback: VideoProgrammableCompositionMetadata
): Omit<VideoProgrammableCompositionMetadata, "defaultProps"> {
  const width = override?.width ?? fallback.width;
  const height = override?.height ?? fallback.height;
  const fps = override?.fps ?? fallback.fps;
  const durationInFrames = override?.durationInFrames ?? fallback.durationInFrames;

  assertPositiveInteger(width, `composition ${compositionId}.resolved.width`);
  assertPositiveInteger(height, `composition ${compositionId}.resolved.height`);
  assertPositiveFinite(fps, `composition ${compositionId}.resolved.fps`);
  assertPositiveInteger(
    durationInFrames,
    `composition ${compositionId}.resolved.durationInFrames`
  );

  return Object.freeze({
    schemaVersion: PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION,
    kind: "video",
    id: compositionId,
    width,
    height,
    fps,
    durationInFrames
  });
}

function normalizeStillOverride(
  compositionId: string,
  override: StillProgrammableCompositionMetadataOverride | undefined,
  fallback: StillProgrammableCompositionMetadata
): Omit<StillProgrammableCompositionMetadata, "defaultProps"> {
  const width = override?.width ?? fallback.width;
  const height = override?.height ?? fallback.height;

  assertPositiveInteger(width, `composition ${compositionId}.resolved.width`);
  assertPositiveInteger(height, `composition ${compositionId}.resolved.height`);

  return Object.freeze({
    schemaVersion: PROGRAMMABLE_COMPOSITION_SCHEMA_VERSION,
    kind: "still",
    id: compositionId,
    width,
    height
  });
}

export async function resolveProgrammableComposition<Props extends JsonObject>(
  definition: ProgrammableCompositionDefinition<Props>,
  inputProps?: Partial<Props>
): Promise<ResolvedProgrammableComposition<Props>> {
  const props = normalizeResolvedProps(definition.id, definition.defaultProps, inputProps);
  validateResolvedProps(definition, props);

  try {
    if (definition.kind === "video") {
      const staticMetadata = videoStaticMetadata(definition);
      const override = definition.calculateMetadata
        ? await definition.calculateMetadata({ props, staticMetadata })
        : undefined;
      return {
        metadata: normalizeVideoOverride(definition.id, override, staticMetadata),
        props
      };
    }

    const staticMetadata = stillStaticMetadata(definition);
    const override = definition.calculateMetadata
      ? await definition.calculateMetadata({ props, staticMetadata })
      : undefined;
    return {
      metadata: normalizeStillOverride(definition.id, override, staticMetadata),
      props
    };
  } catch (cause) {
    if (cause instanceof ProgrammableCompositionMetadataError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ProgrammableCompositionMetadataError(definition.id, message, { cause });
  }
}

export class ProgrammableCompositionRegistry {
  readonly #entries = new Map<string, AnyProgrammableCompositionDefinition>();

  register<Props extends JsonObject>(definition: ProgrammableCompositionDefinition<Props>): this {
    if (this.#entries.has(definition.id)) {
      throw new ProgrammableCompositionConflictError(definition.id);
    }
    this.#entries.set(definition.id, definition as AnyProgrammableCompositionDefinition);
    return this;
  }

  registerMany(definitions: readonly ProgrammableCompositionDefinition<any>[]): this {
    const seen = new Set<string>();
    for (const definition of definitions) {
      if (seen.has(definition.id) || this.#entries.has(definition.id)) {
        throw new ProgrammableCompositionConflictError(definition.id);
      }
      seen.add(definition.id);
    }
    for (const definition of definitions) this.register(definition);
    return this;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  get<Props extends JsonObject = JsonObject>(
    id: string
  ): ProgrammableCompositionDefinition<Props> | undefined {
    return this.#entries.get(id) as ProgrammableCompositionDefinition<Props> | undefined;
  }

  require<Props extends JsonObject = JsonObject>(id: string): ProgrammableCompositionDefinition<Props> {
    const definition = this.get<Props>(id);
    if (!definition) throw new ProgrammableCompositionNotFoundError(id);
    return definition;
  }

  list(): readonly ProgrammableCompositionDefinition[] {
    return [...this.#entries.values()]
      .sort((left, right) => compareStableText(left.id, right.id));
  }

  listMetadata(): readonly ProgrammableCompositionStaticMetadata[] {
    return this.list().map((definition) => getProgrammableCompositionStaticMetadata(definition));
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

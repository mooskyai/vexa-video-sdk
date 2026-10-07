import {
  getProgrammableCompositionStaticMetadata,
  resolveProgrammableComposition,
  type JsonObject,
  type ProgrammableCompositionDefinition,
  type ProgrammableCompositionStaticMetadata,
  type ResolvedProgrammableComposition,
  type ResolvedProgrammableCompositionMetadata
} from "./programmable-composition.js";
import type { ProgrammableScene } from "./programmable-scene.js";

export type ExecutableProgrammableCompositionErrorCode =
  | "EXECUTABLE_COMPOSITION_CONFLICT"
  | "EXECUTABLE_COMPOSITION_NOT_FOUND"
  | "EXECUTABLE_COMPOSITION_FAILED"
  | "EXECUTABLE_COMPOSITION_SCENE_MISMATCH";

export class ExecutableProgrammableCompositionError extends Error {
  readonly code: ExecutableProgrammableCompositionErrorCode;
  readonly compositionId: string;
  readonly cause?: unknown;

  constructor(
    compositionId: string,
    message: string,
    code: ExecutableProgrammableCompositionErrorCode,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.compositionId = compositionId;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export class ExecutableProgrammableCompositionConflictError extends ExecutableProgrammableCompositionError {
  constructor(compositionId: string) {
    super(
      compositionId,
      `An executable programmable composition with id "${compositionId}" is already registered.`,
      "EXECUTABLE_COMPOSITION_CONFLICT"
    );
  }
}

export class ExecutableProgrammableCompositionNotFoundError extends ExecutableProgrammableCompositionError {
  constructor(compositionId: string) {
    super(
      compositionId,
      `Executable programmable composition was not found: ${compositionId}`,
      "EXECUTABLE_COMPOSITION_NOT_FOUND"
    );
  }
}

export class ExecutableProgrammableCompositionExecutionError extends ExecutableProgrammableCompositionError {
  constructor(compositionId: string, message: string, options?: { cause?: unknown }) {
    super(
      compositionId,
      `Failed to evaluate executable composition "${compositionId}": ${message}`,
      "EXECUTABLE_COMPOSITION_FAILED",
      options
    );
  }
}

export class ExecutableProgrammableCompositionSceneMismatchError extends ExecutableProgrammableCompositionError {
  constructor(compositionId: string, message: string) {
    super(
      compositionId,
      `Executable composition "${compositionId}" returned a scene that does not match its resolved metadata: ${message}`,
      "EXECUTABLE_COMPOSITION_SCENE_MISMATCH"
    );
  }
}

export interface ProgrammableCompositionExecutionContext<Props extends JsonObject = JsonObject> {
  readonly definition: ProgrammableCompositionDefinition<Props>;
  readonly resolved: ResolvedProgrammableComposition<Props>;
  readonly metadata: ResolvedProgrammableCompositionMetadata;
  readonly props: Readonly<Props>;
}

export type ProgrammableCompositionSceneFactory<Props extends JsonObject = JsonObject> = (
  context: ProgrammableCompositionExecutionContext<Props>
) => ProgrammableScene | Promise<ProgrammableScene>;

export interface ExecutableProgrammableComposition<Props extends JsonObject = JsonObject> {
  readonly definition: ProgrammableCompositionDefinition<Props>;
  readonly createScene: ProgrammableCompositionSceneFactory<Props>;
}

export interface DefineExecutableProgrammableCompositionOptions<
  Props extends JsonObject = JsonObject
> {
  readonly definition: ProgrammableCompositionDefinition<Props>;
  readonly createScene: ProgrammableCompositionSceneFactory<Props>;
}

export interface EvaluatedExecutableProgrammableComposition<
  Props extends JsonObject = JsonObject
> {
  readonly executable: ExecutableProgrammableComposition<Props>;
  readonly resolved: ResolvedProgrammableComposition<Props>;
  readonly scene: ProgrammableScene;
}

type AnyExecutableProgrammableComposition = ExecutableProgrammableComposition<any>;

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertSceneMatchesResolvedMetadata(
  compositionId: string,
  scene: ProgrammableScene,
  metadata: ResolvedProgrammableCompositionMetadata
): void {
  if (!scene || typeof scene !== "object") {
    throw new ExecutableProgrammableCompositionSceneMismatchError(
      compositionId,
      "createScene() must return a ProgrammableScene object."
    );
  }

  if (scene.id !== metadata.id) {
    throw new ExecutableProgrammableCompositionSceneMismatchError(
      compositionId,
      `scene id is "${scene.id}", expected "${metadata.id}".`
    );
  }
  if (scene.width !== metadata.width || scene.height !== metadata.height) {
    throw new ExecutableProgrammableCompositionSceneMismatchError(
      compositionId,
      `scene dimensions are ${scene.width}x${scene.height}, expected ${metadata.width}x${metadata.height}.`
    );
  }

  if (metadata.kind === "video") {
    if (scene.fps !== metadata.fps) {
      throw new ExecutableProgrammableCompositionSceneMismatchError(
        compositionId,
        `scene fps is ${scene.fps}, expected ${metadata.fps}.`
      );
    }
    if (scene.durationInFrames !== metadata.durationInFrames) {
      throw new ExecutableProgrammableCompositionSceneMismatchError(
        compositionId,
        `scene durationInFrames is ${scene.durationInFrames}, expected ${metadata.durationInFrames}.`
      );
    }
    return;
  }

  if (scene.fps !== 1 || scene.durationInFrames !== 1) {
    throw new ExecutableProgrammableCompositionSceneMismatchError(
      compositionId,
      "still compositions must return a one-frame scene with fps=1 and durationInFrames=1."
    );
  }
}

export function defineExecutableComposition<Props extends JsonObject = JsonObject>(
  options: DefineExecutableProgrammableCompositionOptions<Props>
): ExecutableProgrammableComposition<Props> {
  if (!options || typeof options !== "object") {
    throw new TypeError("Executable composition options are required.");
  }
  if (!options.definition || typeof options.definition !== "object") {
    throw new TypeError("Executable composition definition is required.");
  }
  if (typeof options.createScene !== "function") {
    throw new TypeError(
      `Executable composition "${options.definition.id}" createScene must be a function.`
    );
  }

  return Object.freeze({
    definition: options.definition,
    createScene: options.createScene
  });
}

export function getExecutableCompositionStaticMetadata<Props extends JsonObject>(
  executable: ExecutableProgrammableComposition<Props>
): ProgrammableCompositionStaticMetadata {
  return getProgrammableCompositionStaticMetadata(executable.definition);
}

export async function evaluateExecutableComposition<Props extends JsonObject = JsonObject>(
  executable: ExecutableProgrammableComposition<Props>,
  inputProps?: Partial<Props>
): Promise<EvaluatedExecutableProgrammableComposition<Props>> {
  const resolved = await resolveProgrammableComposition(executable.definition, inputProps);
  const context = Object.freeze({
    definition: executable.definition,
    resolved,
    metadata: resolved.metadata,
    props: resolved.props
  }) satisfies ProgrammableCompositionExecutionContext<Props>;

  let scene: ProgrammableScene;
  try {
    scene = await executable.createScene(context);
  } catch (cause) {
    if (cause instanceof ExecutableProgrammableCompositionError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ExecutableProgrammableCompositionExecutionError(executable.definition.id, message, {
      cause
    });
  }

  assertSceneMatchesResolvedMetadata(executable.definition.id, scene, resolved.metadata);
  return Object.freeze({ executable, resolved, scene });
}

export class ExecutableProgrammableCompositionRegistry {
  readonly #entries = new Map<string, AnyExecutableProgrammableComposition>();

  register<Props extends JsonObject>(entry: ExecutableProgrammableComposition<Props>): this {
    const id = entry.definition.id;
    if (this.#entries.has(id)) {
      throw new ExecutableProgrammableCompositionConflictError(id);
    }
    this.#entries.set(id, entry as AnyExecutableProgrammableComposition);
    return this;
  }

  registerMany(entries: readonly ExecutableProgrammableComposition<any>[]): this {
    const seen = new Set<string>();
    for (const entry of entries) {
      const id = entry.definition.id;
      if (seen.has(id) || this.#entries.has(id)) {
        throw new ExecutableProgrammableCompositionConflictError(id);
      }
      seen.add(id);
    }
    for (const entry of entries) this.register(entry);
    return this;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  get<Props extends JsonObject = JsonObject>(
    id: string
  ): ExecutableProgrammableComposition<Props> | undefined {
    return this.#entries.get(id) as ExecutableProgrammableComposition<Props> | undefined;
  }

  require<Props extends JsonObject = JsonObject>(
    id: string
  ): ExecutableProgrammableComposition<Props> {
    const entry = this.get<Props>(id);
    if (!entry) throw new ExecutableProgrammableCompositionNotFoundError(id);
    return entry;
  }

  list(): readonly ExecutableProgrammableComposition[] {
    return [...this.#entries.values()].sort((left, right) =>
      compareStableText(left.definition.id, right.definition.id)
    );
  }

  listMetadata(): readonly ProgrammableCompositionStaticMetadata[] {
    return this.list().map((entry) => getExecutableCompositionStaticMetadata(entry));
  }

  async evaluate<Props extends JsonObject = JsonObject>(
    id: string,
    inputProps?: Partial<Props>
  ): Promise<EvaluatedExecutableProgrammableComposition<Props>> {
    return await evaluateExecutableComposition(this.require<Props>(id), inputProps);
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

export function defineExecutableCompositions(
  entries: readonly ExecutableProgrammableComposition<any>[]
): readonly ExecutableProgrammableComposition[] {
  const registry = new ExecutableProgrammableCompositionRegistry();
  registry.registerMany(entries);
  return Object.freeze(registry.list());
}

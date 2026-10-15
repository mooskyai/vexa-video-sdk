import {
  getProgrammableCompositionStaticMetadata,
  ProgrammableCompositionConflictError,
  ProgrammableCompositionNotFoundError,
  type JsonObject,
  type ProgrammableCompositionDefinition,
  type ProgrammableCompositionKind
} from "./programmable-composition.js";
import type { ProgrammableInputObjectSchema } from "./programmable-input-schema.js";

export const PROGRAMMABLE_TEMPLATE_SCHEMA_VERSION = 1 as const;
export type ProgrammableTemplateSchemaVersion = typeof PROGRAMMABLE_TEMPLATE_SCHEMA_VERSION;

export type ProgrammableTemplateErrorCode = "INVALID_TEMPLATE";

export class ProgrammableTemplateError extends Error {
  readonly code: ProgrammableTemplateErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    this.code = "INVALID_TEMPLATE";
  }
}

export interface ProgrammableTemplateMetadataInput {
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
}

export interface ProgrammableTemplateMetadata {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
}

export interface ProgrammableTemplate<Props extends JsonObject = JsonObject> {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly id: string;
  readonly composition: ProgrammableCompositionDefinition<Props>;
  readonly metadata: ProgrammableTemplateMetadata;
}

interface ProgrammableTemplateCatalogEntryBase {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly id: string;
  readonly kind: ProgrammableCompositionKind;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly defaultProps: JsonObject;
  readonly inputSchema?: ProgrammableInputObjectSchema;
}

export interface VideoProgrammableTemplateCatalogEntry extends ProgrammableTemplateCatalogEntryBase {
  readonly kind: "video";
  readonly fps: number;
  readonly durationInFrames: number;
}

export interface StillProgrammableTemplateCatalogEntry extends ProgrammableTemplateCatalogEntryBase {
  readonly kind: "still";
}

export type ProgrammableTemplateCatalogEntry =
  | VideoProgrammableTemplateCatalogEntry
  | StillProgrammableTemplateCatalogEntry;

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ProgrammableTemplateError(`${label} cannot be empty.`);
  return normalized;
}

function optionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new ProgrammableTemplateError(`${label} cannot be empty.`);
  return normalized;
}

function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  if (tags === undefined) return Object.freeze([]);
  const normalized = tags.map((tag, index) => requiredText(tag, `template.tags[${index}]`));
  return Object.freeze([...new Set(normalized)].sort(compareStableText));
}

export function normalizeProgrammableTemplateMetadata(
  metadata: ProgrammableTemplateMetadataInput
): ProgrammableTemplateMetadata {
  const description = optionalText(metadata.description, "template.description");
  const category = optionalText(metadata.category, "template.category");
  return Object.freeze({
    schemaVersion: PROGRAMMABLE_TEMPLATE_SCHEMA_VERSION,
    name: requiredText(metadata.name, "template.name"),
    ...(description === undefined ? {} : { description }),
    ...(category === undefined ? {} : { category }),
    tags: normalizeTags(metadata.tags)
  });
}

export function defineProgrammableTemplate<Props extends JsonObject>(
  composition: ProgrammableCompositionDefinition<Props>,
  metadata: ProgrammableTemplateMetadataInput
): ProgrammableTemplate<Props> {
  return Object.freeze({
    schemaVersion: PROGRAMMABLE_TEMPLATE_SCHEMA_VERSION,
    id: composition.id,
    composition,
    metadata: normalizeProgrammableTemplateMetadata(metadata)
  });
}

export function getProgrammableTemplateCatalogEntry<Props extends JsonObject>(
  template: ProgrammableTemplate<Props>
): ProgrammableTemplateCatalogEntry {
  const composition = getProgrammableCompositionStaticMetadata(template.composition);
  const shared = {
    schemaVersion: PROGRAMMABLE_TEMPLATE_SCHEMA_VERSION,
    id: composition.id,
    kind: composition.kind,
    name: template.metadata.name,
    ...(template.metadata.description === undefined
      ? {}
      : { description: template.metadata.description }),
    ...(template.metadata.category === undefined ? {} : { category: template.metadata.category }),
    tags: template.metadata.tags,
    width: composition.width,
    height: composition.height,
    defaultProps: composition.defaultProps,
    ...(composition.inputSchema === undefined ? {} : { inputSchema: composition.inputSchema })
  } as const;

  return composition.kind === "video"
    ? Object.freeze({
        ...shared,
        kind: "video" as const,
        fps: composition.fps,
        durationInFrames: composition.durationInFrames
      })
    : Object.freeze({ ...shared, kind: "still" as const });
}

export class ProgrammableTemplateCatalog {
  readonly #entries = new Map<string, ProgrammableTemplate<any>>();

  register<Props extends JsonObject>(template: ProgrammableTemplate<Props>): this {
    if (this.#entries.has(template.id)) {
      throw new ProgrammableCompositionConflictError(template.id);
    }
    this.#entries.set(template.id, template as ProgrammableTemplate<any>);
    return this;
  }

  registerMany(templates: readonly ProgrammableTemplate<any>[]): this {
    const seen = new Set<string>();
    for (const template of templates) {
      if (seen.has(template.id) || this.#entries.has(template.id)) {
        throw new ProgrammableCompositionConflictError(template.id);
      }
      seen.add(template.id);
    }
    for (const template of templates) this.register(template);
    return this;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  get<Props extends JsonObject = JsonObject>(id: string): ProgrammableTemplate<Props> | undefined {
    return this.#entries.get(id) as ProgrammableTemplate<Props> | undefined;
  }

  require<Props extends JsonObject = JsonObject>(id: string): ProgrammableTemplate<Props> {
    const template = this.get<Props>(id);
    if (!template) throw new ProgrammableCompositionNotFoundError(id);
    return template;
  }

  list(): readonly ProgrammableTemplate[] {
    return [...this.#entries.values()].sort((left, right) => compareStableText(left.id, right.id));
  }

  listEntries(): readonly ProgrammableTemplateCatalogEntry[] {
    return this.list().map((template) => getProgrammableTemplateCatalogEntry(template));
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

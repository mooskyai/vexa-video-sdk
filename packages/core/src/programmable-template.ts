import {
  getProgrammableCompositionStaticMetadata,
  ProgrammableCompositionConflictError,
  ProgrammableCompositionNotFoundError,
  resolveProgrammableComposition,
  type JsonObject,
  type JsonValue,
  type ProgrammableCompositionDefinition,
  type ProgrammableCompositionKind,
  type ResolvedProgrammableComposition
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

export type ProgrammableTemplateAspectRatio = "16:9" | "9:16" | "1:1";

export interface ProgrammableTemplateVariantInput {
  readonly id: string;
  readonly label?: string;
  readonly aspectRatio: ProgrammableTemplateAspectRatio;
  readonly props?: JsonObject;
}

export interface ProgrammableTemplateVariant {
  readonly id: string;
  readonly label?: string;
  readonly aspectRatio: ProgrammableTemplateAspectRatio;
  readonly props: JsonObject;
}

export interface ProgrammableTemplateMetadataInput {
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly variants?: readonly ProgrammableTemplateVariantInput[];
}

export interface ProgrammableTemplateMetadata {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly variants: readonly ProgrammableTemplateVariant[];
}

export interface ProgrammableTemplate<Props extends JsonObject = JsonObject> {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly id: string;
  readonly composition: ProgrammableCompositionDefinition<Props>;
  readonly metadata: ProgrammableTemplateMetadata;
}

export interface ProgrammableTemplateInvocationInput {
  readonly templateId: string;
  readonly variantId?: string;
  readonly props?: JsonObject;
}

export interface ProgrammableTemplateInvocation {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly templateId: string;
  readonly variantId?: string;
  readonly props: JsonObject;
}

export interface ResolvedProgrammableTemplateInvocation<
  Props extends JsonObject = JsonObject
> {
  readonly invocation: ProgrammableTemplateInvocation;
  readonly template: ProgrammableTemplate<Props>;
  readonly variant?: ProgrammableTemplateVariant;
  readonly composition: ResolvedProgrammableComposition<Props>;
}

interface ProgrammableTemplateCatalogEntryBase {
  readonly schemaVersion: ProgrammableTemplateSchemaVersion;
  readonly id: string;
  readonly kind: ProgrammableCompositionKind;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly variants: readonly ProgrammableTemplateVariant[];
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeVariantJson(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProgrammableTemplateError(`${path} must contain only finite numbers.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => normalizeVariantJson(item, `${path}[${index}]`)));
  }
  if (isPlainObject(value)) {
    const normalized = Object.fromEntries(
      Object.keys(value)
        .sort(compareStableText)
        .map((key) => [key, normalizeVariantJson(value[key], `${path}.${key}`)])
    ) as Record<string, JsonValue>;
    return Object.freeze(normalized);
  }
  throw new ProgrammableTemplateError(`${path} must contain JSON-compatible values only.`);
}

function normalizeVariantProps(props: JsonObject | undefined, index: number): JsonObject {
  const normalized = normalizeVariantJson(props ?? {}, `template.variants[${index}].props`);
  if (!isPlainObject(normalized)) {
    throw new ProgrammableTemplateError(`template.variants[${index}].props must be a JSON object.`);
  }
  return normalized as JsonObject;
}

function normalizeInvocationProps(props: JsonObject | undefined): JsonObject {
  const normalized = normalizeVariantJson(props ?? {}, "invocation.props");
  if (!isPlainObject(normalized)) {
    throw new ProgrammableTemplateError("invocation.props must be a JSON object.");
  }
  return normalized as JsonObject;
}

export function normalizeProgrammableTemplateInvocation(
  input: ProgrammableTemplateInvocationInput
): ProgrammableTemplateInvocation {
  const variantId = optionalText(input.variantId, "invocation.variantId");
  return Object.freeze({
    schemaVersion: PROGRAMMABLE_TEMPLATE_SCHEMA_VERSION,
    templateId: requiredText(input.templateId, "invocation.templateId"),
    ...(variantId === undefined ? {} : { variantId }),
    props: normalizeInvocationProps(input.props)
  });
}

function normalizeVariants(
  variants: readonly ProgrammableTemplateVariantInput[] | undefined
): readonly ProgrammableTemplateVariant[] {
  if (variants === undefined) return Object.freeze([]);
  const seen = new Set<string>();
  const normalized = variants.map((variant, index) => {
    const id = requiredText(variant.id, `template.variants[${index}].id`);
    if (seen.has(id)) {
      throw new ProgrammableTemplateError(`Duplicate template variant id: ${id}`);
    }
    seen.add(id);
    const label = optionalText(variant.label, `template.variants[${index}].label`);
    if (!["16:9", "9:16", "1:1"].includes(variant.aspectRatio)) {
      throw new ProgrammableTemplateError(
        `template.variants[${index}].aspectRatio must be one of 16:9, 9:16, or 1:1.`
      );
    }
    return Object.freeze({
      id,
      ...(label === undefined ? {} : { label }),
      aspectRatio: variant.aspectRatio,
      props: normalizeVariantProps(variant.props, index)
    });
  });
  return Object.freeze(normalized.sort((left, right) => compareStableText(left.id, right.id)));
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
    tags: normalizeTags(metadata.tags),
    variants: normalizeVariants(metadata.variants)
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
    variants: template.metadata.variants,
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

export interface ResolvedProgrammableTemplateVariant<Props extends JsonObject = JsonObject> {
  readonly templateId: string;
  readonly variant: ProgrammableTemplateVariant;
  readonly composition: ResolvedProgrammableComposition<Props>;
}

function aspectRatioDimensions(aspectRatio: ProgrammableTemplateAspectRatio): readonly [number, number] {
  if (aspectRatio === "16:9") return [16, 9];
  if (aspectRatio === "9:16") return [9, 16];
  return [1, 1];
}

function requireTemplateVariant<Props extends JsonObject>(
  template: ProgrammableTemplate<Props>,
  variantId: string
): ProgrammableTemplateVariant {
  const variant = template.metadata.variants.find((candidate) => candidate.id === variantId);
  if (!variant) {
    throw new ProgrammableTemplateError(
      `Template "${template.id}" does not define variant "${variantId}".`
    );
  }
  return variant;
}

function assertVariantAspectRatio(
  variant: ProgrammableTemplateVariant,
  composition: ResolvedProgrammableComposition
): void {
  const [ratioWidth, ratioHeight] = aspectRatioDimensions(variant.aspectRatio);
  if (composition.metadata.width * ratioHeight !== composition.metadata.height * ratioWidth) {
    throw new ProgrammableTemplateError(
      `Template variant "${variant.id}" declares ${variant.aspectRatio} but resolved ${composition.metadata.width}:${composition.metadata.height}.`
    );
  }
}

export async function resolveProgrammableTemplateVariant<Props extends JsonObject>(
  template: ProgrammableTemplate<Props>,
  variantId: string,
  inputProps?: Partial<Props>
): Promise<ResolvedProgrammableTemplateVariant<Props>> {
  const variant = requireTemplateVariant(template, variantId);
  const composition = await resolveProgrammableComposition(template.composition, {
    ...variant.props,
    ...(inputProps ?? {})
  } as Partial<Props>);
  assertVariantAspectRatio(variant, composition);
  return Object.freeze({ templateId: template.id, variant, composition });
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

export async function resolveProgrammableTemplateInvocation<Props extends JsonObject = JsonObject>(
  catalog: ProgrammableTemplateCatalog,
  input: ProgrammableTemplateInvocationInput
): Promise<ResolvedProgrammableTemplateInvocation<Props>> {
  const invocation = normalizeProgrammableTemplateInvocation(input);
  const template = catalog.require<Props>(invocation.templateId);

  if (invocation.variantId !== undefined) {
    const resolved = await resolveProgrammableTemplateVariant(
      template,
      invocation.variantId,
      invocation.props as Partial<Props>
    );
    return Object.freeze({
      invocation,
      template,
      variant: resolved.variant,
      composition: resolved.composition
    });
  }

  const composition = await resolveProgrammableComposition(
    template.composition,
    invocation.props as Partial<Props>
  );
  return Object.freeze({ invocation, template, composition });
}

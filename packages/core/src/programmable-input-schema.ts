export const PROGRAMMABLE_INPUT_SCHEMA_VERSION = 1 as const;

export type ProgrammableInputSchemaVersion = typeof PROGRAMMABLE_INPUT_SCHEMA_VERSION;
export type ProgrammableInputPrimitive = string | number | boolean | null;

export type ProgrammableInputValidationCode =
  | "REQUIRED"
  | "TYPE"
  | "MIN_LENGTH"
  | "MAX_LENGTH"
  | "MINIMUM"
  | "MAXIMUM"
  | "INTEGER"
  | "ENUM"
  | "MIN_ITEMS"
  | "MAX_ITEMS"
  | "UNKNOWN_PROPERTY";

export interface ProgrammableInputValidationIssue {
  readonly path: string;
  readonly code: ProgrammableInputValidationCode;
  readonly message: string;
}

interface ProgrammableInputSchemaBase {
  readonly title?: string;
  readonly description?: string;
}

export interface ProgrammableInputStringSchema extends ProgrammableInputSchemaBase {
  readonly type: "string";
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface ProgrammableInputNumberSchema extends ProgrammableInputSchemaBase {
  readonly type: "number";
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ProgrammableInputBooleanSchema extends ProgrammableInputSchemaBase {
  readonly type: "boolean";
}

export interface ProgrammableInputEnumSchema extends ProgrammableInputSchemaBase {
  readonly type: "enum";
  readonly values: readonly ProgrammableInputPrimitive[];
}

export interface ProgrammableInputArraySchema extends ProgrammableInputSchemaBase {
  readonly type: "array";
  readonly items: ProgrammableInputSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ProgrammableInputObjectSchema extends ProgrammableInputSchemaBase {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ProgrammableInputSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export type ProgrammableInputSchema =
  | ProgrammableInputStringSchema
  | ProgrammableInputNumberSchema
  | ProgrammableInputBooleanSchema
  | ProgrammableInputEnumSchema
  | ProgrammableInputArraySchema
  | ProgrammableInputObjectSchema;

export class InvalidProgrammableInputSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProgrammableInputSchemaError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertOptionalText(value: string | undefined, path: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new InvalidProgrammableInputSchemaError(`${path} cannot be empty.`);
  return normalized;
}

function assertNonNegativeInteger(value: number | undefined, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidProgrammableInputSchemaError(`${path} must be a non-negative integer.`);
  }
  return value;
}

function assertFiniteNumber(value: number | undefined, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new InvalidProgrammableInputSchemaError(`${path} must be a finite number.`);
  }
  return value;
}

function samePrimitive(left: ProgrammableInputPrimitive, right: ProgrammableInputPrimitive): boolean {
  return Object.is(left, right);
}

function normalizeBase(schema: ProgrammableInputSchemaBase, path: string) {
  const title = assertOptionalText(schema.title, `${path}.title`);
  const description = assertOptionalText(schema.description, `${path}.description`);
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description })
  };
}

function normalizeSchema(schema: ProgrammableInputSchema, path: string): ProgrammableInputSchema {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new InvalidProgrammableInputSchemaError(`${path} must be a schema object.`);
  }

  const base = normalizeBase(schema, path);
  switch (schema.type) {
    case "string": {
      const minLength = assertNonNegativeInteger(schema.minLength, `${path}.minLength`);
      const maxLength = assertNonNegativeInteger(schema.maxLength, `${path}.maxLength`);
      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
        throw new InvalidProgrammableInputSchemaError(`${path}.minLength cannot exceed maxLength.`);
      }
      return Object.freeze({
        ...base,
        type: "string" as const,
        ...(minLength === undefined ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength })
      });
    }
    case "number": {
      const minimum = assertFiniteNumber(schema.minimum, `${path}.minimum`);
      const maximum = assertFiniteNumber(schema.maximum, `${path}.maximum`);
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        throw new InvalidProgrammableInputSchemaError(`${path}.minimum cannot exceed maximum.`);
      }
      return Object.freeze({
        ...base,
        type: "number" as const,
        ...(schema.integer === undefined ? {} : { integer: schema.integer === true }),
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum })
      });
    }
    case "boolean":
      return Object.freeze({ ...base, type: "boolean" as const });
    case "enum": {
      if (!Array.isArray(schema.values) || schema.values.length === 0) {
        throw new InvalidProgrammableInputSchemaError(`${path}.values must contain at least one primitive value.`);
      }
      const values: ProgrammableInputPrimitive[] = [];
      for (let index = 0; index < schema.values.length; index += 1) {
        const value = schema.values[index];
        if (
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "boolean" &&
          (typeof value !== "number" || !Number.isFinite(value))
        ) {
          throw new InvalidProgrammableInputSchemaError(`${path}.values[${index}] must be a finite JSON primitive.`);
        }
        if (values.some((existing) => samePrimitive(existing, value))) {
          throw new InvalidProgrammableInputSchemaError(`${path}.values cannot contain duplicates.`);
        }
        values.push(value);
      }
      return Object.freeze({ ...base, type: "enum" as const, values: Object.freeze(values) });
    }
    case "array": {
      const minItems = assertNonNegativeInteger(schema.minItems, `${path}.minItems`);
      const maxItems = assertNonNegativeInteger(schema.maxItems, `${path}.maxItems`);
      if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
        throw new InvalidProgrammableInputSchemaError(`${path}.minItems cannot exceed maxItems.`);
      }
      return Object.freeze({
        ...base,
        type: "array" as const,
        items: normalizeSchema(schema.items, `${path}.items`),
        ...(minItems === undefined ? {} : { minItems }),
        ...(maxItems === undefined ? {} : { maxItems })
      });
    }
    case "object": {
      if (schema.properties === null || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
        throw new InvalidProgrammableInputSchemaError(`${path}.properties must be an object.`);
      }
      const properties = Object.fromEntries(
        Object.keys(schema.properties)
          .sort(compareText)
          .map((key) => {
            if (!key.trim() || key !== key.trim()) {
              throw new InvalidProgrammableInputSchemaError(`${path}.properties keys cannot be empty or padded.`);
            }
            return [key, normalizeSchema(schema.properties[key]!, `${path}.properties.${key}`)];
          })
      );
      const required = [...new Set(schema.required ?? [])].sort(compareText);
      for (const key of required) {
        if (!key.trim() || key !== key.trim()) {
          throw new InvalidProgrammableInputSchemaError(`${path}.required keys cannot be empty or padded.`);
        }
        if (!(key in properties)) {
          throw new InvalidProgrammableInputSchemaError(`${path}.required references unknown property "${key}".`);
        }
      }
      return Object.freeze({
        ...base,
        type: "object" as const,
        properties: Object.freeze(properties),
        ...(required.length === 0 ? {} : { required: Object.freeze(required) }),
        additionalProperties: schema.additionalProperties === true
      });
    }
    default:
      throw new InvalidProgrammableInputSchemaError(
        `${path}.type must be one of string, number, boolean, enum, array, or object.`
      );
  }
}

export function normalizeProgrammableInputSchema(
  schema: ProgrammableInputObjectSchema
): ProgrammableInputObjectSchema {
  const normalized = normalizeSchema(schema, "inputSchema");
  if (normalized.type !== "object") {
    throw new InvalidProgrammableInputSchemaError("Composition inputSchema must use type \"object\".");
  }
  return normalized;
}

function issue(path: string, code: ProgrammableInputValidationCode, message: string): ProgrammableInputValidationIssue {
  return Object.freeze({ path, code, message });
}

function validateValue(
  schema: ProgrammableInputSchema,
  value: unknown,
  path: string,
  issues: ProgrammableInputValidationIssue[]
): void {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        issues.push(issue(path, "TYPE", "must be a string."));
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push(issue(path, "MIN_LENGTH", `must contain at least ${schema.minLength} characters.`));
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        issues.push(issue(path, "MAX_LENGTH", `must contain at most ${schema.maxLength} characters.`));
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(issue(path, "TYPE", "must be a finite number."));
        return;
      }
      if (schema.integer === true && !Number.isInteger(value)) {
        issues.push(issue(path, "INTEGER", "must be an integer."));
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        issues.push(issue(path, "MINIMUM", `must be greater than or equal to ${schema.minimum}.`));
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        issues.push(issue(path, "MAXIMUM", `must be less than or equal to ${schema.maximum}.`));
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") issues.push(issue(path, "TYPE", "must be a boolean."));
      return;
    case "enum":
      if (!schema.values.some((candidate) => samePrimitive(candidate, value as ProgrammableInputPrimitive))) {
        issues.push(issue(path, "ENUM", "must match one of the declared enum values."));
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        issues.push(issue(path, "TYPE", "must be an array."));
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        issues.push(issue(path, "MIN_ITEMS", `must contain at least ${schema.minItems} items.`));
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        issues.push(issue(path, "MAX_ITEMS", `must contain at most ${schema.maxItems} items.`));
      }
      value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, issues));
      return;
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push(issue(path, "TYPE", "must be an object."));
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) issues.push(issue(`${path}.${key}`, "REQUIRED", "is required."));
      }
      for (const key of Object.keys(record).sort(compareText)) {
        const propertySchema = schema.properties[key];
        if (propertySchema === undefined) {
          if (schema.additionalProperties !== true) {
            issues.push(issue(`${path}.${key}`, "UNKNOWN_PROPERTY", "is not declared in the input schema."));
          }
          continue;
        }
        validateValue(propertySchema, record[key], `${path}.${key}`, issues);
      }
      return;
    }
  }
}

export function validateProgrammableInput(
  schema: ProgrammableInputObjectSchema,
  value: unknown,
  rootPath = "props"
): readonly ProgrammableInputValidationIssue[] {
  const issues: ProgrammableInputValidationIssue[] = [];
  validateValue(schema, value, rootPath, issues);
  return Object.freeze(issues);
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  ProgrammableCompositionConflictError,
  ProgrammableCompositionNotFoundError,
  ProgrammableTemplateCatalog,
  ProgrammableTemplateError,
  defineComposition,
  defineProgrammableTemplate,
  defineStill,
  getProgrammableTemplateCatalogEntry,
  normalizeProgrammableTemplateMetadata
} from "../src/index.js";

test("template metadata normalizes deterministically around an existing composition", () => {
  const composition = defineComposition({
    id: "product-demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 180,
    defaultProps: { title: "Vexa" },
    inputSchema: {
      type: "object",
      properties: { title: { type: "string", minLength: 1 } },
      required: ["title"],
      additionalProperties: false
    }
  });
  const template = defineProgrammableTemplate(composition, {
    name: " Product Demo ",
    description: " Reusable product launch video ",
    category: " Marketing ",
    tags: ["launch", "product", "launch"]
  });

  assert.equal(template.id, composition.id);
  assert.equal(template.composition, composition);
  assert.deepEqual(template.metadata, {
    schemaVersion: 1,
    name: "Product Demo",
    description: "Reusable product launch video",
    category: "Marketing",
    tags: ["launch", "product"]
  });
  assert.equal(Object.isFrozen(template), true);
  assert.equal(Object.isFrozen(template.metadata), true);
  assert.equal(Object.isFrozen(template.metadata.tags), true);
});

test("catalog entries expose JSON-safe composition discovery metadata", () => {
  const template = defineProgrammableTemplate(
    defineComposition({
      id: "social-card",
      width: 1080,
      height: 1080,
      fps: 30,
      durationInFrames: 90,
      defaultProps: { title: "Hello" },
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"]
      }
    }),
    { name: "Social Card", tags: ["social"] }
  );

  const entry = getProgrammableTemplateCatalogEntry(template);
  assert.deepEqual(JSON.parse(JSON.stringify(entry)), {
    schemaVersion: 1,
    id: "social-card",
    kind: "video",
    name: "Social Card",
    tags: ["social"],
    width: 1080,
    height: 1080,
    defaultProps: { title: "Hello" },
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false
    },
    fps: 30,
    durationInFrames: 90
  });
});

test("template catalog is sorted, duplicate-safe, atomic, and preserves composition identity", () => {
  const alpha = defineProgrammableTemplate(
    defineStill({ id: "alpha", width: 100, height: 100 }),
    { name: "Alpha" }
  );
  const zeta = defineProgrammableTemplate(
    defineStill({ id: "zeta", width: 100, height: 100 }),
    { name: "Zeta" }
  );
  const catalog = new ProgrammableTemplateCatalog();
  catalog.registerMany([zeta, alpha]);

  assert.deepEqual(catalog.list().map((item) => item.id), ["alpha", "zeta"]);
  assert.deepEqual(catalog.listEntries().map((item) => item.id), ["alpha", "zeta"]);
  assert.equal(catalog.require("alpha").composition, alpha.composition);
  assert.throws(() => catalog.require("missing"), ProgrammableCompositionNotFoundError);
  assert.throws(() => catalog.register(alpha), ProgrammableCompositionConflictError);

  const atomic = new ProgrammableTemplateCatalog();
  atomic.register(alpha);
  assert.throws(() => atomic.registerMany([zeta, alpha]), ProgrammableCompositionConflictError);
  assert.equal(atomic.has("zeta"), false);
  assert.equal(atomic.size, 1);
});

test("invalid template metadata fails before catalog registration", () => {
  assert.throws(
    () => normalizeProgrammableTemplateMetadata({ name: "   " }),
    ProgrammableTemplateError
  );
  assert.throws(
    () => normalizeProgrammableTemplateMetadata({ name: "Valid", tags: [""] }),
    /template.tags\[0\] cannot be empty/
  );
  assert.throws(
    () => normalizeProgrammableTemplateMetadata({ name: "Valid", category: "   " }),
    /template.category cannot be empty/
  );
});

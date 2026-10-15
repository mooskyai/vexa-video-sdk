import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProgrammableCompositionError,
  InvalidProgrammableCompositionPropsError,
  ProgrammableCompositionConflictError,
  ProgrammableCompositionMetadataError,
  ProgrammableCompositionNotFoundError,
  ProgrammableCompositionRegistry,
  defineComposition,
  defineStill,
  normalizeProgrammableInputSchema,
  validateProgrammableInput,
  resolveProgrammableComposition,
  serializeProgrammableCompositionMetadata
} from "../src/index.js";

test("defineComposition normalizes video metadata and JSON props", () => {
  const composition = defineComposition({
    id: "product-demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300,
    defaultProps: {
      title: "Vexa",
      nested: { z: 1, a: true }
    }
  });

  assert.equal(composition.schemaVersion, 1);
  assert.equal(composition.kind, "video");
  assert.equal(composition.fps, 30);
  assert.equal(Object.isFrozen(composition), true);
  assert.equal(Object.isFrozen(composition.defaultProps), true);
  assert.equal(Object.isFrozen(composition.defaultProps.nested), true);
  assert.deepEqual(composition.defaultProps, {
    nested: { a: true, z: 1 },
    title: "Vexa"
  });
});

test("defineStill creates still metadata without video timing", () => {
  const still = defineStill({ id: "thumbnail", width: 1280, height: 720 });
  assert.equal(still.kind, "still");
  assert.equal("fps" in still, false);
  assert.deepEqual(still.defaultProps, {});
});

test("invalid dimensions, timing, ids, and schema versions fail before rendering", () => {
  assert.throws(
    () => defineComposition({ id: "", width: 1, height: 1, fps: 30, durationInFrames: 1 }),
    InvalidProgrammableCompositionError
  );
  assert.throws(
    () => defineComposition({ id: "bad", width: 0, height: 1, fps: 30, durationInFrames: 1 }),
    /width must be a positive integer/
  );
  assert.throws(
    () => defineComposition({ id: "bad", width: 1, height: 1, fps: 0, durationInFrames: 1 }),
    /fps must be a finite number greater than 0/
  );
  assert.throws(
    () => defineComposition({ id: "bad", width: 1, height: 1, fps: 30, durationInFrames: 0 }),
    /durationInFrames must be a positive integer/
  );
  assert.throws(
    () => defineStill({ schemaVersion: 2, id: "bad", width: 1, height: 1 }),
    /Unsupported programmable composition schema version/
  );
});

test("default and input props must remain JSON-compatible", async () => {
  assert.throws(
    () => defineStill({
      id: "bad-props",
      width: 1,
      height: 1,
      defaultProps: { value: Number.NaN }
    }),
    InvalidProgrammableCompositionError
  );

  const composition = defineComposition({
    id: "props",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 30,
    defaultProps: { title: "default" },
    validateProps(props) {
      if (props.title === "forbidden") throw new Error("title is forbidden");
    }
  });

  await assert.rejects(
    () => resolveProgrammableComposition(composition, { title: "forbidden" }),
    InvalidProgrammableCompositionPropsError
  );
});

test("dynamic metadata receives merged props and can override timing", async () => {
  const composition = defineComposition({
    id: "dynamic",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 300,
    defaultProps: { seconds: 2, title: "default" },
    calculateMetadata({ props, staticMetadata }) {
      assert.equal(staticMetadata.width, 1920);
      return {
        width: props.title === "square" ? 1080 : staticMetadata.width,
        durationInFrames: props.seconds * staticMetadata.fps
      };
    }
  });

  const resolved = await resolveProgrammableComposition(composition, {
    seconds: 5,
    title: "square"
  });

  assert.equal(resolved.metadata.kind, "video");
  assert.equal(resolved.metadata.width, 1080);
  if (resolved.metadata.kind !== "video") return;
  assert.equal(resolved.metadata.durationInFrames, 150);
  assert.deepEqual(resolved.props, { seconds: 5, title: "square" });
});

test("invalid dynamic metadata is reported as a metadata failure", async () => {
  const composition = defineComposition({
    id: "invalid-metadata",
    width: 100,
    height: 100,
    fps: 30,
    durationInFrames: 30,
    calculateMetadata() {
      return { width: 0 };
    }
  });

  await assert.rejects(
    () => resolveProgrammableComposition(composition),
    ProgrammableCompositionMetadataError
  );
});

test("metadata calculation failures are typed", async () => {
  const composition = defineStill({
    id: "broken-metadata",
    width: 100,
    height: 100,
    calculateMetadata() {
      throw new Error("provider failed");
    }
  });

  await assert.rejects(
    () => resolveProgrammableComposition(composition),
    ProgrammableCompositionMetadataError
  );
});

test("registry discovery is sorted and duplicate-safe", () => {
  const registry = new ProgrammableCompositionRegistry();
  registry.register(defineStill({ id: "zeta", width: 100, height: 100 }));
  registry.register(defineStill({ id: "alpha", width: 100, height: 100 }));

  assert.deepEqual(registry.list().map((item) => item.id), ["alpha", "zeta"]);
  assert.deepEqual(registry.listMetadata().map((item) => item.id), ["alpha", "zeta"]);
  assert.equal(registry.require("alpha").id, "alpha");
  assert.throws(
    () => registry.register(defineStill({ id: "alpha", width: 100, height: 100 })),
    ProgrammableCompositionConflictError
  );
  assert.throws(() => registry.require("missing"), ProgrammableCompositionNotFoundError);
});

test("registerMany is atomic when a conflict exists", () => {
  const registry = new ProgrammableCompositionRegistry();
  registry.register(defineStill({ id: "existing", width: 100, height: 100 }));

  assert.throws(
    () => registry.registerMany([
      defineStill({ id: "new", width: 100, height: 100 }),
      defineStill({ id: "existing", width: 100, height: 100 })
    ]),
    ProgrammableCompositionConflictError
  );
  assert.equal(registry.has("new"), false);
  assert.equal(registry.size, 1);
});

test("static metadata serialization is deterministic across object key insertion order", () => {
  const first = defineStill({
    id: "stable",
    width: 100,
    height: 100,
    defaultProps: { b: 2, a: { z: false, a: true } }
  });
  const second = defineStill({
    id: "stable",
    width: 100,
    height: 100,
    defaultProps: { a: { a: true, z: false }, b: 2 }
  });

  assert.equal(
    serializeProgrammableCompositionMetadata(first),
    serializeProgrammableCompositionMetadata(second)
  );
});

test("input schemas normalize deterministically and validate resolved props before custom validation", async () => {
  let customValidated = 0;
  const composition = defineComposition({
    id: "schema-demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 60,
    defaultProps: { title: "Vexa", seconds: 2, layout: "wide" },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 40 },
        seconds: { type: "number", integer: true, minimum: 1, maximum: 10 },
        layout: { type: "enum", values: ["square", "wide"] }
      },
      required: ["title", "seconds"],
      additionalProperties: false
    },
    validateProps() { customValidated += 1; },
    calculateMetadata({ props, staticMetadata }) {
      return { durationInFrames: props.seconds * staticMetadata.fps };
    }
  });

  assert.equal(Object.isFrozen(composition.inputSchema), true);
  assert.deepEqual(composition.inputSchema?.required, ["seconds", "title"]);
  const serialized = JSON.parse(serializeProgrammableCompositionMetadata(composition));
  assert.deepEqual(Object.keys(serialized.inputSchema.properties), ["layout", "seconds", "title"]);

  const resolved = await resolveProgrammableComposition(composition, { seconds: 3, layout: "square" });
  assert.equal(resolved.metadata.kind, "video");
  if (resolved.metadata.kind === "video") assert.equal(resolved.metadata.durationInFrames, 90);
  assert.equal(customValidated, 1);

  await assert.rejects(
    () => resolveProgrammableComposition(composition, { title: "" }),
    (error: unknown) => error instanceof InvalidProgrammableCompositionPropsError && /props.title/.test(error.message)
  );
  assert.equal(customValidated, 1);
  await assert.rejects(
    () => resolveProgrammableComposition(composition, { extra: true } as never),
    (error: unknown) => error instanceof InvalidProgrammableCompositionPropsError && /UNKNOWN|not declared|props.extra/.test(error.message)
  );
});

test("invalid schemas and defaults fail while standalone validation reports stable paths", () => {
  assert.throws(
    () => normalizeProgrammableInputSchema({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["missing"]
    }),
    /references unknown property/
  );

  assert.throws(
    () => defineStill({
      id: "bad-schema-default",
      width: 100,
      height: 100,
      defaultProps: { count: 0 },
      inputSchema: {
        type: "object",
        properties: { count: { type: "number", minimum: 1 } },
        required: ["count"]
      }
    }),
    /defaultProps do not satisfy inputSchema/
  );

  const schema = normalizeProgrammableInputSchema({
    type: "object",
    properties: { tags: { type: "array", items: { type: "string", minLength: 2 }, minItems: 1 } },
    required: ["tags"]
  });
  assert.deepEqual(validateProgrammableInput(schema, { tags: ["ok", "x"] }), [
    { path: "props.tags[1]", code: "MIN_LENGTH", message: "must contain at least 2 characters." }
  ]);
});

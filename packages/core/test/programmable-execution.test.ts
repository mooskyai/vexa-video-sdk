import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutableProgrammableCompositionConflictError,
  ExecutableProgrammableCompositionExecutionError,
  ExecutableProgrammableCompositionNotFoundError,
  ExecutableProgrammableCompositionRegistry,
  ExecutableProgrammableCompositionSceneMismatchError,
  defineComposition,
  defineExecutableComposition,
  defineExecutableCompositions,
  defineProgrammableScene,
  defineStill,
  evaluateExecutableComposition
} from "../src/index.js";

test("executable composition resolves input props and dynamic metadata before creating scene intent", async () => {
  const definition = defineComposition({
    id: "product-demo",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 60,
    defaultProps: { title: "Default", seconds: 2 },
    calculateMetadata({ props, staticMetadata }) {
      return {
        width: props.title === "Square" ? 1080 : staticMetadata.width,
        durationInFrames: props.seconds * staticMetadata.fps
      };
    }
  });

  const executable = defineExecutableComposition({
    definition,
    createScene({ metadata, props, resolved }) {
      assert.equal(props.title, "Square");
      assert.equal(resolved.props.seconds, 4);
      assert.equal(metadata.kind, "video");
      if (metadata.kind !== "video") throw new Error("expected video metadata");
      return defineProgrammableScene({
        id: metadata.id,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        durationInFrames: metadata.durationInFrames,
        background: "#101010"
      });
    }
  });

  const evaluated = await evaluateExecutableComposition(executable, {
    title: "Square",
    seconds: 4
  });

  assert.equal(evaluated.resolved.metadata.width, 1080);
  assert.equal(evaluated.scene.width, 1080);
  assert.equal(evaluated.scene.durationInFrames, 120);
  assert.equal(Object.isFrozen(evaluated), true);
});

test("still executable compositions use a deterministic one-frame scene", async () => {
  const definition = defineStill({
    id: "social-square",
    width: 1080,
    height: 1080,
    defaultProps: { title: "Launch" }
  });
  const executable = defineExecutableComposition({
    definition,
    createScene({ metadata, props }) {
      assert.equal(props.title, "Launch");
      return defineProgrammableScene({
        id: metadata.id,
        width: metadata.width,
        height: metadata.height,
        fps: 1,
        durationInFrames: 1,
        background: "#ffffff"
      });
    }
  });

  const evaluated = await evaluateExecutableComposition(executable);
  assert.equal(evaluated.scene.fps, 1);
  assert.equal(evaluated.scene.durationInFrames, 1);
});

test("scene metadata mismatches fail with a typed execution-boundary error", async () => {
  const executable = defineExecutableComposition({
    definition: defineComposition({
      id: "mismatch",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 90
    }),
    createScene() {
      return defineProgrammableScene({
        id: "wrong-id",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 90
      });
    }
  });

  await assert.rejects(
    () => evaluateExecutableComposition(executable),
    ExecutableProgrammableCompositionSceneMismatchError
  );
});

test("scene factory failures preserve the cause behind a typed execution error", async () => {
  const executable = defineExecutableComposition({
    definition: defineStill({ id: "broken", width: 100, height: 100 }),
    createScene() {
      throw new Error("renderer source failed");
    }
  });

  await assert.rejects(
    async () => {
      try {
        await evaluateExecutableComposition(executable);
      } catch (error) {
        assert.ok(error instanceof ExecutableProgrammableCompositionExecutionError);
        assert.equal(error.compositionId, "broken");
        assert.equal((error.cause as Error).message, "renderer source failed");
        throw error;
      }
    },
    ExecutableProgrammableCompositionExecutionError
  );
});

test("executable registry is deterministic, duplicate-safe, and reports missing executable definitions", () => {
  const make = (id: string) =>
    defineExecutableComposition({
      definition: defineStill({ id, width: 100, height: 100 }),
      createScene({ metadata }) {
        return defineProgrammableScene({
          id: metadata.id,
          width: metadata.width,
          height: metadata.height,
          fps: 1,
          durationInFrames: 1
        });
      }
    });

  const registry = new ExecutableProgrammableCompositionRegistry();
  registry.register(make("zeta"));
  registry.register(make("alpha"));

  assert.deepEqual(registry.list().map((entry) => entry.definition.id), ["alpha", "zeta"]);
  assert.deepEqual(registry.listMetadata().map((metadata) => metadata.id), ["alpha", "zeta"]);
  assert.throws(() => registry.register(make("alpha")), ExecutableProgrammableCompositionConflictError);
  assert.throws(() => registry.require("missing"), ExecutableProgrammableCompositionNotFoundError);
});

test("defineExecutableCompositions returns a sorted frozen bundle-facing collection", () => {
  const make = (id: string) =>
    defineExecutableComposition({
      definition: defineStill({ id, width: 100, height: 100 }),
      createScene({ metadata }) {
        return defineProgrammableScene({
          id: metadata.id,
          width: metadata.width,
          height: metadata.height,
          fps: 1,
          durationInFrames: 1
        });
      }
    });

  const entries = defineExecutableCompositions([make("beta"), make("alpha")]);
  assert.equal(Object.isFrozen(entries), true);
  assert.deepEqual(entries.map((entry) => entry.definition.id), ["alpha", "beta"]);
});

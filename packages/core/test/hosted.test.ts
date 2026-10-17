import assert from "node:assert/strict";
import test from "node:test";
import { createHostedCompositionRenderRequest } from "../src/hosted.js";

test("hosted composition requests normalize deterministic JSON and render identity", () => {
  const request = createHostedCompositionRenderRequest(
    {
      schemaVersion: 1,
      bundle: { id: " bundle-42 ", manifest: " s3://bundles/42/vexa.bundle.json " },
      compositionId: " product-demo ",
      target: { kind: "frame-range", startFrame: 10, endFrameExclusive: 20, format: "png" },
      inputProps: { z: 1, nested: { b: true, a: "x" } },
      output: { artifactId: " render/customer-42/7 ", destination: " s3://renders/7/ " }
    },
    {
      idempotencyKey: " render-7 ",
      metadata: { z: 2, a: "customer-42" }
    }
  );

  assert.equal(request.type, "composition.render");
  assert.equal(request.payload.bundle.id, "bundle-42");
  assert.equal(request.payload.compositionId, "product-demo");
  assert.equal(request.payload.output.artifactId, "render/customer-42/7");
  assert.equal(request.idempotencyKey, "render-7");
  assert.equal(
    JSON.stringify(request.payload.inputProps),
    '{"nested":{"a":"x","b":true},"z":1}'
  );
  assert.deepEqual(Object.keys(request.metadata ?? {}), ["a", "z"]);
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.payload));
});

test("hosted composition requests reject invalid ranges and non-JSON props", () => {
  const base = {
    schemaVersion: 1 as const,
    bundle: { id: "bundle", manifest: "bundle://manifest" },
    compositionId: "demo",
    output: { artifactId: "artifact" }
  };

  assert.throws(
    () => createHostedCompositionRenderRequest({ ...base, target: { kind: "frame-range", startFrame: 10, endFrameExclusive: 10 } }),
    /greater than startFrame/
  );
  assert.throws(
    () => createHostedCompositionRenderRequest({
      ...base,
      target: { kind: "still" },
      inputProps: { bad: Number.POSITIVE_INFINITY }
    }),
    /finite numbers/
  );
  assert.throws(
    () => createHostedCompositionRenderRequest({ ...base, target: { kind: "video", startFrame: 10 } }),
    /require both startFrame and endFrameExclusive/
  );
  assert.throws(
    () => createHostedCompositionRenderRequest({
      ...base,
      target: { kind: "still", format: "gif" as never }
    }),
    /image format/
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(
    () => createHostedCompositionRenderRequest({
      ...base,
      target: { kind: "still" },
      inputProps: circular as never
    }),
    /circular references/
  );
  assert.throws(
    () => createHostedCompositionRenderRequest(
      { ...base, target: { kind: "still" } },
      { metadata: { invalid: Number.POSITIVE_INFINITY } }
    ),
    /metadata.invalid must be finite/
  );
});

test("hosted composition requests require bundle, composition, and artifact identities", () => {
  const base = {
    schemaVersion: 1 as const,
    bundle: { id: "bundle", manifest: "bundle://manifest" },
    compositionId: "demo",
    target: { kind: "still" as const },
    output: { artifactId: "artifact" }
  };
  assert.throws(() => createHostedCompositionRenderRequest({ ...base, bundle: { ...base.bundle, id: " " } }), /bundle.id/);
  assert.throws(() => createHostedCompositionRenderRequest({ ...base, compositionId: " " }), /compositionId/);
  assert.throws(() => createHostedCompositionRenderRequest({ ...base, output: { artifactId: " " } }), /artifactId/);
});

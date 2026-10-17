import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProgrammableShapeError,
  normalizeProgrammableShape,
  programmableShapeToSvgPath,
  serializeProgrammableShape
} from "../src/programmable-shapes.js";

test("shape normalization is deterministic and freezes nested geometry/style", () => {
  const shape = normalizeProgrammableShape({
    geometry: {
      kind: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      radiusX: 12
    },
    style: {
      fill: "#112233",
      stroke: {
        color: "white",
        width: 4,
        lineCap: "round",
        dash: [8, 4]
      }
    }
  });

  assert.deepEqual(shape, {
    geometry: {
      kind: "rectangle",
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      radiusX: 12,
      radiusY: 12
    },
    style: {
      fill: "#112233",
      fillRule: "nonzero",
      stroke: {
        color: "white",
        width: 4,
        lineCap: "round",
        lineJoin: "miter",
        dash: [8, 4]
      }
    }
  });
  assert.equal(Object.isFrozen(shape), true);
  assert.equal(Object.isFrozen(shape.geometry), true);
  assert.equal(Object.isFrozen(shape.style), true);
  assert.equal(Object.isFrozen(shape.style?.stroke), true);
  assert.equal(Object.isFrozen(shape.style?.stroke?.dash), true);
});

test("shape geometry converts to stable SVG path data", () => {
  assert.equal(
    programmableShapeToSvgPath({
      geometry: { kind: "rectangle", width: 100, height: 40 },
      style: { fill: "red" }
    }),
    "M 0 0 H 100 V 40 H 0 Z"
  );

  assert.equal(
    programmableShapeToSvgPath({
      geometry: { kind: "ellipse", cx: 50, cy: 30, radiusX: 20, radiusY: 10 },
      style: { fill: "blue" }
    }),
    "M 70 30 A 20 10 0 1 0 30 30 A 20 10 0 1 0 70 30 Z"
  );

  assert.equal(
    programmableShapeToSvgPath({
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 20, y: 30 }
        ]
      },
      style: { fill: "#fff" }
    }),
    "M 0 0 L 40 0 L 20 30 Z"
  );

  assert.equal(
    programmableShapeToSvgPath({
      geometry: { kind: "arc", cx: 50, cy: 50, radiusX: 25, radiusY: 25, startDegrees: 0, endDegrees: 180 },
      style: { stroke: { color: "white", width: 2 } }
    }),
    "M 75 50 A 25 25 0 0 1 25 50"
  );
});

test("stars are deterministic and default to a top-pointing rotation", () => {
  assert.equal(
    programmableShapeToSvgPath({
      geometry: {
        kind: "star",
        cx: 0,
        cy: 0,
        points: 4,
        innerRadius: 5,
        outerRadius: 10
      },
      style: { fill: "white" }
    }),
    "M 0 -10 L 3.535534 -3.535534 L 10 0 L 3.535534 3.535534 L 0 10 L -3.535534 3.535534 L -10 0 L -3.535534 -3.535534 Z"
  );
});

test("serialization applies defaults before emitting JSON", () => {
  const serialized = serializeProgrammableShape({
    geometry: { kind: "line", from: { x: 0, y: 1 }, to: { x: 2, y: 3 } },
    style: { stroke: { color: "black", width: 1 } }
  });
  assert.equal(
    serialized,
    '{"geometry":{"kind":"line","from":{"x":0,"y":1},"to":{"x":2,"y":3}},"style":{"fillRule":"nonzero","stroke":{"color":"black","width":1,"lineCap":"butt","lineJoin":"miter"}}}'
  );
});

test("invalid shapes fail with typed validation errors", () => {
  assert.throws(
    () => normalizeProgrammableShape({
      geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      style: { fill: "red" }
    }),
    InvalidProgrammableShapeError
  );
  assert.throws(
    () => normalizeProgrammableShape({
      geometry: {
        kind: "star",
        cx: 0,
        cy: 0,
        points: 5,
        innerRadius: 10,
        outerRadius: 5
      },
      style: { fill: "red" }
    }),
    /innerRadius must be smaller/
  );
  assert.throws(
    () => normalizeProgrammableShape({
      geometry: { kind: "arc", cx: 0, cy: 0, radiusX: 5, radiusY: 5, startDegrees: 0, endDegrees: 0 },
      style: { stroke: { color: "red", width: 1 } }
    }),
    /cannot be equal/
  );
  assert.throws(
    () => normalizeProgrammableShape({
      geometry: { kind: "rectangle", width: 10, height: 10 },
      style: {}
    }),
    /must define fill, stroke, or both/
  );
});

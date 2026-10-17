export type ProgrammableShapeFillRule = "nonzero" | "evenodd";
export type ProgrammableShapeLineCap = "butt" | "round" | "square";
export type ProgrammableShapeLineJoin = "miter" | "round" | "bevel";

export type ProgrammableShapeErrorCode = "INVALID_PROGRAMMABLE_SHAPE";

export class InvalidProgrammableShapeError extends Error {
  readonly code = "INVALID_PROGRAMMABLE_SHAPE" as const;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ProgrammableShapePoint {
  readonly x: number;
  readonly y: number;
}

export interface ProgrammableShapeStroke {
  readonly color: string;
  readonly width: number;
  readonly lineCap?: ProgrammableShapeLineCap;
  readonly lineJoin?: ProgrammableShapeLineJoin;
  readonly dash?: readonly number[];
}

export interface ProgrammableShapeStyle {
  readonly fill?: string;
  readonly fillRule?: ProgrammableShapeFillRule;
  readonly stroke?: ProgrammableShapeStroke;
}

export interface ProgrammableRectangleShape {
  readonly kind: "rectangle";
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly radiusX?: number;
  readonly radiusY?: number;
}

export interface ProgrammableEllipseShape {
  readonly kind: "ellipse";
  readonly cx: number;
  readonly cy: number;
  readonly radiusX: number;
  readonly radiusY: number;
}

export interface ProgrammableLineShape {
  readonly kind: "line";
  readonly from: ProgrammableShapePoint;
  readonly to: ProgrammableShapePoint;
}

export interface ProgrammablePolygonShape {
  readonly kind: "polygon";
  readonly points: readonly ProgrammableShapePoint[];
}

export interface ProgrammableStarShape {
  readonly kind: "star";
  readonly cx: number;
  readonly cy: number;
  readonly points: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly rotationDegrees?: number;
}

export interface ProgrammablePathShape {
  readonly kind: "path";
  readonly d: string;
}

export interface ProgrammableArcShape {
  readonly kind: "arc";
  readonly cx: number;
  readonly cy: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly startDegrees: number;
  readonly endDegrees: number;
  readonly rotationDegrees?: number;
  readonly clockwise?: boolean;
}

export type ProgrammableShapeGeometry =
  | ProgrammableRectangleShape
  | ProgrammableEllipseShape
  | ProgrammableLineShape
  | ProgrammablePolygonShape
  | ProgrammableStarShape
  | ProgrammablePathShape
  | ProgrammableArcShape;

export interface ProgrammableShape {
  readonly geometry: ProgrammableShapeGeometry;
  readonly style?: ProgrammableShapeStyle;
}

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new InvalidProgrammableShapeError(`${label} must be finite.`);
  return value;
}

function assertPositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidProgrammableShapeError(`${label} must be a finite number greater than 0.`);
  }
  return value;
}

function assertNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidProgrammableShapeError(`${label} must be a finite number greater than or equal to 0.`);
  }
  return value;
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InvalidProgrammableShapeError(`${label} cannot be empty.`);
  return normalized;
}

function normalizePoint(point: ProgrammableShapePoint, label: string): ProgrammableShapePoint {
  return Object.freeze({
    x: assertFinite(point.x, `${label}.x`),
    y: assertFinite(point.y, `${label}.y`)
  });
}

function normalizeStroke(stroke: ProgrammableShapeStroke | undefined): ProgrammableShapeStroke | undefined {
  if (!stroke) return undefined;
  const lineCap = stroke.lineCap ?? "butt";
  if (lineCap !== "butt" && lineCap !== "round" && lineCap !== "square") {
    throw new InvalidProgrammableShapeError("shape.style.stroke.lineCap is not supported.");
  }
  const lineJoin = stroke.lineJoin ?? "miter";
  if (lineJoin !== "miter" && lineJoin !== "round" && lineJoin !== "bevel") {
    throw new InvalidProgrammableShapeError("shape.style.stroke.lineJoin is not supported.");
  }
  const dash = stroke.dash?.map((value, index) =>
    assertPositive(value, `shape.style.stroke.dash[${index}]`)
  );
  return Object.freeze({
    color: assertNonEmpty(stroke.color, "shape.style.stroke.color"),
    width: assertPositive(stroke.width, "shape.style.stroke.width"),
    lineCap,
    lineJoin,
    ...(dash?.length ? { dash: Object.freeze(dash) } : {})
  });
}

function normalizeStyle(style: ProgrammableShapeStyle): ProgrammableShapeStyle {
  const fillRule = style.fillRule ?? "nonzero";
  if (fillRule !== "nonzero" && fillRule !== "evenodd") {
    throw new InvalidProgrammableShapeError("shape.style.fillRule is not supported.");
  }
  const stroke = normalizeStroke(style.stroke);
  const fill = style.fill === undefined ? undefined : assertNonEmpty(style.fill, "shape.style.fill");
  if (fill === undefined && stroke === undefined) {
    throw new InvalidProgrammableShapeError("shape.style must define fill, stroke, or both.");
  }
  return Object.freeze({
    ...(fill !== undefined ? { fill } : {}),
    fillRule,
    ...(stroke !== undefined ? { stroke } : {})
  });
}

function normalizeGeometry(geometry: ProgrammableShapeGeometry): ProgrammableShapeGeometry {
  if (geometry.kind === "rectangle") {
    const width = assertPositive(geometry.width, "shape.geometry.width");
    const height = assertPositive(geometry.height, "shape.geometry.height");
    const radiusX = geometry.radiusX === undefined
      ? undefined
      : assertNonNegative(geometry.radiusX, "shape.geometry.radiusX");
    const radiusY = geometry.radiusY === undefined
      ? radiusX
      : assertNonNegative(geometry.radiusY, "shape.geometry.radiusY");
    if (radiusX !== undefined && radiusX > width / 2) {
      throw new InvalidProgrammableShapeError("shape.geometry.radiusX cannot exceed half the rectangle width.");
    }
    if (radiusY !== undefined && radiusY > height / 2) {
      throw new InvalidProgrammableShapeError("shape.geometry.radiusY cannot exceed half the rectangle height.");
    }
    return Object.freeze({
      kind: "rectangle",
      x: assertFinite(geometry.x ?? 0, "shape.geometry.x"),
      y: assertFinite(geometry.y ?? 0, "shape.geometry.y"),
      width,
      height,
      ...(radiusX !== undefined ? { radiusX } : {}),
      ...(radiusY !== undefined ? { radiusY } : {})
    });
  }

  if (geometry.kind === "ellipse") {
    return Object.freeze({
      kind: "ellipse",
      cx: assertFinite(geometry.cx, "shape.geometry.cx"),
      cy: assertFinite(geometry.cy, "shape.geometry.cy"),
      radiusX: assertPositive(geometry.radiusX, "shape.geometry.radiusX"),
      radiusY: assertPositive(geometry.radiusY, "shape.geometry.radiusY")
    });
  }

  if (geometry.kind === "line") {
    return Object.freeze({
      kind: "line",
      from: normalizePoint(geometry.from, "shape.geometry.from"),
      to: normalizePoint(geometry.to, "shape.geometry.to")
    });
  }

  if (geometry.kind === "polygon") {
    if (geometry.points.length < 3) {
      throw new InvalidProgrammableShapeError("shape.geometry.points must contain at least 3 points.");
    }
    return Object.freeze({
      kind: "polygon",
      points: Object.freeze(geometry.points.map((point, index) =>
        normalizePoint(point, `shape.geometry.points[${index}]`)
      ))
    });
  }

  if (geometry.kind === "star") {
    if (!Number.isSafeInteger(geometry.points) || geometry.points < 3) {
      throw new InvalidProgrammableShapeError("shape.geometry.points must be an integer greater than or equal to 3.");
    }
    const innerRadius = assertPositive(geometry.innerRadius, "shape.geometry.innerRadius");
    const outerRadius = assertPositive(geometry.outerRadius, "shape.geometry.outerRadius");
    if (innerRadius >= outerRadius) {
      throw new InvalidProgrammableShapeError("shape.geometry.innerRadius must be smaller than outerRadius.");
    }
    return Object.freeze({
      kind: "star",
      cx: assertFinite(geometry.cx, "shape.geometry.cx"),
      cy: assertFinite(geometry.cy, "shape.geometry.cy"),
      points: geometry.points,
      innerRadius,
      outerRadius,
      rotationDegrees: assertFinite(geometry.rotationDegrees ?? -90, "shape.geometry.rotationDegrees")
    });
  }

  if (geometry.kind === "path") {
    return Object.freeze({
      kind: "path",
      d: assertNonEmpty(geometry.d, "shape.geometry.d")
    });
  }

  if (geometry.kind === "arc") {
    const startDegrees = assertFinite(geometry.startDegrees, "shape.geometry.startDegrees");
    const endDegrees = assertFinite(geometry.endDegrees, "shape.geometry.endDegrees");
    if (startDegrees === endDegrees) {
      throw new InvalidProgrammableShapeError("shape.geometry arc startDegrees and endDegrees cannot be equal.");
    }
    return Object.freeze({
      kind: "arc",
      cx: assertFinite(geometry.cx, "shape.geometry.cx"),
      cy: assertFinite(geometry.cy, "shape.geometry.cy"),
      radiusX: assertPositive(geometry.radiusX, "shape.geometry.radiusX"),
      radiusY: assertPositive(geometry.radiusY, "shape.geometry.radiusY"),
      startDegrees,
      endDegrees,
      rotationDegrees: assertFinite(geometry.rotationDegrees ?? 0, "shape.geometry.rotationDegrees"),
      clockwise: geometry.clockwise ?? true
    });
  }

  const exhaustive: never = geometry;
  return exhaustive;
}

export function normalizeProgrammableShape(shape: ProgrammableShape): ProgrammableShape {
  return Object.freeze({
    geometry: normalizeGeometry(shape.geometry),
    ...(shape.style !== undefined ? { style: normalizeStyle(shape.style) } : {})
  });
}

function formatNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.isInteger(normalized) ? String(normalized) : String(Number(normalized.toFixed(6)));
}

function pointText(point: ProgrammableShapePoint): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function ellipsePath(cx: number, cy: number, radiusX: number, radiusY: number): string {
  return [
    `M ${formatNumber(cx + radiusX)} ${formatNumber(cy)}`,
    `A ${formatNumber(radiusX)} ${formatNumber(radiusY)} 0 1 0 ${formatNumber(cx - radiusX)} ${formatNumber(cy)}`,
    `A ${formatNumber(radiusX)} ${formatNumber(radiusY)} 0 1 0 ${formatNumber(cx + radiusX)} ${formatNumber(cy)}`,
    "Z"
  ].join(" ");
}

function rectanglePath(geometry: ProgrammableRectangleShape): string {
  const x = geometry.x ?? 0;
  const y = geometry.y ?? 0;
  const right = x + geometry.width;
  const bottom = y + geometry.height;
  const radiusX = geometry.radiusX ?? 0;
  const radiusY = geometry.radiusY ?? radiusX;
  if (radiusX === 0 || radiusY === 0) {
    return `M ${formatNumber(x)} ${formatNumber(y)} H ${formatNumber(right)} V ${formatNumber(bottom)} H ${formatNumber(x)} Z`;
  }
  return [
    `M ${formatNumber(x + radiusX)} ${formatNumber(y)}`,
    `H ${formatNumber(right - radiusX)}`,
    `A ${formatNumber(radiusX)} ${formatNumber(radiusY)} 0 0 1 ${formatNumber(right)} ${formatNumber(y + radiusY)}`,
    `V ${formatNumber(bottom - radiusY)}`,
    `A ${formatNumber(radiusX)} ${formatNumber(radiusY)} 0 0 1 ${formatNumber(right - radiusX)} ${formatNumber(bottom)}`,
    `H ${formatNumber(x + radiusX)}`,
    `A ${formatNumber(radiusX)} ${formatNumber(radiusY)} 0 0 1 ${formatNumber(x)} ${formatNumber(bottom - radiusY)}`,
    `V ${formatNumber(y + radiusY)}`,
    `A ${formatNumber(radiusX)} ${formatNumber(radiusY)} 0 0 1 ${formatNumber(x + radiusX)} ${formatNumber(y)}`,
    "Z"
  ].join(" ");
}

function starPoints(geometry: ProgrammableStarShape): readonly ProgrammableShapePoint[] {
  const points: ProgrammableShapePoint[] = [];
  const rotation = geometry.rotationDegrees ?? -90;
  for (let index = 0; index < geometry.points * 2; index += 1) {
    const radius = index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
    const angle = (rotation + index * 180 / geometry.points) * Math.PI / 180;
    points.push(Object.freeze({
      x: geometry.cx + Math.cos(angle) * radius,
      y: geometry.cy + Math.sin(angle) * radius
    }));
  }
  return Object.freeze(points);
}

function normalizedArcSweep(startDegrees: number, endDegrees: number, clockwise: boolean): number {
  const raw = endDegrees - startDegrees;
  if (clockwise) {
    let sweep = ((raw % 360) + 360) % 360;
    if (sweep === 0 && raw !== 0) sweep = 360;
    return sweep;
  }
  let sweep = -((((-raw) % 360) + 360) % 360);
  if (sweep === 0 && raw !== 0) sweep = -360;
  return sweep;
}

function arcPoint(
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  rotationDegrees: number,
  angleDegrees: number
): ProgrammableShapePoint {
  const theta = angleDegrees * Math.PI / 180;
  const rotation = rotationDegrees * Math.PI / 180;
  const localX = Math.cos(theta) * radiusX;
  const localY = Math.sin(theta) * radiusY;
  return Object.freeze({
    x: cx + localX * Math.cos(rotation) - localY * Math.sin(rotation),
    y: cy + localX * Math.sin(rotation) + localY * Math.cos(rotation)
  });
}

function arcPath(geometry: ProgrammableArcShape): string {
  const rotation = geometry.rotationDegrees ?? 0;
  const clockwise = geometry.clockwise ?? true;
  const sweep = normalizedArcSweep(geometry.startDegrees, geometry.endDegrees, clockwise);
  const start = arcPoint(
    geometry.cx,
    geometry.cy,
    geometry.radiusX,
    geometry.radiusY,
    rotation,
    geometry.startDegrees
  );
  const sweepFlag = clockwise ? 1 : 0;

  if (Math.abs(sweep) === 360) {
    const midAngle = geometry.startDegrees + sweep / 2;
    const mid = arcPoint(
      geometry.cx,
      geometry.cy,
      geometry.radiusX,
      geometry.radiusY,
      rotation,
      midAngle
    );
    return [
      `M ${pointText(start)}`,
      `A ${formatNumber(geometry.radiusX)} ${formatNumber(geometry.radiusY)} ${formatNumber(rotation)} 0 ${sweepFlag} ${pointText(mid)}`,
      `A ${formatNumber(geometry.radiusX)} ${formatNumber(geometry.radiusY)} ${formatNumber(rotation)} 0 ${sweepFlag} ${pointText(start)}`
    ].join(" ");
  }

  const end = arcPoint(
    geometry.cx,
    geometry.cy,
    geometry.radiusX,
    geometry.radiusY,
    rotation,
    geometry.startDegrees + sweep
  );
  const largeArcFlag = Math.abs(sweep) > 180 ? 1 : 0;
  return [
    `M ${pointText(start)}`,
    `A ${formatNumber(geometry.radiusX)} ${formatNumber(geometry.radiusY)} ${formatNumber(rotation)} ${largeArcFlag} ${sweepFlag} ${pointText(end)}`
  ].join(" ");
}

export function programmableShapeToSvgPath(shape: ProgrammableShape): string {
  const normalized = normalizeProgrammableShape(shape);
  const geometry = normalized.geometry;

  if (geometry.kind === "rectangle") return rectanglePath(geometry);
  if (geometry.kind === "ellipse") {
    return ellipsePath(geometry.cx, geometry.cy, geometry.radiusX, geometry.radiusY);
  }
  if (geometry.kind === "line") {
    return `M ${pointText(geometry.from)} L ${pointText(geometry.to)}`;
  }
  if (geometry.kind === "polygon") {
    return `M ${geometry.points.map(pointText).join(" L ")} Z`;
  }
  if (geometry.kind === "star") {
    const points = starPoints(geometry);
    return `M ${points.map(pointText).join(" L ")} Z`;
  }
  if (geometry.kind === "path") return geometry.d;
  if (geometry.kind === "arc") return arcPath(geometry);

  const exhaustive: never = geometry;
  return exhaustive;
}

export function serializeProgrammableShape(shape: ProgrammableShape): string {
  return JSON.stringify(normalizeProgrammableShape(shape));
}

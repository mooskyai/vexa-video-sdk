import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  createElement,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore
} from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  createFrameContext,
  defineProgrammableScene,
  freezeFrameContext,
  getProgrammableCompositionStaticMetadata,
  loopFrameContext,
  offsetFrameContext,
  resolveProgrammableComposition,
  resolveSeries
} from "@vexa-video/core/browser";
import type {
  FrameContext,
  JsonObject,
  ProgrammableArcShape,
  ProgrammableCompositionDefinition,
  ProgrammableCompositionStaticMetadata,
  ProgrammableEllipseShape,
  ProgrammableLineShape,
  ProgrammablePathShape,
  ProgrammablePolygonShape,
  ProgrammableRectangleShape,
  ProgrammableScene,
  ProgrammableSceneAsset,
  ProgrammableSceneAssetKind,
  ProgrammableSceneAssetPolicy,
  ProgrammableSceneAudioNode,
  ProgrammableSceneCrop,
  ProgrammableSceneFillNode,
  ProgrammableSceneGroupNode,
  ProgrammableSceneImageNode,
  ProgrammableSceneLayerNode,
  ProgrammableSceneNode,
  ProgrammableSceneNodeBase,
  ProgrammableScenePreloadMode,
  ProgrammableSceneShapeNode,
  ProgrammableSceneSolidNode,
  ProgrammableSceneSurfaceDescriptor,
  ProgrammableSceneSurfaceNode,
  ProgrammableSceneTextNode,
  ProgrammableSceneTextStyle,
  ProgrammableSceneTransform,
  ProgrammableSceneVideoNode,
  ProgrammableShape,
  ProgrammableShapeGeometry,
  ProgrammableShapeStyle,
  ProgrammableStarShape,
  ProgrammableStorageAssetSource,
  ResolvedProgrammableComposition,
  ResolvedProgrammableCompositionMetadata,
  ResizeFit,
  SeriesSectionInput
} from "@vexa-video/core/browser";

export type VexaReactErrorCode =
  | "INVALID_REACT_RUNTIME"
  | "REACT_CONTEXT_MISSING"
  | "REACT_COMPOSITION_CONFLICT"
  | "REACT_COMPOSITION_NOT_FOUND"
  | "INVALID_REACT_SERIES";

export class VexaReactError extends Error {
  readonly code: VexaReactErrorCode;

  constructor(message: string, code: VexaReactErrorCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidVexaReactRuntimeError extends VexaReactError {
  constructor(message: string) {
    super(message, "INVALID_REACT_RUNTIME");
  }
}

export class VexaReactContextError extends VexaReactError {
  constructor(hookOrComponent: string) {
    super(
      `${hookOrComponent} must be used inside the matching Vexa React provider/runtime.`,
      "REACT_CONTEXT_MISSING"
    );
  }
}

export class VexaReactCompositionConflictError extends VexaReactError {
  readonly compositionId: string;

  constructor(compositionId: string) {
    super(
      `A React composition with id "${compositionId}" is already registered.`,
      "REACT_COMPOSITION_CONFLICT"
    );
    this.compositionId = compositionId;
  }
}

export class VexaReactCompositionNotFoundError extends VexaReactError {
  readonly compositionId: string;

  constructor(compositionId: string) {
    super(`React composition was not found: ${compositionId}.`, "REACT_COMPOSITION_NOT_FOUND");
    this.compositionId = compositionId;
  }
}

export class InvalidVexaReactSeriesError extends VexaReactError {
  constructor(message: string) {
    super(message, "INVALID_REACT_SERIES");
  }
}

export type VexaReactCompositionComponent<Props extends JsonObject = JsonObject> = ComponentType<
  Readonly<Props>
>;

export interface VexaReactCompositionEntry<Props extends JsonObject = JsonObject> {
  readonly definition: ProgrammableCompositionDefinition<Props>;
  readonly component: VexaReactCompositionComponent<Props>;
}

type AnyVexaReactCompositionEntry = VexaReactCompositionEntry<any>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class VexaReactCompositionRegistry {
  readonly #entries = new Map<string, AnyVexaReactCompositionEntry>();

  register<Props extends JsonObject>(entry: VexaReactCompositionEntry<Props>): () => void {
    const id = entry.definition.id;
    if (this.#entries.has(id)) throw new VexaReactCompositionConflictError(id);
    const stored = Object.freeze({ ...entry }) as AnyVexaReactCompositionEntry;
    this.#entries.set(id, stored);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#entries.get(id) === stored) this.#entries.delete(id);
    };
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  get<Props extends JsonObject = JsonObject>(id: string): VexaReactCompositionEntry<Props> | undefined {
    return this.#entries.get(id) as VexaReactCompositionEntry<Props> | undefined;
  }

  require<Props extends JsonObject = JsonObject>(id: string): VexaReactCompositionEntry<Props> {
    const entry = this.get<Props>(id);
    if (!entry) throw new VexaReactCompositionNotFoundError(id);
    return entry;
  }

  list(): readonly VexaReactCompositionEntry[] {
    return [...this.#entries.values()].sort((left, right) =>
      compareText(left.definition.id, right.definition.id)
    );
  }

  listMetadata(): readonly ProgrammableCompositionStaticMetadata[] {
    return this.list().map((entry) => getProgrammableCompositionStaticMetadata(entry.definition));
  }

  async resolve<Props extends JsonObject = JsonObject>(
    id: string,
    inputProps?: Partial<Props>
  ): Promise<{
    readonly entry: VexaReactCompositionEntry<Props>;
    readonly resolved: ResolvedProgrammableComposition<Props>;
  }> {
    const entry = this.require<Props>(id);
    const resolved = await resolveProgrammableComposition(entry.definition, inputProps);
    return Object.freeze({ entry, resolved });
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

const RegistryContext = createContext<VexaReactCompositionRegistry | null>(null);

export interface VexaReactRegistryProviderProps {
  readonly registry: VexaReactCompositionRegistry;
  readonly children?: ReactNode;
}

export function VexaReactRegistryProvider(props: VexaReactRegistryProviderProps): ReactElement {
  return createElement(RegistryContext.Provider, { value: props.registry }, props.children);
}

export interface VexaCompositionRegistrationProps<Props extends JsonObject = JsonObject> {
  readonly definition: ProgrammableCompositionDefinition<Props>;
  readonly component: VexaReactCompositionComponent<Props>;
}

export function VexaCompositionRegistration<Props extends JsonObject = JsonObject>(
  props: VexaCompositionRegistrationProps<Props>
): null {
  const registry = useContext(RegistryContext);
  if (!registry) throw new VexaReactContextError("VexaCompositionRegistration");

  useLayoutEffect(
    () => registry.register({ definition: props.definition, component: props.component }),
    [registry, props.definition, props.component]
  );
  return null;
}

export interface VexaRenderDelayToken {
  readonly id: symbol;
  readonly label: string;
}

export class VexaRenderReadyController {
  readonly #pending = new Map<symbol, string>();
  readonly #listeners = new Set<() => void>();

  delay(label = "async-render-work"): VexaRenderDelayToken {
    const normalized = label.trim();
    if (!normalized) throw new InvalidVexaReactRuntimeError("Render-delay labels cannot be empty.");
    const token = Object.freeze({ id: Symbol(normalized), label: normalized });
    this.#pending.set(token.id, normalized);
    this.#emit();
    return token;
  }

  resume(token: VexaRenderDelayToken): boolean {
    const removed = this.#pending.delete(token.id);
    if (removed) this.#emit();
    return removed;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.#pending.size === 0;
  getServerSnapshot = (): boolean => this.#pending.size === 0;

  get isReady(): boolean {
    return this.#pending.size === 0;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  get pendingLabels(): readonly string[] {
    return Object.freeze([...this.#pending.values()].sort(compareText));
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

interface VexaRuntimeContextValue<Props extends JsonObject = JsonObject> {
  readonly frame: Readonly<FrameContext>;
  readonly resolved: ResolvedProgrammableComposition<Props>;
  readonly readiness: VexaRenderReadyController;
}

type AnyRuntimeContextValue = VexaRuntimeContextValue<any>;

interface SceneRecord {
  readonly key: string;
  readonly parentKey: string | null;
  readonly declarationOrder: number;
  readonly node: ProgrammableSceneNode;
}

interface SceneCollector {
  readonly records: Map<string, SceneRecord>;
  nextDeclarationOrder: number;
}

const RuntimeContext = createContext<AnyRuntimeContextValue | null>(null);
const SceneCollectorContext = createContext<SceneCollector | null>(null);
const ParentSceneNodeContext = createContext<string | null>(null);

function requireRuntime(label: string): AnyRuntimeContextValue {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new VexaReactContextError(label);
  return runtime;
}

function requireCollector(label: string): SceneCollector {
  const collector = useContext(SceneCollectorContext);
  if (!collector) throw new VexaReactContextError(label);
  return collector;
}

function assertFrame(frame: number, metadata: ResolvedProgrammableCompositionMetadata): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new InvalidVexaReactRuntimeError("frame must be a non-negative safe integer.");
  }
  const duration = metadata.kind === "video" ? metadata.durationInFrames : 1;
  if (frame >= duration) {
    throw new InvalidVexaReactRuntimeError(
      `frame ${frame} is outside composition "${metadata.id}" (duration ${duration} frame${duration === 1 ? "" : "s"}).`
    );
  }
}

function materializeSceneChildren(collector: SceneCollector): readonly ProgrammableSceneNode[] {
  const byParent = new Map<string | null, SceneRecord[]>();
  for (const record of collector.records.values()) {
    const entries = byParent.get(record.parentKey) ?? [];
    entries.push(record);
    byParent.set(record.parentKey, entries);
  }
  for (const entries of byParent.values()) {
    entries.sort((left, right) => left.declarationOrder - right.declarationOrder);
  }

  const visit = (parentKey: string | null): ProgrammableSceneNode[] =>
    (byParent.get(parentKey) ?? []).map((record) => {
      const node = record.node;
      if (node.kind === "group" || node.kind === "layer") {
        return Object.freeze({ ...node, children: Object.freeze(visit(record.key)) });
      }
      return node;
    });

  return Object.freeze(visit(null));
}

export interface VexaCompositionRootProps<Props extends JsonObject = JsonObject> {
  readonly resolved: ResolvedProgrammableComposition<Props>;
  readonly frame?: number;
  readonly background?: string;
  readonly assets?: readonly ProgrammableSceneAsset[];
  readonly assetPolicy?: ProgrammableSceneAssetPolicy;
  readonly readinessController?: VexaRenderReadyController;
  readonly onScene?: (scene: ProgrammableScene) => void;
  readonly children?: ReactNode;
}

export function VexaCompositionRoot<Props extends JsonObject = JsonObject>(
  props: VexaCompositionRootProps<Props>
): ReactElement {
  const frame = props.frame ?? 0;
  assertFrame(frame, props.resolved.metadata);
  const fps = props.resolved.metadata.kind === "video" ? props.resolved.metadata.fps : 1;
  const durationInFrames =
    props.resolved.metadata.kind === "video" ? props.resolved.metadata.durationInFrames : 1;

  const fallbackReadinessRef = useRef<VexaRenderReadyController | null>(null);
  fallbackReadinessRef.current ??= new VexaRenderReadyController();
  const readiness = props.readinessController ?? fallbackReadinessRef.current;
  const collector: SceneCollector = { records: new Map(), nextDeclarationOrder: 0 };
  const runtime = Object.freeze({
    frame: createFrameContext(frame, fps),
    resolved: props.resolved,
    readiness
  }) as VexaRuntimeContextValue<Props>;

  useLayoutEffect(() => {
    if (!props.onScene) return;
    props.onScene(
      defineProgrammableScene({
        id: props.resolved.metadata.id,
        width: props.resolved.metadata.width,
        height: props.resolved.metadata.height,
        fps,
        durationInFrames,
        ...(props.background !== undefined ? { background: props.background } : {}),
        ...(props.assets !== undefined ? { assets: props.assets } : {}),
        ...(props.assetPolicy !== undefined ? { assetPolicy: props.assetPolicy } : {}),
        children: materializeSceneChildren(collector)
      })
    );
  });

  return createElement(
    RuntimeContext.Provider,
    { value: runtime as AnyRuntimeContextValue },
    createElement(
      SceneCollectorContext.Provider,
      { value: collector },
      createElement(ParentSceneNodeContext.Provider, { value: null }, props.children)
    )
  );
}

export function useVexaFrame(): number {
  return requireRuntime("useVexaFrame").frame.frame;
}

export function useVexaAbsoluteFrame(): number {
  return requireRuntime("useVexaAbsoluteFrame").frame.absoluteFrame;
}

export function useVexaCompositionConfig(): ResolvedProgrammableCompositionMetadata {
  return requireRuntime("useVexaCompositionConfig").resolved.metadata;
}

export function useVexaInputProps<Props extends JsonObject = JsonObject>(): Readonly<Props> {
  return requireRuntime("useVexaInputProps").resolved.props as Readonly<Props>;
}

export function useVexaRenderReady(): boolean {
  const controller = requireRuntime("useVexaRenderReady").readiness;
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
}

export function useVexaRenderDelay(label = "async-render-work"): () => void {
  const controller = requireRuntime("useVexaRenderDelay").readiness;
  const tokenRef = useRef<VexaRenderDelayToken | null>(null);
  const resumedBeforeMountRef = useRef(false);
  const completedRef = useRef(false);

  useLayoutEffect(() => {
    completedRef.current = false;
    const token = controller.delay(label);
    tokenRef.current = token;
    if (resumedBeforeMountRef.current) {
      controller.resume(token);
      tokenRef.current = null;
      resumedBeforeMountRef.current = false;
      completedRef.current = true;
    }
    return () => {
      if (tokenRef.current) controller.resume(tokenRef.current);
      tokenRef.current = null;
    };
  }, [controller, label]);

  return useCallback(() => {
    if (completedRef.current) return;
    if (tokenRef.current) {
      controller.resume(tokenRef.current);
      tokenRef.current = null;
      completedRef.current = true;
    } else {
      resumedBeforeMountRef.current = true;
    }
  }, [controller]);
}

function useRegisterSceneNode(
  label: string,
  node: ProgrammableSceneNode,
  parentKeyOverride?: string | null
): string {
  const collector = requireCollector(label);
  const parentKeyFromContext = useContext(ParentSceneNodeContext);
  const key = useId();
  const existing = collector.records.get(key);
  collector.records.set(
    key,
    Object.freeze({
      key,
      parentKey: parentKeyOverride === undefined ? parentKeyFromContext : parentKeyOverride,
      declarationOrder: existing?.declarationOrder ?? collector.nextDeclarationOrder++,
      node
    })
  );
  return key;
}

function withFrame(runtime: AnyRuntimeContextValue, frame: Readonly<FrameContext>): AnyRuntimeContextValue {
  return Object.freeze({ ...runtime, frame });
}

function containerElement(
  label: string,
  node: ProgrammableSceneGroupNode | ProgrammableSceneLayerNode,
  frameOffset: number,
  children: ReactNode
): ReactElement {
  const runtime = requireRuntime(label);
  const key = useRegisterSceneNode(label, node);
  const childRuntime = withFrame(runtime, offsetFrameContext(runtime.frame, frameOffset));
  return createElement(
    RuntimeContext.Provider,
    { value: childRuntime },
    createElement(ParentSceneNodeContext.Provider, { value: key }, children)
  );
}

export interface VexaContainerProps extends Omit<ProgrammableSceneNodeBase, "id"> {
  readonly id: string;
  readonly children?: ReactNode;
}

export function VexaGroup(props: VexaContainerProps): ReactElement {
  const startFrame = props.startFrame ?? 0;
  return containerElement(
    "VexaGroup",
    Object.freeze({
      kind: "group",
      id: props.id,
      ...(props.startFrame !== undefined ? { startFrame: props.startFrame } : {}),
      ...(props.durationInFrames !== undefined ? { durationInFrames: props.durationInFrames } : {}),
      ...(props.zIndex !== undefined ? { zIndex: props.zIndex } : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
      ...(props.transform !== undefined ? { transform: props.transform } : {}),
      children: Object.freeze([])
    }),
    startFrame,
    props.children
  );
}

export function VexaLayer(props: VexaContainerProps): ReactElement {
  const startFrame = props.startFrame ?? 0;
  return containerElement(
    "VexaLayer",
    Object.freeze({
      kind: "layer",
      id: props.id,
      ...(props.startFrame !== undefined ? { startFrame: props.startFrame } : {}),
      ...(props.durationInFrames !== undefined ? { durationInFrames: props.durationInFrames } : {}),
      ...(props.zIndex !== undefined ? { zIndex: props.zIndex } : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
      ...(props.transform !== undefined ? { transform: props.transform } : {}),
      children: Object.freeze([])
    }),
    startFrame,
    props.children
  );
}

export interface VexaSequenceProps extends Omit<VexaContainerProps, "startFrame"> {
  readonly from: number;
}

export function VexaSequence(props: VexaSequenceProps): ReactElement {
  return createElement(
    VexaGroup,
    {
      id: props.id,
      startFrame: props.from,
      ...(props.durationInFrames !== undefined ? { durationInFrames: props.durationInFrames } : {}),
      ...(props.zIndex !== undefined ? { zIndex: props.zIndex } : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
      ...(props.transform !== undefined ? { transform: props.transform } : {})
    },
    props.children
  );
}

export interface VexaLoopProps {
  readonly durationInFrames: number;
  readonly children?: ReactNode;
}

export function VexaLoop(props: VexaLoopProps): ReactElement {
  const runtime = requireRuntime("VexaLoop");
  return createElement(
    RuntimeContext.Provider,
    { value: withFrame(runtime, loopFrameContext(runtime.frame, props.durationInFrames)) },
    props.children
  );
}

export interface VexaFreezeProps {
  readonly frame: number;
  readonly children?: ReactNode;
}

export function VexaFreeze(props: VexaFreezeProps): ReactElement {
  const runtime = requireRuntime("VexaFreeze");
  return createElement(
    RuntimeContext.Provider,
    { value: withFrame(runtime, freezeFrameContext(runtime.frame, props.frame)) },
    props.children
  );
}

interface InternalSeriesItemProps extends VexaContainerProps {
  readonly durationInFrames: number;
  readonly offsetFrames?: number;
  readonly __resolvedStartFrame?: number;
}

export type VexaSeriesItemProps = Omit<InternalSeriesItemProps, "__resolvedStartFrame">;

export function VexaSeriesItem(props: VexaSeriesItemProps): ReactElement;
export function VexaSeriesItem(props: InternalSeriesItemProps): ReactElement {
  if (props.__resolvedStartFrame === undefined) {
    throw new InvalidVexaReactSeriesError("VexaSeriesItem must be a direct child of VexaSeries.");
  }
  return createElement(
    VexaSequence,
    {
      id: props.id,
      from: props.__resolvedStartFrame,
      durationInFrames: props.durationInFrames,
      ...(props.zIndex !== undefined ? { zIndex: props.zIndex } : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
      ...(props.transform !== undefined ? { transform: props.transform } : {})
    },
    props.children
  );
}

export interface VexaSeriesProps {
  readonly children?: ReactNode;
}

export function VexaSeries(props: VexaSeriesProps): ReactElement {
  const children = Children.toArray(props.children);
  const elements: ReactElement<InternalSeriesItemProps>[] = children.map((child, index) => {
    if (!isValidElement<InternalSeriesItemProps>(child) || child.type !== VexaSeriesItem) {
      throw new InvalidVexaReactSeriesError(
        `VexaSeries child ${index} must be a VexaSeriesItem.`
      );
    }
    return child;
  });
  const sections: SeriesSectionInput[] = elements.map((element) => ({
    id: element.props.id,
    durationInFrames: element.props.durationInFrames,
    ...(element.props.offsetFrames !== undefined ? { offsetFrames: element.props.offsetFrames } : {})
  }));
  const resolved = resolveSeries(sections);
  return createElement(
    Fragment,
    null,
    ...elements.map((element, index) =>
      cloneElement(element, { __resolvedStartFrame: resolved[index]!.startFrame })
    )
  );
}

function leaf(label: string, node: ProgrammableSceneNode): null {
  useRegisterSceneNode(label, node);
  return null;
}

export interface VexaLeafBaseProps extends Omit<ProgrammableSceneNodeBase, "id"> {
  readonly id: string;
}

function nodeBase(props: VexaLeafBaseProps): Omit<ProgrammableSceneNodeBase, "id"> {
  return {
    ...(props.startFrame !== undefined ? { startFrame: props.startFrame } : {}),
    ...(props.durationInFrames !== undefined ? { durationInFrames: props.durationInFrames } : {}),
    ...(props.zIndex !== undefined ? { zIndex: props.zIndex } : {}),
    ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
    ...(props.transform !== undefined ? { transform: props.transform } : {})
  };
}

export interface VexaFillProps extends VexaLeafBaseProps {
  readonly color: string;
}

export function VexaFill(props: VexaFillProps): null {
  const node: ProgrammableSceneFillNode = Object.freeze({
    kind: "fill",
    id: props.id,
    ...nodeBase(props),
    color: props.color
  });
  return leaf("VexaFill", node);
}

export interface VexaSolidProps extends VexaLeafBaseProps {
  readonly color: string;
  readonly width: number;
  readonly height: number;
}

export function VexaSolid(props: VexaSolidProps): null {
  const node: ProgrammableSceneSolidNode = Object.freeze({
    kind: "solid",
    id: props.id,
    ...nodeBase(props),
    color: props.color,
    width: props.width,
    height: props.height
  });
  return leaf("VexaSolid", node);
}

export interface VexaShapeProps extends VexaLeafBaseProps {
  readonly shape: ProgrammableShape;
}

function shapeValue(
  geometry: ProgrammableShapeGeometry,
  style: ProgrammableShapeStyle | undefined
): ProgrammableShape {
  return Object.freeze({
    geometry,
    ...(style !== undefined ? { style } : {})
  });
}

function shapeLeaf(label: string, props: VexaLeafBaseProps, shape: ProgrammableShape): null {
  const node: ProgrammableSceneShapeNode = Object.freeze({
    kind: "shape",
    id: props.id,
    ...nodeBase(props),
    shape
  });
  return leaf(label, node);
}

export function VexaShape(props: VexaShapeProps): null {
  return shapeLeaf("VexaShape", props, props.shape);
}

export interface VexaShapePrimitiveBaseProps extends VexaLeafBaseProps {
  readonly style?: ProgrammableShapeStyle;
}

export type VexaRectangleProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammableRectangleShape, "kind">;

export function VexaRectangle(props: VexaRectangleProps): null {
  return shapeLeaf("VexaRectangle", props, shapeValue({
    kind: "rectangle",
    ...(props.x !== undefined ? { x: props.x } : {}),
    ...(props.y !== undefined ? { y: props.y } : {}),
    width: props.width,
    height: props.height,
    ...(props.radiusX !== undefined ? { radiusX: props.radiusX } : {}),
    ...(props.radiusY !== undefined ? { radiusY: props.radiusY } : {})
  }, props.style));
}

export type VexaEllipseProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammableEllipseShape, "kind">;

export function VexaEllipse(props: VexaEllipseProps): null {
  return shapeLeaf("VexaEllipse", props, shapeValue({
    kind: "ellipse",
    cx: props.cx,
    cy: props.cy,
    radiusX: props.radiusX,
    radiusY: props.radiusY
  }, props.style));
}

export interface VexaCircleProps extends VexaShapePrimitiveBaseProps {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export function VexaCircle(props: VexaCircleProps): null {
  return shapeLeaf("VexaCircle", props, shapeValue({
    kind: "ellipse",
    cx: props.cx,
    cy: props.cy,
    radiusX: props.radius,
    radiusY: props.radius
  }, props.style));
}

export type VexaLineProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammableLineShape, "kind">;

export function VexaLine(props: VexaLineProps): null {
  return shapeLeaf("VexaLine", props, shapeValue({
    kind: "line",
    from: props.from,
    to: props.to
  }, props.style));
}

export type VexaPolygonProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammablePolygonShape, "kind">;

export function VexaPolygon(props: VexaPolygonProps): null {
  return shapeLeaf("VexaPolygon", props, shapeValue({
    kind: "polygon",
    points: props.points
  }, props.style));
}

export type VexaStarProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammableStarShape, "kind">;

export function VexaStar(props: VexaStarProps): null {
  return shapeLeaf("VexaStar", props, shapeValue({
    kind: "star",
    cx: props.cx,
    cy: props.cy,
    points: props.points,
    innerRadius: props.innerRadius,
    outerRadius: props.outerRadius,
    ...(props.rotationDegrees !== undefined ? { rotationDegrees: props.rotationDegrees } : {})
  }, props.style));
}

export type VexaPathProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammablePathShape, "kind">;

export function VexaPath(props: VexaPathProps): null {
  return shapeLeaf("VexaPath", props, shapeValue({
    kind: "path",
    d: props.d
  }, props.style));
}

export type VexaArcProps = VexaShapePrimitiveBaseProps &
  Omit<ProgrammableArcShape, "kind">;

export function VexaArc(props: VexaArcProps): null {
  return shapeLeaf("VexaArc", props, shapeValue({
    kind: "arc",
    cx: props.cx,
    cy: props.cy,
    radiusX: props.radiusX,
    radiusY: props.radiusY,
    startDegrees: props.startDegrees,
    endDegrees: props.endDegrees,
    ...(props.rotationDegrees !== undefined ? { rotationDegrees: props.rotationDegrees } : {}),
    ...(props.clockwise !== undefined ? { clockwise: props.clockwise } : {})
  }, props.style));
}

export interface VexaTextProps extends VexaLeafBaseProps {
  readonly text: string;
  readonly style?: ProgrammableSceneTextStyle;
}

export function VexaText(props: VexaTextProps): null {
  const node: ProgrammableSceneTextNode = Object.freeze({
    kind: "text",
    id: props.id,
    ...nodeBase(props),
    text: props.text,
    ...(props.style !== undefined ? { style: props.style } : {})
  });
  return leaf("VexaText", node);
}

export interface VexaImageProps extends VexaLeafBaseProps {
  readonly assetId: string;
  readonly fit?: ResizeFit;
  readonly crop?: ProgrammableSceneCrop;
}

export function VexaImage(props: VexaImageProps): null {
  const node: ProgrammableSceneImageNode = Object.freeze({
    kind: "image",
    id: props.id,
    ...nodeBase(props),
    assetId: props.assetId,
    ...(props.fit !== undefined ? { fit: props.fit } : {}),
    ...(props.crop !== undefined ? { crop: props.crop } : {})
  });
  return leaf("VexaImage", node);
}

interface VexaPlayableMediaProps extends VexaLeafBaseProps {
  readonly assetId: string;
  readonly sourceStartSeconds?: number;
  readonly playbackRate?: number;
  readonly volume?: number;
  readonly muted?: boolean;
}

export interface VexaVideoProps extends VexaPlayableMediaProps {
  readonly fit?: ResizeFit;
  readonly crop?: ProgrammableSceneCrop;
}

export function VexaVideo(props: VexaVideoProps): null {
  const node: ProgrammableSceneVideoNode = Object.freeze({
    kind: "video",
    id: props.id,
    ...nodeBase(props),
    assetId: props.assetId,
    ...(props.fit !== undefined ? { fit: props.fit } : {}),
    ...(props.crop !== undefined ? { crop: props.crop } : {}),
    ...(props.sourceStartSeconds !== undefined ? { sourceStartSeconds: props.sourceStartSeconds } : {}),
    ...(props.playbackRate !== undefined ? { playbackRate: props.playbackRate } : {}),
    ...(props.volume !== undefined ? { volume: props.volume } : {}),
    ...(props.muted !== undefined ? { muted: props.muted } : {})
  });
  return leaf("VexaVideo", node);
}

export type VexaAudioProps = VexaPlayableMediaProps;

export function VexaAudio(props: VexaAudioProps): null {
  const node: ProgrammableSceneAudioNode = Object.freeze({
    kind: "audio",
    id: props.id,
    ...nodeBase(props),
    assetId: props.assetId,
    ...(props.sourceStartSeconds !== undefined ? { sourceStartSeconds: props.sourceStartSeconds } : {}),
    ...(props.playbackRate !== undefined ? { playbackRate: props.playbackRate } : {}),
    ...(props.volume !== undefined ? { volume: props.volume } : {}),
    ...(props.muted !== undefined ? { muted: props.muted } : {})
  });
  return leaf("VexaAudio", node);
}

export interface VexaSurfaceProps extends VexaLeafBaseProps {
  readonly surface: ProgrammableSceneSurfaceDescriptor;
}

export function VexaSurface(props: VexaSurfaceProps): null {
  const node: ProgrammableSceneSurfaceNode = Object.freeze({
    kind: "surface",
    id: props.id,
    ...nodeBase(props),
    surface: props.surface
  });
  return leaf("VexaSurface", node);
}

export function vexaStaticAsset(
  id: string,
  kind: ProgrammableSceneAssetKind,
  src: string,
  preload?: ProgrammableScenePreloadMode
): ProgrammableSceneAsset {
  return Object.freeze({
    id,
    kind,
    source: Object.freeze({ kind: "static", src }),
    ...(preload !== undefined ? { preload } : {})
  });
}

export function vexaStorageAsset(
  id: string,
  kind: ProgrammableSceneAssetKind,
  source: ProgrammableStorageAssetSource["source"],
  preload?: ProgrammableScenePreloadMode
): ProgrammableSceneAsset {
  return Object.freeze({
    id,
    kind,
    source: Object.freeze({ kind: "storage", source }),
    ...(preload !== undefined ? { preload } : {})
  });
}

export type {
  JsonObject,
  ProgrammableCompositionDefinition,
  ProgrammableScene,
  ProgrammableSceneAsset,
  ProgrammableSceneAssetPolicy,
  ProgrammableSceneCrop,
  ProgrammableSceneSurfaceDescriptor,
  ProgrammableSceneTextStyle,
  ProgrammableSceneTransform,
  ProgrammableShape,
  ProgrammableShapeGeometry,
  ProgrammableShapeStyle,
  ResolvedProgrammableComposition,
  ResolvedProgrammableCompositionMetadata
};

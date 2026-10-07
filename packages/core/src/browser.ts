/**
 * Browser-safe shared surface for framework integrations and deterministic timing.
 *
 * Keep this entry point free of Node runtime imports. It exports serializable
 * media-domain types plus pure deterministic helpers that are safe to evaluate in browsers.
 */
export type {
  CaptionAnimation,
  CaptionCue,
  CaptionDocument,
  CaptionFormat,
  CaptionPosition,
  CaptionStyle,
  CaptionTemplateName,
  CaptionWordTiming
} from "./captions.js";
export type {
  BlendMode,
  ClipKind,
  ClipTransform,
  ClipTransitions,
  ImageTimelineClip,
  KeyframeEasing,
  NumericKeyframe,
  NumericProperty,
  ProjectCanvas,
  ProjectTrack,
  ProjectTrackType,
  TextStyle,
  TextTimelineClip,
  TimelineClip,
  TimelineClipBase,
  TransitionType,
  VideoProjectAst,
  VideoTimelineClip,
  AudioTimelineClip
} from "./composition.js";
export type {
  AudioCodec,
  CropOptions,
  MediaProgress,
  ResizeFit,
  ResizeOptions,
  RotateOptions,
  TrimOptions,
  VideoCodec,
  VideoOperation
} from "./editing.js";
export type {
  JobDescriptor,
  JobEvent,
  JobEventType,
  JobFailure,
  JobMetadataValue,
  JobProgress,
  JobRetryOptions,
  JobRetryPolicy,
  JobSnapshot,
  JobState,
  JobSubmissionOptions,
  JobTerminalState
} from "./jobs.js";
export type {
  AudioStreamInfo,
  ProbeResult,
  VideoStreamInfo
} from "./media.js";
export type {
  CodecDecision,
  ExecutionMode,
  ExecutionTask,
  MediaExecutionPlan,
  OutputContainer,
  VideoPipelineAst
} from "./pipeline.js";

export type {
  PluginCapability,
  PluginLifecycleState,
  PluginDependency,
  PluginMetadata,
  PluginContributionCatalog,
  PluginCatalogEntry,
  PluginPackageManifest,
  PluginEncoderRequest,
  PluginEncoderSelection
} from "./plugins.js";

export type {
  HostedRenderState,
  HostedRenderRequest,
  HostedRenderProgress,
  HostedRenderArtifact,
  HostedRenderFailure,
  HostedRenderJob,
  HostedRenderCallOptions,
  HostedRenderWaitOptions,
  HostedRenderAdapter
} from "./hosted.js";

export {
  defineComposition,
  defineStill,
  getProgrammableCompositionStaticMetadata,
  InvalidProgrammableCompositionError,
  InvalidProgrammableCompositionPropsError,
  ProgrammableCompositionConflictError,
  ProgrammableCompositionMetadataError,
  ProgrammableCompositionNotFoundError,
  ProgrammableCompositionRegistry,
  resolveProgrammableComposition,
  serializeProgrammableCompositionMetadata
} from "./programmable-composition.js";
export type {
  DefineProgrammableCompositionOptions,
  DefineProgrammableStillOptions,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ProgrammableCompositionDefinition,
  ProgrammableCompositionDimensions,
  ProgrammableCompositionErrorCode,
  ProgrammableCompositionKind,
  ProgrammableCompositionMetadataCalculator,
  ProgrammableCompositionMetadataContext,
  ProgrammableCompositionPropsValidator,
  ProgrammableCompositionSchemaVersion,
  ProgrammableCompositionStaticMetadata,
  ResolvedProgrammableComposition,
  ResolvedProgrammableCompositionMetadata,
  StillProgrammableCompositionDefinition,
  StillProgrammableCompositionMetadata,
  StillProgrammableCompositionMetadataOverride,
  VideoProgrammableCompositionDefinition,
  VideoProgrammableCompositionMetadata,
  VideoProgrammableCompositionMetadataOverride,
  VideoProgrammableCompositionTiming
} from "./programmable-composition.js";

export {
  clampFrameToRange,
  createFrameContext,
  createFrameRange,
  easeInOutQuad,
  easeInQuad,
  easeOutQuad,
  frameRangeContains,
  frameRangeLocalFrame,
  frameToSeconds,
  freezeFrameContext,
  interpolate,
  interpolateColor,
  InvalidProgrammableTimingError,
  linearEasing,
  loopFrame,
  loopFrameContext,
  offsetFrameContext,
  resolveSeries,
  secondsToFrame,
  seededRandom,
  seriesSectionAtFrame,
  spring
} from "./programmable-timing.js";
export type {
  DeterministicRandomSeed,
  FrameContext,
  FrameRange,
  FrameRoundingMode,
  InterpolateColorOptions,
  InterpolateOptions,
  ResolvedSeriesSection,
  SeriesSectionInput,
  SpringOptions,
  TimingEasingFunction,
  TimingExtrapolationMode
} from "./programmable-timing.js";

export * from "./programmable-scene.js";

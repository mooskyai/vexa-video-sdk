/**
 * Browser-safe type surface shared by framework integrations.
 *
 * Keep this entry point free of Node runtime imports. It intentionally exports
 * only serializable/media-domain types needed across a browser-to-service boundary.
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

import type {
  CaptionDocument,
  CaptionFormat,
  CaptionStyle,
  CaptionTemplateName,
  ProjectRenderOptions,
  VideoLoadOptions,
  VideoProjectAst
} from "@moosky-video/core";

export interface AiControlOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  id?: string;
  start: number;
  end: number;
  text: string;
  words?: readonly TranscriptWord[];
  speaker?: string;
  confidence?: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments: readonly TranscriptSegment[];
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TranscriptionRequest extends AiControlOptions {
  source: string;
  language?: string;
  prompt?: string;
  model?: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TranscriptionAdapter {
  readonly id: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export interface AutomaticCaptionOptions extends AiControlOptions {
  language?: string;
  prompt?: string;
  model?: string;
  format?: CaptionFormat;
  template?: CaptionTemplateName;
  style?: CaptionStyle;
}

export interface SceneBoundary {
  time: number;
  score?: number;
}

export interface SceneRange {
  id: string;
  start: number;
  end: number;
  duration: number;
  score?: number;
}

export interface SceneDetectionResult {
  source: string;
  durationSeconds: number;
  threshold?: number;
  boundaries: readonly SceneBoundary[];
  scenes: readonly SceneRange[];
  adapterId: string;
}

export interface SceneDetectionRequest extends AiControlOptions {
  source: string;
  threshold?: number;
  minSceneDuration?: number;
}

export interface SceneDetectionAdapter {
  readonly id: string;
  detectScenes(request: SceneDetectionRequest): Promise<SceneDetectionResult>;
}

export interface SilenceRemovalOptions extends AiControlOptions {
  noiseDb?: number;
  minSilenceDuration?: number;
  paddingSeconds?: number;
  minimumKeepDuration?: number;
}

export interface TimeRange {
  start: number;
  end: number;
  duration: number;
}

export interface SilenceRemovalPlan {
  source: string;
  originalDurationSeconds: number;
  outputDurationSeconds: number;
  removed: readonly TimeRange[];
  kept: readonly TimeRange[];
  project: VideoProjectAst;
}

export interface RemoveSilenceOptions extends SilenceRemovalOptions {
  video?: VideoLoadOptions;
  render?: ProjectRenderOptions;
}

export interface SubjectRegion {
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface SubjectTrackingResult {
  source: string;
  durationSeconds: number;
  regions: readonly SubjectRegion[];
  adapterId: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SubjectTrackingRequest extends AiControlOptions {
  source: string;
  subject?: string;
  sampleIntervalSeconds?: number;
}

export interface SubjectTrackingAdapter {
  readonly id: string;
  trackSubject(request: SubjectTrackingRequest): Promise<SubjectTrackingResult>;
}

export interface SmartReframeOptions extends AiControlOptions {
  subject?: string;
  sampleIntervalSeconds?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  margin?: number;
}

export interface SmartReframeKeyframe {
  time: number;
  x: number;
  y: number;
  scale: number;
  confidence?: number;
}

export interface SmartReframePlan {
  source: string;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  durationSeconds: number;
  keyframes: readonly SmartReframeKeyframe[];
  project: VideoProjectAst;
  adapterId: string;
}

export interface HighlightSegment {
  id: string;
  start: number;
  end: number;
  score: number;
  reason?: string;
  title?: string;
}

export interface HighlightExtractionResult {
  source: string;
  durationSeconds: number;
  highlights: readonly HighlightSegment[];
  adapterId: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HighlightExtractionRequest extends AiControlOptions {
  source: string;
  maxHighlights?: number;
  minDuration?: number;
  maxDuration?: number;
  prompt?: string;
}

export interface HighlightExtractionAdapter {
  readonly id: string;
  extractHighlights(request: HighlightExtractionRequest): Promise<HighlightExtractionResult>;
}

export interface HighlightProjectOptions extends AiControlOptions {
  maxHighlights?: number;
  minDuration?: number;
  maxDuration?: number;
  prompt?: string;
  width?: number;
  height?: number;
  fps?: number;
  gapSeconds?: number;
}

export interface HighlightProjectResult {
  analysis: HighlightExtractionResult;
  project: VideoProjectAst;
}

export interface VexaAIOptions {
  transcription?: TranscriptionAdapter;
  scenes?: SceneDetectionAdapter;
  tracking?: SubjectTrackingAdapter;
  highlights?: HighlightExtractionAdapter;
}

export interface CaptionGenerationResult {
  transcription: TranscriptionResult;
  captions: CaptionDocument;
}

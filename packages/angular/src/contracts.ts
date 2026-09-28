import type {
  JobSnapshot,
  JobSubmissionOptions,
  ProbeResult,
  VideoOperation,
  VideoProjectAst
} from "@vexa-video/core/browser";

export type {
  CaptionDocument,
  JobDescriptor,
  JobFailure,
  JobProgress,
  JobRetryOptions,
  JobRetryPolicy,
  JobSnapshot,
  JobState,
  JobSubmissionOptions,
  JobTerminalState,
  ProbeResult,
  VideoOperation,
  VideoPipelineAst,
  VideoProjectAst
} from "@vexa-video/core/browser";

export interface VexaMediaAsset {
  id: string;
  name: string;
  sizeBytes: number | null;
  contentType?: string;
  url: string;
  metadata?: ProbeResult;
}

export interface VexaUploadOptions {
  filename?: string;
  contentType?: string;
  signal?: AbortSignal;
}

export interface VexaBrowserExportOptions {
  videoCodec?: "h264" | "h265" | "av1" | "vp9" | "copy";
  audioCodec?: "aac" | "opus" | "mp3" | "copy" | "none";
  crf?: number;
  preset?: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow";
  pixelFormat?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  hardwareAcceleration?: "auto" | "cpu" | "nvidia" | "intel" | "amd" | "apple";
  hardwareFallback?: boolean;
}

export interface VexaVideoRenderRequest {
  mediaId: string;
  operations?: readonly VideoOperation[];
  outputFormat?: "mp4" | "webm";
  export?: VexaBrowserExportOptions;
}

export interface VexaProjectRenderRequest {
  project: VideoProjectAst;
  /** Maps project clip source identifiers to uploaded media IDs. */
  media: Readonly<Record<string, string>>;
  outputFormat?: "mp4" | "webm";
  export?: VexaBrowserExportOptions;
}

export interface VexaRenderResult {
  outputName: string;
  outputUrl: string;
  metadata?: ProbeResult;
}

export interface VexaSubmitJobRequest<TPayload = unknown> {
  type: string;
  payload: TPayload;
  options?: JobSubmissionOptions;
}

export interface VexaSubmitJobResponse<TPayload = unknown, TResult = unknown> {
  job: JobSnapshot<TPayload, TResult>;
}

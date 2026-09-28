import type { CaptionCue, CaptionDocument } from "@moosky-video/core";
import { Captions } from "@moosky-video/sdk";
import type {
  AutomaticCaptionOptions,
  CaptionGenerationResult,
  HighlightExtractionRequest,
  HighlightExtractionResult,
  HighlightProjectOptions,
  HighlightProjectResult,
  SceneDetectionRequest,
  SceneDetectionResult,
  SmartReframeOptions,
  SmartReframePlan,
  SubjectTrackingRequest,
  SubjectTrackingResult,
  TranscriptionRequest,
  TranscriptionResult,
  VexaAIOptions
} from "./contracts.js";
import { createHighlightProject } from "./highlights.js";
import { normalizeHighlights, normalizeScenes, normalizeTracking, normalizeTranscription } from "./normalize.js";
import { createSmartReframePlan } from "./reframe.js";
import { FfmpegSceneDetector } from "./scene.js";
import { planSilenceRemoval, removeSilence } from "./silence.js";

export * from "./contracts.js";
export * from "./highlights.js";
export * from "./reframe.js";
export * from "./scene.js";
export * from "./silence.js";

function requireAdapter<T>(adapter: T | undefined, label: string): T {
  if (!adapter) throw new TypeError(`${label} adapter is not configured.`);
  return adapter;
}

function captionsFromTranscription(result: TranscriptionResult, options: AutomaticCaptionOptions): CaptionDocument {
  const cues: CaptionCue[] = result.segments.map((segment, index) => ({
    id: segment.id ?? String(index + 1),
    start: segment.start,
    end: segment.end,
    text: segment.text,
    ...(segment.words?.length ? { words: segment.words.map((word) => ({ text: word.text, start: word.start, end: word.end })) } : {})
  }));
  const base: CaptionDocument = {
    schemaVersion: 1,
    format: options.format ?? "srt",
    ...(result.language ? { language: result.language } : {}),
    cues
  };
  return Captions.applyTemplate(base, options.template ?? "subtitle", options.style ?? {});
}

export class VexaAI {
  readonly #options: VexaAIOptions;

  constructor(options: VexaAIOptions = {}) {
    this.#options = options;
  }

  async transcribe(source: string, options: Omit<TranscriptionRequest, "source"> = {}): Promise<TranscriptionResult> {
    const adapter = requireAdapter(this.#options.transcription, "Transcription");
    return normalizeTranscription(await adapter.transcribe({ source, ...options }));
  }

  async captions(source: string, options: AutomaticCaptionOptions = {}): Promise<CaptionGenerationResult> {
    const transcription = await this.transcribe(source, {
      ...(options.language ? { language: options.language } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    return { transcription, captions: captionsFromTranscription(transcription, options) };
  }

  async detectScenes(source: string, options: Omit<SceneDetectionRequest, "source"> = {}): Promise<SceneDetectionResult> {
    const adapter = this.#options.scenes ?? new FfmpegSceneDetector();
    return normalizeScenes(await adapter.detectScenes({ source, ...options }));
  }

  async trackSubject(source: string, options: Omit<SubjectTrackingRequest, "source"> = {}): Promise<SubjectTrackingResult> {
    const adapter = requireAdapter(this.#options.tracking, "Subject tracking");
    return normalizeTracking(await adapter.trackSubject({ source, ...options }));
  }

  async smartReframe(source: string, options: SmartReframeOptions = {}): Promise<SmartReframePlan> {
    const adapter = requireAdapter(this.#options.tracking, "Subject tracking");
    return await createSmartReframePlan(source, adapter, options);
  }

  async extractHighlights(source: string, options: Omit<HighlightExtractionRequest, "source"> = {}): Promise<HighlightExtractionResult> {
    const adapter = requireAdapter(this.#options.highlights, "Highlight extraction");
    return normalizeHighlights(await adapter.extractHighlights({ source, ...options }));
  }

  async highlightProject(source: string, options: HighlightProjectOptions = {}): Promise<HighlightProjectResult> {
    const adapter = requireAdapter(this.#options.highlights, "Highlight extraction");
    return await createHighlightProject(source, adapter, options);
  }

  planSilenceRemoval = planSilenceRemoval;
  removeSilence = removeSilence;
}

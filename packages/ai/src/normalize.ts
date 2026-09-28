import type {
  HighlightExtractionResult,
  SceneBoundary,
  SceneDetectionResult,
  SceneRange,
  SubjectRegion,
  SubjectTrackingResult,
  TranscriptSegment,
  TranscriptWord,
  TranscriptionResult
} from "./contracts.js";

export function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite non-negative number.`);
  return value;
}

export function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a finite number greater than zero.`);
  return value;
}

export function confidence(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`${label} must be between 0 and 1.`);
  return value;
}

function text(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must not be empty.`);
  return normalized;
}

function transcriptWord(value: TranscriptWord, segment: TranscriptSegment, index: number): TranscriptWord {
  const start = finiteNonNegative(value.start, `word ${index + 1}.start`);
  const end = finiteNonNegative(value.end, `word ${index + 1}.end`);
  if (end <= start) throw new TypeError(`word ${index + 1} must end after it starts.`);
  if (start < segment.start - 1e-6 || end > segment.end + 1e-6) {
    throw new TypeError(`word ${index + 1} must stay inside its transcript segment.`);
  }
  const score = confidence(value.confidence, `word ${index + 1}.confidence`);
  return {
    text: text(value.text, `word ${index + 1}.text`),
    start,
    end,
    ...(score !== undefined ? { confidence: score } : {})
  };
}

export function normalizeTranscription(result: TranscriptionResult): TranscriptionResult {
  const segments = result.segments.map((segment, index) => {
    const start = finiteNonNegative(segment.start, `segment ${index + 1}.start`);
    const end = finiteNonNegative(segment.end, `segment ${index + 1}.end`);
    if (end <= start) throw new TypeError(`segment ${index + 1} must end after it starts.`);
    const normalized: TranscriptSegment = {
      ...(segment.id?.trim() ? { id: segment.id.trim() } : {}),
      start,
      end,
      text: text(segment.text, `segment ${index + 1}.text`),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
      ...(confidence(segment.confidence, `segment ${index + 1}.confidence`) !== undefined
        ? { confidence: confidence(segment.confidence, `segment ${index + 1}.confidence`)! }
        : {})
    };
    if (segment.words?.length) normalized.words = segment.words.map((word, wordIndex) => transcriptWord(word, normalized, wordIndex));
    return normalized;
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  const durationSeconds = result.durationSeconds === undefined
    ? undefined
    : finiteNonNegative(result.durationSeconds, "transcription.durationSeconds");
  return {
    text: result.text.trim() || segments.map((segment) => segment.text).join(" "),
    ...(result.language?.trim() ? { language: result.language.trim() } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    segments,
    ...(result.metadata ? { metadata: { ...result.metadata } } : {})
  };
}

export function normalizeScenes(result: SceneDetectionResult): SceneDetectionResult {
  const durationSeconds = finiteNonNegative(result.durationSeconds, "scene.durationSeconds");
  const boundaries: SceneBoundary[] = result.boundaries
    .map((boundary, index) => ({
      time: finiteNonNegative(boundary.time, `scene boundary ${index + 1}.time`),
      ...(confidence(boundary.score, `scene boundary ${index + 1}.score`) !== undefined
        ? { score: confidence(boundary.score, `scene boundary ${index + 1}.score`)! }
        : {})
    }))
    .filter((boundary) => boundary.time > 0 && boundary.time < durationSeconds)
    .sort((a, b) => a.time - b.time);

  const deduped: SceneBoundary[] = [];
  for (const boundary of boundaries) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.time - boundary.time) < 1e-6) continue;
    deduped.push(boundary);
  }
  const points = [0, ...deduped.map((item) => item.time), durationSeconds];
  const scenes: SceneRange[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    scenes.push({
      id: `scene-${index + 1}`,
      start,
      end,
      duration: end - start,
      ...(index > 0 && deduped[index - 1]?.score !== undefined ? { score: deduped[index - 1]!.score! } : {})
    });
  }
  return { ...result, durationSeconds, boundaries: deduped, scenes };
}

export function normalizeTracking(result: SubjectTrackingResult): SubjectTrackingResult {
  const durationSeconds = finitePositive(result.durationSeconds, "tracking.durationSeconds");
  const regions: SubjectRegion[] = result.regions.map((region, index) => {
    const values = [region.x, region.y, region.width, region.height];
    if (values.some((value) => !Number.isFinite(value))) throw new TypeError(`tracking region ${index + 1} must be finite.`);
    if (region.width <= 0 || region.height <= 0) throw new TypeError(`tracking region ${index + 1} width/height must be positive.`);
    if (region.x < 0 || region.y < 0 || region.x + region.width > 1 + 1e-6 || region.y + region.height > 1 + 1e-6) {
      throw new TypeError(`tracking region ${index + 1} must use normalized 0-1 coordinates inside the frame.`);
    }
    const score = confidence(region.confidence, `tracking region ${index + 1}.confidence`);
    return {
      time: finiteNonNegative(region.time, `tracking region ${index + 1}.time`),
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      ...(score !== undefined ? { confidence: score } : {})
    };
  }).filter((region) => region.time <= durationSeconds + 1e-6).sort((a, b) => a.time - b.time);
  return { ...result, durationSeconds, regions };
}

export function normalizeHighlights(result: HighlightExtractionResult): HighlightExtractionResult {
  const durationSeconds = finitePositive(result.durationSeconds, "highlights.durationSeconds");
  const ids = new Set<string>();
  const highlights = result.highlights.map((item, index) => {
    const start = finiteNonNegative(item.start, `highlight ${index + 1}.start`);
    const end = finiteNonNegative(item.end, `highlight ${index + 1}.end`);
    if (end <= start || end > durationSeconds + 1e-6) throw new TypeError(`highlight ${index + 1} has invalid timing.`);
    const id = item.id.trim() || `highlight-${index + 1}`;
    if (ids.has(id)) throw new TypeError(`duplicate highlight id: ${id}`);
    ids.add(id);
    const score = confidence(item.score, `highlight ${index + 1}.score`) ?? 0;
    return {
      id,
      start,
      end,
      score,
      ...(item.reason?.trim() ? { reason: item.reason.trim() } : {}),
      ...(item.title?.trim() ? { title: item.title.trim() } : {})
    };
  }).sort((a, b) => b.score - a.score || a.start - b.start);
  return { ...result, durationSeconds, highlights };
}

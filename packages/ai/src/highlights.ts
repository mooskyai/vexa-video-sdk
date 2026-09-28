import { Video, createProject } from "@vexa-video/sdk";
import type { HighlightExtractionAdapter, HighlightProjectOptions, HighlightProjectResult } from "./contracts.js";
import { finiteNonNegative, normalizeHighlights } from "./normalize.js";

export async function createHighlightProject(
  source: string,
  adapter: HighlightExtractionAdapter,
  options: HighlightProjectOptions = {}
): Promise<HighlightProjectResult> {
  const probe = await Video.load(source).probe({
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  if (!probe.video || probe.durationSeconds === null) throw new TypeError("Highlight extraction requires a video stream with known duration.");
  if (probe.video.width === null || probe.video.height === null) throw new TypeError("Highlight extraction requires known video dimensions.");
  const analysis = normalizeHighlights(await adapter.extractHighlights({
    source,
    ...(options.maxHighlights !== undefined ? { maxHighlights: options.maxHighlights } : {}),
    ...(options.minDuration !== undefined ? { minDuration: options.minDuration } : {}),
    ...(options.maxDuration !== undefined ? { maxDuration: options.maxDuration } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  }));
  const gap = options.gapSeconds ?? 0;
  finiteNonNegative(gap, "highlight gapSeconds");
  const selected = analysis.highlights.slice(0, options.maxHighlights ?? analysis.highlights.length).sort((a, b) => a.start - b.start);
  if (!selected.length) throw new TypeError("Highlight adapter returned no highlights.");

  let project = createProject({
    id: "ai-highlights",
    name: "AI highlights",
    width: options.width ?? probe.video.width,
    height: options.height ?? probe.video.height,
    fps: options.fps ?? probe.video.fps ?? 30,
    background: "black"
  }).addTrack({ id: "video", type: "video", name: "Highlights" });
  let timeline = 0;
  for (const item of selected) {
    project = project.addClip("video", {
      id: item.id,
      kind: "video",
      source,
      sourceStart: item.start,
      start: timeline,
      duration: item.end - item.start,
      includeAudio: true,
      transform: { fit: "cover" }
    });
    timeline += item.end - item.start + gap;
  }
  return { analysis, project: project.ast };
}

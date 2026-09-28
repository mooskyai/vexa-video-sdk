import type { SilenceRange } from "@moosky-video/core";
import { Audio, Video, VideoProject, createProject } from "@moosky-video/sdk";
import type { RemoveSilenceOptions, SilenceRemovalOptions, SilenceRemovalPlan, TimeRange } from "./contracts.js";
import { finiteNonNegative, finitePositive } from "./normalize.js";

function mergeRanges(ranges: readonly TimeRange[], duration: number): TimeRange[] {
  const sorted = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(duration, range.end), duration: 0 }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1e-6) {
      previous.end = Math.max(previous.end, range.end);
      previous.duration = previous.end - previous.start;
    } else {
      merged.push({ start: range.start, end: range.end, duration: range.end - range.start });
    }
  }
  return merged;
}

export function createSilenceRemovalPlanFromRanges(
  source: string,
  durationSeconds: number,
  width: number,
  height: number,
  fps: number,
  silence: readonly SilenceRange[],
  options: SilenceRemovalOptions = {}
): SilenceRemovalPlan {
  finitePositive(durationSeconds, "durationSeconds");
  finitePositive(width, "width");
  finitePositive(height, "height");
  finitePositive(fps, "fps");
  const padding = options.paddingSeconds ?? 0.08;
  const minimumKeep = options.minimumKeepDuration ?? 0.12;
  finiteNonNegative(padding, "silence paddingSeconds");
  finiteNonNegative(minimumKeep, "silence minimumKeepDuration");

  const removed = mergeRanges(
    silence.map((range) => ({
      start: Math.max(0, range.start + padding),
      end: Math.min(durationSeconds, range.end - padding),
      duration: 0
    })),
    durationSeconds
  );
  const kept: TimeRange[] = [];
  let cursor = 0;
  for (const range of removed) {
    if (range.start - cursor >= minimumKeep) kept.push({ start: cursor, end: range.start, duration: range.start - cursor });
    cursor = Math.max(cursor, range.end);
  }
  if (durationSeconds - cursor >= minimumKeep) kept.push({ start: cursor, end: durationSeconds, duration: durationSeconds - cursor });
  if (!kept.length) throw new TypeError("Silence-removal plan would remove the entire source.");

  let project = createProject({
    id: "ai-silence-removal",
    name: "Silence removal",
    width: Math.round(width),
    height: Math.round(height),
    fps,
    background: "black"
  }).addTrack({ id: "video", type: "video", name: "Compacted source" });
  let start = 0;
  kept.forEach((range, index) => {
    project = project.addClip("video", {
      id: `keep-${index + 1}`,
      kind: "video",
      source,
      sourceStart: range.start,
      start,
      duration: range.duration,
      includeAudio: true,
      transform: { fit: "cover" }
    });
    start += range.duration;
  });
  return {
    source,
    originalDurationSeconds: durationSeconds,
    outputDurationSeconds: start,
    removed,
    kept,
    project: project.ast
  };
}

export async function planSilenceRemoval(source: string, options: SilenceRemovalOptions = {}): Promise<SilenceRemovalPlan> {
  const video = Video.load(source);
  const info = await video.probe({
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  if (!info.video) throw new TypeError("Silence removal requires a video stream.");
  if (info.video.width === null || info.video.height === null) throw new TypeError("Silence removal requires known video dimensions.");
  if (!info.audio) throw new TypeError("Silence removal requires an audio stream.");
  if (info.durationSeconds === null) throw new TypeError("Silence removal requires a known source duration.");
  const detection = await Audio.load(source).detectSilence({
    noiseDb: options.noiseDb ?? -40,
    minDuration: options.minSilenceDuration ?? 0.5,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  return createSilenceRemovalPlanFromRanges(
    source,
    info.durationSeconds,
    info.video.width,
    info.video.height,
    info.video.fps ?? 30,
    detection.ranges,
    options
  );
}

export async function removeSilence(source: string, output: string, options: RemoveSilenceOptions = {}): Promise<SilenceRemovalPlan> {
  const plan = await planSilenceRemoval(source, options);
  await VideoProject.fromAst(plan.project, options.video ?? {}).render(output, options.render ?? {});
  return plan;
}

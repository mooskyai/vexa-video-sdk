import { Video, createProject } from "@moosky-video/sdk";
import type { SmartReframeOptions, SmartReframePlan, SubjectTrackingAdapter } from "./contracts.js";
import { finitePositive, normalizeTracking } from "./normalize.js";

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export async function createSmartReframePlan(
  source: string,
  adapter: SubjectTrackingAdapter,
  options: SmartReframeOptions = {}
): Promise<SmartReframePlan> {
  const probe = await Video.load(source).probe({
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  if (!probe.video || probe.durationSeconds === null) throw new TypeError("Smart reframe requires a video stream with known duration.");
  if (probe.video.width === null || probe.video.height === null) throw new TypeError("Smart reframe requires known video dimensions.");
  const tracking = normalizeTracking(await adapter.trackSubject({
    source,
    ...(options.subject ? { subject: options.subject } : {}),
    ...(options.sampleIntervalSeconds !== undefined ? { sampleIntervalSeconds: options.sampleIntervalSeconds } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  }));
  if (!tracking.regions.length) throw new TypeError("Subject tracking returned no regions.");

  const aspect = options.aspectRatio ?? (9 / 16);
  finitePositive(aspect, "smart reframe aspectRatio");
  const targetHeight = even(options.height ?? probe.video.height);
  const targetWidth = even(options.width ?? targetHeight * aspect);
  const margin = options.margin ?? 0.2;
  if (!Number.isFinite(margin) || margin < 0 || margin > 2) throw new TypeError("smart reframe margin must be between 0 and 2.");

  const sourceWidth = probe.video.width;
  const sourceHeight = probe.video.height;
  const keyframes = tracking.regions.map((region) => {
    const subjectW = region.width * sourceWidth;
    const subjectH = region.height * sourceHeight;
    const minimumScaleX = targetWidth / Math.max(1, subjectW * (1 + margin * 2));
    const minimumScaleY = targetHeight / Math.max(1, subjectH * (1 + margin * 2));
    const fillScale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const scale = Math.max(fillScale, Math.min(minimumScaleX, minimumScaleY));
    const centerX = (region.x + region.width / 2) * sourceWidth * scale;
    const centerY = (region.y + region.height / 2) * sourceHeight * scale;
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    const x = Math.min(0, Math.max(targetWidth - scaledWidth, targetWidth / 2 - centerX));
    const y = Math.min(0, Math.max(targetHeight - scaledHeight, targetHeight / 2 - centerY));
    return { time: region.time, x, y, scale, ...(region.confidence !== undefined ? { confidence: region.confidence } : {}) };
  });

  let project = createProject({
    id: "ai-smart-reframe",
    name: "Smart reframe",
    width: targetWidth,
    height: targetHeight,
    fps: probe.video.fps ?? 30,
    duration: probe.durationSeconds,
    background: "black"
  }).addTrack({ id: "video", type: "video", name: "Tracked subject" });
  project = project.addClip("video", {
    id: "tracked-source",
    kind: "video",
    source,
    start: 0,
    duration: probe.durationSeconds,
    includeAudio: true,
    transform: {
      fit: "fill",
      width: { value: sourceWidth * keyframes[0]!.scale, keyframes: keyframes.map((frame) => ({ time: frame.time, value: sourceWidth * frame.scale, easing: "ease-in-out" })) },
      height: { value: sourceHeight * keyframes[0]!.scale, keyframes: keyframes.map((frame) => ({ time: frame.time, value: sourceHeight * frame.scale, easing: "ease-in-out" })) },
      x: { value: keyframes[0]!.x, keyframes: keyframes.map((frame) => ({ time: frame.time, value: frame.x, easing: "ease-in-out" })) },
      y: { value: keyframes[0]!.y, keyframes: keyframes.map((frame) => ({ time: frame.time, value: frame.y, easing: "ease-in-out" })) }
    }
  });

  return {
    source,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    durationSeconds: probe.durationSeconds,
    keyframes,
    project: project.ast,
    adapterId: adapter.id
  };
}

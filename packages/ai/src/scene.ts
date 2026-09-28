import { runProcess } from "@vexa-video/ffmpeg";
import { Video } from "@vexa-video/sdk";
import type {
  SceneBoundary,
  SceneDetectionAdapter,
  SceneDetectionRequest,
  SceneDetectionResult
} from "./contracts.js";
import { finiteNonNegative, normalizeScenes } from "./normalize.js";

export interface FfmpegSceneDetectorOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}

export function parseFfmpegSceneMetadata(output: string): readonly SceneBoundary[] {
  const boundaries: SceneBoundary[] = [];
  let time: number | undefined;
  for (const line of output.split(/\r?\n/u)) {
    const timeMatch = /pts_time:([0-9]+(?:\.[0-9]+)?)/u.exec(line);
    if (timeMatch) time = Number(timeMatch[1]);
    const scoreMatch = /lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)/u.exec(line);
    if (scoreMatch && time !== undefined) {
      boundaries.push({ time, score: Number(scoreMatch[1]) });
      time = undefined;
    }
  }
  return boundaries;
}

export class FfmpegSceneDetector implements SceneDetectionAdapter {
  readonly id = "ffmpeg.scene-detection";
  readonly #ffmpegPath: string;
  readonly #ffprobePath: string | undefined;

  constructor(options: FfmpegSceneDetectorOptions = {}) {
    this.#ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.#ffprobePath = options.ffprobePath;
  }

  async detectScenes(request: SceneDetectionRequest): Promise<SceneDetectionResult> {
    const threshold = request.threshold ?? 0.3;
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new TypeError("scene threshold must be greater than 0 and at most 1.");
    }
    const minSceneDuration = request.minSceneDuration ?? 0;
    finiteNonNegative(minSceneDuration, "scene minSceneDuration");
    const probe = await Video.load(request.source, {
      ...(this.#ffprobePath ? { ffprobePath: this.#ffprobePath } : {}),
      ffmpegPath: this.#ffmpegPath
    }).probe({
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {})
    });
    if (!probe.video) throw new TypeError("Scene detection requires a video stream.");
    const durationSeconds = probe.durationSeconds;
    if (durationSeconds === null) throw new TypeError("Scene detection requires a known source duration.");

    const result = await runProcess(this.#ffmpegPath, [
      "-hide_banner", "-loglevel", "info",
      "-i", request.source,
      "-vf", `select='gt(scene,${threshold})',metadata=print`,
      "-an", "-f", "null", "-"
    ], {
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {})
    });

    const parsed = parseFfmpegSceneMetadata(result.stderr);
    const filtered: SceneBoundary[] = [];
    for (const boundary of parsed) {
      const previous = filtered.at(-1);
      if (!previous || boundary.time - previous.time >= minSceneDuration) filtered.push(boundary);
    }
    return normalizeScenes({
      source: request.source,
      durationSeconds,
      threshold,
      boundaries: filtered,
      scenes: [],
      adapterId: this.id
    });
  }
}

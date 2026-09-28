import type { MediaProgress } from "@moosky-video/core";

interface ProgressState {
  frame?: string;
  fps?: string;
  speed?: string;
  out_time_us?: string;
  out_time_ms?: string;
  out_time?: string;
  progress?: string;
}

function parseFinite(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value.replace(/x$/u, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseClock(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [hoursRaw, minutesRaw, secondsRaw] = parts;
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function processedSeconds(state: ProgressState): number {
  const microseconds = parseFinite(state.out_time_us);
  if (microseconds !== null) return Math.max(0, microseconds / 1_000_000);

  // FFmpeg historically labels this field out_time_ms while reporting microseconds.
  const legacyMicroseconds = parseFinite(state.out_time_ms);
  if (legacyMicroseconds !== null) return Math.max(0, legacyMicroseconds / 1_000_000);

  return Math.max(0, parseClock(state.out_time) ?? 0);
}

export class FfmpegProgressParser {
  #buffer = "";
  #state: ProgressState = {};
  readonly durationSeconds: number | null;

  constructor(durationSeconds: number | null = null) {
    this.durationSeconds = durationSeconds;
  }

  push(chunk: string, emit: (progress: MediaProgress) => void): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/u);
    this.#buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;

      const key = line.slice(0, separator) as keyof ProgressState;
      const value = line.slice(separator + 1);
      this.#state[key] = value;

      if (key === "progress") {
        emit(this.#snapshot(value === "end" ? "end" : "continue"));
        this.#state = {};
      }
    }
  }

  #snapshot(status: "continue" | "end"): MediaProgress {
    const processed = processedSeconds(this.#state);
    const percent =
      this.durationSeconds && this.durationSeconds > 0
        ? Math.min(100, Math.max(0, (processed / this.durationSeconds) * 100))
        : null;

    return {
      frame: parseFinite(this.#state.frame),
      fps: parseFinite(this.#state.fps),
      speed: parseFinite(this.#state.speed),
      processedSeconds: processed,
      durationSeconds: this.durationSeconds,
      percent: status === "end" && percent !== null ? 100 : percent,
      status
    };
  }
}

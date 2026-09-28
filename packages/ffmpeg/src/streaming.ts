import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type {
  HardwareAccelerationCapabilities,
  PreviewSpriteOptions,
  PreviewSpritePlan,
  PreviewSpriteResult,
  ProbeResult,
  StreamingExecutionPlan,
  StreamingPackageOptions,
  StreamingPackageResult,
  StreamingRendition
} from "@moosky-video/core";
import {
  InvalidStreamingError,
  normalizeSegmentDuration,
  resolveStreamingRenditions
} from "@moosky-video/core";
import { FfmpegProgressParser } from "./progress.js";
import { appendVideoEncoderOptions, hardwareOptimizationMarkers, resolveHardwareAcceleration } from "./hardware.js";
import { runProcess } from "./process.js";

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function scaleFilter(rendition: StreamingRendition, fps: number): string {
  return [
    `scale=${rendition.width}:${rendition.height}:force_original_aspect_ratio=decrease`,
    `pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${number(fps)}`,
    "format=yuv420p"
  ].join(",");
}

function streamingFilterGraph(
  renditions: readonly StreamingRendition[],
  sourceFps: number,
  segmentDuration: number
): { expression: string; fps: readonly number[]; gops: readonly number[] } {
  const fps = renditions.map((rendition) => rendition.fps ?? Math.min(sourceFps || 30, 30));
  const gops = fps.map((value) => Math.max(1, Math.round(value * segmentDuration)));
  if (renditions.length === 1) {
    return {
      expression: `[0:v]${scaleFilter(renditions[0]!, fps[0]!)}[v0]`,
      fps,
      gops
    };
  }
  const splitLabels = renditions.map((_, index) => `[vs${index}]`).join("");
  const parts = [`[0:v]split=${renditions.length}${splitLabels}`];
  renditions.forEach((rendition, index) => {
    parts.push(`[vs${index}]${scaleFilter(rendition, fps[index]!)}[v${index}]`);
  });
  return { expression: parts.join(";"), fps, gops };
}

function appendVideoCodecArgs(
  args: string[],
  renditions: readonly StreamingRendition[],
  gops: readonly number[],
  hardware: ReturnType<typeof resolveHardwareAcceleration>
): void {
  renditions.forEach((rendition, index) => {
    appendVideoEncoderOptions(args, hardware, {
      preset: "veryfast",
      videoBitrate: rendition.videoBitrate
    }, String(index));
    args.push(
      `-g:v:${index}`, String(gops[index]),
      `-keyint_min:v:${index}`, String(gops[index]),
      `-sc_threshold:v:${index}`, "0"
    );
    if (rendition.maxRate) args.push(`-maxrate:v:${index}`, rendition.maxRate);
    if (rendition.bufferSize) args.push(`-bufsize:v:${index}`, rendition.bufferSize);
  });
}

function audioBitrate(renditions: readonly StreamingRendition[]): string {
  return renditions.at(-1)?.audioBitrate ?? "128k";
}

export function createStreamingExecutionPlan(
  source: string,
  outputDirectory: string,
  options: StreamingPackageOptions,
  probe: ProbeResult,
  hardwareCapabilities: HardwareAccelerationCapabilities | null = null
): StreamingExecutionPlan {
  if (!probe.video) throw new InvalidStreamingError("Streaming packaging requires a video stream.");
  const protocol = options.protocol;
  if (protocol !== "hls" && protocol !== "dash") {
    throw new InvalidStreamingError(`Unsupported streaming protocol: ${String(protocol)}.`);
  }
  const renditions = resolveStreamingRenditions(options);
  const segmentDuration = normalizeSegmentDuration(options.segmentDuration);
  const hasAudio = Boolean(probe.audio);
  const durationSeconds = probe.durationSeconds;
  const graph = streamingFilterGraph(renditions, probe.video.fps || 30, segmentDuration);
  const hardware = resolveHardwareAcceleration(
    "h264",
    options.hardwareAcceleration,
    hardwareCapabilities,
    options.hardwareFallback !== false
  );
  const args: string[] = [options.overwrite === false ? "-n" : "-y", "-i", source, "-filter_complex", graph.expression];
  const optimizations = [
    "ADAPTIVE_RENDITION_LADDER",
    "ALIGNED_GOP_SEGMENTS",
    ...hardwareOptimizationMarkers(hardware)
  ];

  if (protocol === "hls") {
    renditions.forEach((_, index) => {
      args.push("-map", `[v${index}]`);
      if (hasAudio) args.push("-map", "0:a:0");
    });
    appendVideoCodecArgs(args, renditions, graph.gops, hardware);
    if (hasAudio) {
      renditions.forEach((rendition, index) => {
        args.push(`-c:a:${index}`, "aac", `-b:a:${index}`, rendition.audioBitrate ?? "128k", `-ac:a:${index}`, "2");
      });
    }
    const variants = renditions.map((_, index) =>
      hasAudio ? `v:${index},a:${index}` : `v:${index}`
    ).join(" ");
    args.push(
      "-f", "hls",
      "-hls_time", number(segmentDuration),
      "-hls_playlist_type", options.hlsPlaylistType ?? "vod",
      "-hls_flags", "independent_segments",
      "-hls_segment_filename", join(outputDirectory, "v%v", "segment_%05d.ts"),
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", variants,
      join(outputDirectory, "v%v", "index.m3u8")
    );
    optimizations.push("HLS_MASTER_PLAYLIST", "HLS_VARIANT_PLAYLISTS");
    return {
      schemaVersion: 1,
      backend: "ffmpeg",
      task: "streaming-package",
      protocol,
      source,
      outputDirectory,
      manifestPath: join(outputDirectory, "master.m3u8"),
      durationSeconds,
      hasAudio,
      segmentDuration,
      renditions,
      args,
      optimizations,
      hardware
    };
  }

  renditions.forEach((_, index) => args.push("-map", `[v${index}]`));
  if (hasAudio) args.push("-map", "0:a:0");
  appendVideoCodecArgs(args, renditions, graph.gops, hardware);
  if (hasAudio) args.push("-c:a:0", "aac", "-b:a:0", audioBitrate(renditions), "-ac:a:0", "2");
  args.push(
    "-f", "dash",
    "-seg_duration", number(segmentDuration),
    "-use_template", "1",
    "-use_timeline", "1",
    "-init_seg_name", "init-$RepresentationID$.m4s",
    "-media_seg_name", "chunk-$RepresentationID$-$Number%05d$.m4s",
    "-adaptation_sets", hasAudio ? "id=0,streams=v id=1,streams=a" : "id=0,streams=v",
    join(outputDirectory, "manifest.mpd")
  );
  optimizations.push("DASH_MPD_MANIFEST", "DASH_ADAPTATION_SETS");
  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "streaming-package",
    protocol,
    source,
    outputDirectory,
    manifestPath: join(outputDirectory, "manifest.mpd"),
    durationSeconds,
    hasAudio,
    segmentDuration,
    renditions,
    args,
    optimizations,
    hardware
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function preparePackageDirectory(plan: StreamingExecutionPlan, overwrite: boolean | undefined): Promise<void> {
  if (await pathExists(plan.outputDirectory)) {
    const entries = await readdir(plan.outputDirectory);
    if (entries.length > 0 && overwrite === false) {
      throw new InvalidStreamingError(`Streaming output directory is not empty: ${plan.outputDirectory}`);
    }
    if (overwrite !== false) await rm(plan.outputDirectory, { recursive: true, force: true });
  }
  await mkdir(plan.outputDirectory, { recursive: true });
  if (plan.protocol === "hls") {
    for (let index = 0; index < plan.renditions.length; index += 1) {
      await mkdir(join(plan.outputDirectory, `v${index}`), { recursive: true });
    }
  }
}

async function listFilesRecursive(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(root, path));
    else files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

export function normalizeHlsPlaylistText(content: string): string {
  return content.replaceAll("\\", "/");
}

export function streamingExecutionCwd(plan: StreamingExecutionPlan): string | undefined {
  return plan.protocol === "dash" ? plan.outputDirectory : undefined;
}

async function normalizeHlsPackagePlaylists(root: string, current = root): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      await normalizeHlsPackagePlaylists(root, path);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(".m3u8")) continue;
    const content = await readFile(path, "utf8");
    const normalized = normalizeHlsPlaylistText(content);
    if (normalized !== content) await writeFile(path, normalized, "utf8");
  }
}

export async function runStreamingExecutionPlan(
  ffmpegPath: string,
  plan: StreamingExecutionPlan,
  options: Pick<StreamingPackageOptions, "signal" | "timeoutMs" | "onProgress" | "overwrite"> = {}
): Promise<StreamingPackageResult> {
  await preparePackageDirectory(plan, options.overwrite);
  const parser = options.onProgress ? new FfmpegProgressParser(plan.durationSeconds) : null;
  const cwd = streamingExecutionCwd(plan);
  try {
    await runProcess(
      ffmpegPath,
      ["-hide_banner", "-nostats", ...(parser ? ["-progress", "pipe:1"] : []), ...plan.args],
      {
        ...(cwd ? { cwd } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(parser && options.onProgress
          ? { onStdoutChunk: (chunk: string) => parser.push(chunk, options.onProgress!) }
          : {})
      }
    );
  } catch (error) {
    if (options.overwrite !== false) await rm(plan.outputDirectory, { recursive: true, force: true });
    throw error;
  }
  if (plan.protocol === "hls") {
    await normalizeHlsPackagePlaylists(plan.outputDirectory);
  }

  return {
    protocol: plan.protocol,
    outputDirectory: plan.outputDirectory,
    manifestPath: plan.manifestPath,
    files: await listFilesRecursive(plan.outputDirectory),
    renditions: plan.renditions
  };
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function createPreviewSpritePlan(
  source: string,
  outputDirectory: string,
  options: PreviewSpriteOptions,
  probe: ProbeResult
): PreviewSpritePlan {
  if (!probe.video) throw new InvalidStreamingError("Preview sprites require a video stream.");
  if (!probe.video.width || !probe.video.height) {
    throw new InvalidStreamingError("Preview sprites require known video dimensions.");
  }
  if (probe.durationSeconds === null || probe.durationSeconds <= 0) {
    throw new InvalidStreamingError("Preview sprites require a source with a known positive duration.");
  }
  const intervalSeconds = options.intervalSeconds ?? 5;
  const tileWidth = options.tileWidth ?? 160;
  const columns = options.columns ?? 5;
  const quality = options.quality ?? 3;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new InvalidStreamingError("previewSprite.intervalSeconds must be greater than 0.");
  if (!Number.isInteger(tileWidth) || tileWidth < 32) throw new InvalidStreamingError("previewSprite.tileWidth must be an integer of at least 32.");
  if (!Number.isInteger(columns) || columns < 1 || columns > 20) throw new InvalidStreamingError("previewSprite.columns must be between 1 and 20.");
  if (!Number.isInteger(quality) || quality < 1 || quality > 31) throw new InvalidStreamingError("previewSprite.quality must be between 1 and 31.");

  const durationSeconds = probe.durationSeconds;
  const tileHeight = even(tileWidth * probe.video.height / probe.video.width);
  const count = Math.max(1, Math.ceil(durationSeconds / intervalSeconds));
  const rows = Math.ceil(count / columns);
  const imagePath = join(outputDirectory, "sprite.jpg");
  const vttPath = join(outputDirectory, "sprite.vtt");
  const cues = Array.from({ length: count }, (_, index) => ({
    start: index * intervalSeconds,
    end: Math.min(durationSeconds, (index + 1) * intervalSeconds),
    x: (index % columns) * tileWidth,
    y: Math.floor(index / columns) * tileHeight,
    width: tileWidth,
    height: tileHeight
  }));
  const filter = [
    `fps=1/${number(intervalSeconds)}`,
    `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease`,
    `pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `tile=${columns}x${rows}:padding=0:margin=0`
  ].join(",");
  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "preview-sprite",
    source,
    outputDirectory,
    imagePath,
    vttPath,
    durationSeconds,
    intervalSeconds,
    tileWidth,
    tileHeight,
    columns,
    rows,
    cues,
    args: [options.overwrite === false ? "-n" : "-y", "-i", source, "-vf", filter, "-frames:v", "1", "-q:v", String(quality), imagePath]
  };
}

function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function previewSpriteVtt(plan: PreviewSpritePlan): string {
  const image = basename(plan.imagePath);
  const body = plan.cues.map((cue) =>
    `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${image}#xywh=${cue.x},${cue.y},${cue.width},${cue.height}`
  ).join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

export async function runPreviewSpritePlan(
  ffmpegPath: string,
  plan: PreviewSpritePlan,
  options: PreviewSpriteOptions = {}
): Promise<PreviewSpriteResult> {
  if (await pathExists(plan.outputDirectory)) {
    const entries = await readdir(plan.outputDirectory);
    if (entries.length > 0 && options.overwrite === false) {
      throw new InvalidStreamingError(`Preview sprite output directory is not empty: ${plan.outputDirectory}`);
    }
    if (options.overwrite !== false) await rm(plan.outputDirectory, { recursive: true, force: true });
  }
  await mkdir(plan.outputDirectory, { recursive: true });
  await runProcess(ffmpegPath, ["-hide_banner", ...plan.args], {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
  await writeFile(plan.vttPath, previewSpriteVtt(plan), "utf8");
  return { imagePath: plan.imagePath, vttPath: plan.vttPath, cues: plan.cues };
}

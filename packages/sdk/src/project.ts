import type {
  HardwareAccelerationCapabilities,
  MediaOutputResult,
  ProbeResult,
  ProjectExecutionPlan,
  ProjectRenderOptions,
  ProjectTrack,
  TimelineClip,
  VideoLoadOptions,
  VideoProjectAst
} from "@moosky-video/core";
import {
  InvalidProjectError,
  createVideoProjectAst,
  normalizeVideoProject,
  projectDurationSeconds
} from "@moosky-video/core";
import {
  createProjectExecutionPlan,
  detectHardwareAcceleration,
  probeMedia,
  resolveDefaultFontFile,
  resolveMediaBinaries,
  runFfmpeg,
  type MediaBinaries
} from "@moosky-video/ffmpeg";

interface ProjectRuntime {
  binariesPromise?: Promise<MediaBinaries>;
  hardwareCapabilitiesPromise?: Promise<HardwareAccelerationCapabilities>;
  defaultFontFilePromise?: Promise<string | null>;
}

export interface CreateVideoProjectOptions {
  id: string;
  name?: string;
  width: number;
  height: number;
  fps?: number;
  duration?: number;
  background?: string;
}

export interface AddProjectTrackOptions {
  id: string;
  type: ProjectTrack["type"];
  name?: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  clips?: readonly TimelineClip[];
}

export interface UpdateProjectTrackOptions {
  name?: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
}


function withDefaultTextFont(project: VideoProjectAst, fontFile: string | null): VideoProjectAst {
  if (!fontFile) return project;

  let changed = false;
  const tracks = project.tracks.map((track) => {
    const clips = track.clips.map((clip) => {
      if (clip.kind !== "text" || clip.enabled === false || clip.style?.fontFile) return clip;
      changed = true;
      return {
        ...clip,
        style: {
          ...clip.style,
          fontFile
        }
      };
    });
    return clips.some((clip, index) => clip !== track.clips[index]) ? { ...track, clips } : track;
  });

  return changed ? { ...project, tracks } : project;
}

function validateOutput(output: string): string {
  const value = output.trim();
  if (!value) throw new InvalidProjectError("Project output path cannot be empty.");
  return value;
}

export class VideoProject {
  readonly options: Readonly<VideoLoadOptions>;
  readonly #ast: VideoProjectAst;
  readonly #runtime: ProjectRuntime;

  private constructor(ast: VideoProjectAst, options: VideoLoadOptions, runtime: ProjectRuntime) {
    this.#ast = normalizeVideoProject(ast);
    this.options = Object.freeze({ ...options });
    this.#runtime = runtime;
  }

  static create(
    options: CreateVideoProjectOptions,
    runtimeOptions: VideoLoadOptions = {}
  ): VideoProject {
    return new VideoProject(createVideoProjectAst(options), runtimeOptions, {});
  }

  static fromAst(ast: VideoProjectAst, options: VideoLoadOptions = {}): VideoProject {
    return new VideoProject(ast, options, {});
  }

  get ast(): VideoProjectAst {
    return structuredClone(this.#ast);
  }

  get durationSeconds(): number {
    return projectDurationSeconds(this.#ast);
  }

  addTrack(options: AddProjectTrackOptions): VideoProject {
    if (this.#ast.tracks.some((track) => track.id === options.id)) {
      throw new InvalidProjectError(`Track "${options.id}" already exists.`);
    }

    const track: ProjectTrack = {
      id: options.id,
      type: options.type,
      ...(options.name ? { name: options.name } : {}),
      ...(options.muted !== undefined ? { muted: options.muted } : {}),
      ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
      ...(options.locked !== undefined ? { locked: options.locked } : {}),
      clips: options.clips ? [...options.clips] : []
    };

    return this.#with({ ...this.#ast, tracks: [...this.#ast.tracks, track] });
  }

  updateTrack(trackId: string, updates: UpdateProjectTrackOptions): VideoProject {
    let found = false;
    const tracks = this.#ast.tracks.map((track) => {
      if (track.id !== trackId) return track;
      found = true;
      return {
        ...track,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.muted !== undefined ? { muted: updates.muted } : {}),
        ...(updates.hidden !== undefined ? { hidden: updates.hidden } : {}),
        ...(updates.locked !== undefined ? { locked: updates.locked } : {})
      };
    });
    if (!found) throw new InvalidProjectError(`Track "${trackId}" was not found.`);
    return this.#with({ ...this.#ast, tracks });
  }

  moveTrack(trackId: string, toIndex: number): VideoProject {
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this.#ast.tracks.length) {
      throw new InvalidProjectError(
        `Track destination index must be an integer between 0 and ${Math.max(0, this.#ast.tracks.length - 1)}.`
      );
    }
    const fromIndex = this.#ast.tracks.findIndex((track) => track.id === trackId);
    if (fromIndex < 0) throw new InvalidProjectError(`Track "${trackId}" was not found.`);
    if (fromIndex === toIndex) return this;

    const tracks = [...this.#ast.tracks];
    const [track] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, track!);
    return this.#with({ ...this.#ast, tracks });
  }

  removeTrack(trackId: string): VideoProject {
    const existing = this.#ast.tracks.find((track) => track.id === trackId);
    if (!existing) {
      throw new InvalidProjectError(`Track "${trackId}" was not found.`);
    }
    if (existing.locked) throw new InvalidProjectError(`Track "${trackId}" is locked.`);
    return this.#with({
      ...this.#ast,
      tracks: this.#ast.tracks.filter((track) => track.id !== trackId)
    });
  }

  addClip(trackId: string, clip: TimelineClip): VideoProject {
    const index = this.#ast.tracks.findIndex((track) => track.id === trackId);
    if (index < 0) throw new InvalidProjectError(`Track "${trackId}" was not found.`);
    if (this.#ast.tracks[index]?.locked) throw new InvalidProjectError(`Track "${trackId}" is locked.`);

    const tracks = this.#ast.tracks.map((track, trackIndex) =>
      trackIndex === index ? { ...track, clips: [...track.clips, clip] } : track
    );
    return this.#with({ ...this.#ast, tracks });
  }

  removeClip(clipId: string): VideoProject {
    let found = false;
    const tracks = this.#ast.tracks.map((track) => {
      const clips = track.clips.filter((clip) => {
        if (clip.id === clipId) {
          if (track.locked) throw new InvalidProjectError(`Track "${track.id}" is locked.`);
          found = true;
          return false;
        }
        return true;
      });
      return clips.length === track.clips.length ? track : { ...track, clips };
    });
    if (!found) throw new InvalidProjectError(`Clip "${clipId}" was not found.`);
    return this.#with({ ...this.#ast, tracks });
  }

  replaceClip(clipId: string, replacement: TimelineClip): VideoProject {
    let found = false;
    const tracks = this.#ast.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (clip.id !== clipId) return clip;
        if (track.locked) throw new InvalidProjectError(`Track "${track.id}" is locked.`);
        found = true;
        return replacement;
      })
    }));
    if (!found) throw new InvalidProjectError(`Clip "${clipId}" was not found.`);
    return this.#with({ ...this.#ast, tracks });
  }

  async planRender(
    output: string,
    options: ProjectRenderOptions = {}
  ): Promise<ProjectExecutionPlan> {
    const normalizedOutput = validateOutput(output);
    const probes = await this.#probeSources(options);
    this.#validateSourceBounds(probes);
    const [fontFile, hardwareCapabilities] = await Promise.all([
      this.#resolveDefaultFontFile(),
      this.#hardwareCapabilities(options)
    ]);
    const renderAst = withDefaultTextFont(this.#ast, fontFile);
    return createProjectExecutionPlan(renderAst, normalizedOutput, options, probes, hardwareCapabilities);
  }

  async render(
    output: string,
    options: ProjectRenderOptions = {}
  ): Promise<MediaOutputResult> {
    const binaries = await this.#resolveBinaries();
    const plan = await this.planRender(output, options);
    return await runFfmpeg(binaries.ffmpeg, plan.args, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      durationSeconds: plan.durationSeconds
    });
  }

  #with(ast: VideoProjectAst): VideoProject {
    return new VideoProject(ast, this.options, this.#runtime);
  }

  #validateSourceBounds(probes: Record<string, ProbeResult | null>): void {
    for (const track of this.#ast.tracks) {
      for (const clip of track.clips) {
        if (clip.enabled === false || (clip.kind !== "video" && clip.kind !== "audio")) continue;
        const info = probes[clip.source];
        const sourceDuration = info?.durationSeconds;
        if (sourceDuration === null || sourceDuration === undefined) continue;
        const sourceStart = clip.sourceStart ?? 0;
        if (sourceStart + clip.duration > sourceDuration + 0.01) {
          throw new InvalidProjectError(
            `Clip "${clip.id}" requests ${clip.duration}s from ${sourceStart}s, but the source is only ${sourceDuration}s long.`
          );
        }
      }
    }
  }

  async #probeSources(options: ProjectRenderOptions): Promise<Record<string, ProbeResult | null>> {
    const sources = new Set<string>();
    for (const track of this.#ast.tracks) {
      for (const clip of track.clips) {
        if (clip.enabled === false) continue;
        if (clip.kind === "video" || clip.kind === "audio") sources.add(clip.source);
      }
    }

    const binaries = await this.#resolveBinaries();
    const entries = await Promise.all(
      [...sources].map(async (source) => {
        const info = await probeMedia(source, binaries.ffprobe, {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
        });
        return [source, info] as const;
      })
    );

    return Object.fromEntries(entries);
  }

  async #resolveDefaultFontFile(): Promise<string | null> {
    const hasUnresolvedText = this.#ast.tracks.some((track) =>
      track.clips.some(
        (clip) => clip.kind === "text" && clip.enabled !== false && !clip.style?.fontFile
      )
    );
    if (!hasUnresolvedText) return null;

    const fontFilePromise = this.#runtime.defaultFontFilePromise ?? resolveDefaultFontFile();
    this.#runtime.defaultFontFilePromise = fontFilePromise;
    return await fontFilePromise;
  }

  async #hardwareCapabilities(options: ProjectRenderOptions): Promise<HardwareAccelerationCapabilities | null> {
    if (!options.hardwareAcceleration || options.hardwareAcceleration === "cpu") return null;
    const binaries = await this.#resolveBinaries();
    if (!options.signal && options.timeoutMs === undefined) {
      this.#runtime.hardwareCapabilitiesPromise ??= detectHardwareAcceleration(binaries.ffmpeg);
      return await this.#runtime.hardwareCapabilitiesPromise;
    }
    return await detectHardwareAcceleration(binaries.ffmpeg, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
  }

  async #resolveBinaries(): Promise<MediaBinaries> {
    this.#runtime.binariesPromise ??= resolveMediaBinaries({
      ...(this.options.ffmpegPath ? { ffmpegPath: this.options.ffmpegPath } : {}),
      ...(this.options.ffprobePath ? { ffprobePath: this.options.ffprobePath } : {})
    });
    return await this.#runtime.binariesPromise;
  }
}

export function createProject(
  options: CreateVideoProjectOptions,
  runtimeOptions: VideoLoadOptions = {}
): VideoProject {
  return VideoProject.create(options, runtimeOptions);
}

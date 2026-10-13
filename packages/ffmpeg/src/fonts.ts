import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { InvalidProjectError, type VideoProjectAst } from "@vexa-video/core";

export interface ResolveDefaultFontFileOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface ResolveProjectFontFilesOptions extends ResolveDefaultFontFileOptions {
  /** Base directory used for relative text style fontFile paths. Defaults to process.cwd(). */
  readonly baseDirectory?: string;
  /**
   * Explicit default for text clips without style.fontFile.
   * `undefined` uses the normal Vexa platform resolver; `null` disables fallback.
   */
  readonly defaultFontFile?: string | null;
}

export class ProjectFontResolutionError extends InvalidProjectError {
  readonly clipId: string;
  readonly fontFile?: string;

  constructor(clipId: string, message: string, fontFile?: string) {
    super(`Text clip "${clipId}" ${message}`);
    this.clipId = clipId;
    if (fontFile !== undefined) this.fontFile = fontFile;
  }
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateFonts(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  if (platform === "win32") {
    const windowsDirectory = env.WINDIR?.trim() || env.SystemRoot?.trim() || "C:\\Windows";
    const localAppData = env.LOCALAPPDATA?.trim();
    return [
      join(windowsDirectory, "Fonts", "segoeui.ttf"),
      join(windowsDirectory, "Fonts", "arial.ttf"),
      join(windowsDirectory, "Fonts", "calibri.ttf"),
      ...(localAppData
        ? [
            join(localAppData, "Microsoft", "Windows", "Fonts", "segoeui.ttf"),
            join(localAppData, "Microsoft", "Windows", "Fonts", "arial.ttf")
          ]
        : [])
    ];
  }

  if (platform === "darwin") {
    return [
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
      "/System/Library/Fonts/Helvetica.ttc",
      "/Library/Fonts/Arial.ttf"
    ];
  }

  return [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    join(homedir(), ".fonts", "DejaVuSans.ttf")
  ];
}

export async function resolveDefaultFontFile(
  options: ResolveDefaultFontFileOptions = {}
): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const override = env.VEXA_VIDEO_FONT_FILE?.trim();

  if (override) {
    const resolved = isAbsolute(override) ? override : resolve(override);
    if (!(await readable(resolved))) {
      throw new InvalidProjectError(
        `VEXA_VIDEO_FONT_FILE points to a font that cannot be read: ${resolved}`
      );
    }
    return resolved;
  }

  for (const candidate of candidateFonts(platform, env)) {
    if (await readable(candidate)) return candidate;
  }

  return null;
}

/**
 * Resolve every enabled/renderable text clip and composition caption cue to
 * an absolute readable local font.
 *
 * This is deliberately Node-side: browser-safe authoring keeps fontFile as
 * serializable intent, while SDK/renderer execution waits for filesystem
 * readiness before creating an FFmpeg plan.
 */
export async function resolveProjectFontFiles(
  project: VideoProjectAst,
  options: ResolveProjectFontFilesOptions = {}
): Promise<VideoProjectAst> {
  const baseDirectory = resolve(options.baseDirectory ?? process.cwd());
  const readability = new Map<string, Promise<boolean>>();
  let defaultResolved = false;
  let defaultFontFile: string | null = null;

  const isReadable = (path: string): Promise<boolean> => {
    const existing = readability.get(path);
    if (existing) return existing;
    const pending = readable(path);
    readability.set(path, pending);
    return pending;
  };

  const resolveClipFont = async (
    clipId: string,
    requested: string,
    label: "font file" | "default font file"
  ): Promise<string> => {
    const absolute = isAbsolute(requested)
      ? resolve(requested)
      : resolve(baseDirectory, requested);
    if (!(await isReadable(absolute))) {
      throw new ProjectFontResolutionError(
        clipId,
        `${label} cannot be read: ${absolute}.`,
        absolute
      );
    }
    return absolute;
  };

  const defaultForClip = async (clipId: string): Promise<string> => {
    if (!defaultResolved) {
      defaultResolved = true;
      if (options.defaultFontFile !== undefined) {
        if (options.defaultFontFile === null) {
          defaultFontFile = null;
        } else {
          const requested = options.defaultFontFile.trim();
          if (!requested) {
            throw new ProjectFontResolutionError(
              clipId,
              "defaultFontFile cannot be empty."
            );
          }
          defaultFontFile = await resolveClipFont(clipId, requested, "default font file");
        }
      } else {
        try {
          defaultFontFile = await resolveDefaultFontFile(options);
        } catch (cause) {
          throw new ProjectFontResolutionError(
            clipId,
            `could not resolve the default font: ${cause instanceof Error ? cause.message : String(cause)}`
          );
        }
      }
    }

    if (!defaultFontFile) {
      throw new ProjectFontResolutionError(
        clipId,
        "requires a readable font file, but no platform default was found. Set style.fontFile or VEXA_VIDEO_FONT_FILE."
      );
    }
    return defaultFontFile;
  };

  let projectChanged = false;
  const tracks: VideoProjectAst["tracks"][number][] = [];
  for (const track of project.tracks) {
    if (track.hidden === true) {
      tracks.push(track);
      continue;
    }

    let trackChanged = false;
    const clips: VideoProjectAst["tracks"][number]["clips"][number][] = [];
    for (const clip of track.clips) {
      if (clip.kind !== "text" || clip.enabled === false) {
        clips.push(clip);
        continue;
      }

      if (clip.style?.remoteFont) {
        throw new ProjectFontResolutionError(
          clip.id,
          `remote font "${clip.style.remoteFont.provider}:${clip.style.remoteFont.family}" must be materialized by a renderer font adapter before FFmpeg planning.`
        );
      }

      const fontFile = clip.style?.fontFile
        ? await resolveClipFont(clip.id, clip.style.fontFile, "font file")
        : await defaultForClip(clip.id);
      if (clip.style?.fontFile === fontFile) {
        clips.push(clip);
        continue;
      }

      trackChanged = true;
      clips.push({
        ...clip,
        style: {
          ...clip.style,
          fontFile
        }
      });
    }

    if (trackChanged) {
      projectChanged = true;
      tracks.push({ ...track, clips });
    } else {
      tracks.push(track);
    }
  }

  let captions = project.captions;
  if (captions !== undefined) {
    let captionsChanged = false;
    const cues: NonNullable<VideoProjectAst["captions"]>["cues"][number][] = [];
    for (const cue of captions.cues) {
      const itemId = `caption:${cue.id}`;
      const fontFile = cue.style?.fontFile
        ? await resolveClipFont(itemId, cue.style.fontFile, "font file")
        : await defaultForClip(itemId);
      if (cue.style?.fontFile === fontFile) {
        cues.push(cue);
        continue;
      }
      captionsChanged = true;
      cues.push({
        ...cue,
        style: {
          ...cue.style,
          fontFile
        }
      });
    }
    if (captionsChanged) {
      projectChanged = true;
      captions = { ...captions, cues };
    }
  }

  return projectChanged
    ? {
        ...project,
        tracks,
        ...(captions !== undefined ? { captions } : {})
      }
    : project;
}

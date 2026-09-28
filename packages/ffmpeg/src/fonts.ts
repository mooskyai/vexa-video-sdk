import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { InvalidProjectError } from "@vexa-video/core";

export interface ResolveDefaultFontFileOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
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

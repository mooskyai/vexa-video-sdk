import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InvalidProjectError, type VideoProjectAst } from "@vexa-video/core";
import {
  ProjectFontResolutionError,
  resolveDefaultFontFile,
  resolveProjectFontFiles
} from "../src/fonts.js";

function textProject(fontFile?: string): VideoProjectAst {
  return {
    schemaVersion: 1,
    id: "fonts",
    canvas: { width: 320, height: 180, fps: 30, duration: 1 },
    tracks: [{
      id: "titles",
      type: "text",
      clips: [{
        id: "title",
        kind: "text",
        text: "Vexa",
        start: 0,
        duration: 1,
        ...(fontFile ? { style: { fontFile } } : {})
      }]
    }]
  };
}

test("resolveDefaultFontFile honors VEXA_VIDEO_FONT_FILE", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vexa-font-"));
  const font = join(directory, "test-font.ttf");

  try {
    await writeFile(font, "font-placeholder");
    assert.equal(
      await resolveDefaultFontFile({ env: { VEXA_VIDEO_FONT_FILE: font } }),
      font
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolveDefaultFontFile rejects an unreadable explicit override", async () => {
  await assert.rejects(
    () => resolveDefaultFontFile({ env: { VEXA_VIDEO_FONT_FILE: "/definitely/missing/font.ttf" } }),
    InvalidProjectError
  );
});

test("resolveProjectFontFiles waits for relative local fonts and leaves the input immutable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vexa-project-font-"));
  const fonts = join(directory, "fonts");
  const font = join(fonts, "local.ttf");
  const project = textProject(join("fonts", "local.ttf"));

  try {
    await mkdir(fonts, { recursive: true });
    await writeFile(font, "font-placeholder");
    const resolved = await resolveProjectFontFiles(project, { baseDirectory: directory });
    const clip = resolved.tracks[0]?.clips[0];
    assert.equal(clip?.kind, "text");
    assert.equal(clip?.kind === "text" ? clip.style?.fontFile : undefined, font);
    const original = project.tracks[0]?.clips[0];
    assert.equal(
      original?.kind === "text" ? original.style?.fontFile : undefined,
      join("fonts", "local.ttf")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolveProjectFontFiles injects an explicit default and fails closed when fonts are unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vexa-project-font-default-"));
  const defaultFont = join(directory, "default.ttf");

  try {
    await writeFile(defaultFont, "font-placeholder");
    const resolved = await resolveProjectFontFiles(textProject(), {
      baseDirectory: directory,
      defaultFontFile: "default.ttf"
    });
    const clip = resolved.tracks[0]?.clips[0];
    assert.equal(clip?.kind, "text");
    assert.equal(clip?.kind === "text" ? clip.style?.fontFile : undefined, defaultFont);

    await assert.rejects(
      () => resolveProjectFontFiles(textProject("missing.ttf"), {
        baseDirectory: directory,
        defaultFontFile: null
      }),
      (error: unknown) =>
        error instanceof ProjectFontResolutionError &&
        error.clipId === "title" &&
        error.fontFile === join(directory, "missing.ttf")
    );
    await assert.rejects(
      () => resolveProjectFontFiles(textProject(), {
        baseDirectory: directory,
        defaultFontFile: null
      }),
      (error: unknown) =>
        error instanceof ProjectFontResolutionError &&
        error.clipId === "title" &&
        /no platform default was found/u.test(error.message)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("resolveProjectFontFiles ignores hidden and disabled text while wrapping invalid default overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vexa-project-font-skip-"));
  const missingOverride = join(directory, "missing-default.ttf");
  const skipped: VideoProjectAst = {
    schemaVersion: 1,
    id: "font-skips",
    canvas: { width: 320, height: 180, fps: 30, duration: 1 },
    tracks: [
      {
        id: "hidden",
        type: "text",
        hidden: true,
        clips: [{
          id: "hidden-title",
          kind: "text",
          text: "Hidden",
          start: 0,
          duration: 1,
          style: { fontFile: "missing-hidden.ttf" }
        }]
      },
      {
        id: "disabled",
        type: "text",
        clips: [{
          id: "disabled-title",
          kind: "text",
          text: "Disabled",
          start: 0,
          duration: 1,
          enabled: false,
          style: { fontFile: "missing-disabled.ttf" }
        }]
      }
    ]
  };

  try {
    assert.equal(await resolveProjectFontFiles(skipped, { baseDirectory: directory }), skipped);
    await assert.rejects(
      () => resolveProjectFontFiles(textProject(), {
        env: { VEXA_VIDEO_FONT_FILE: missingOverride }
      }),
      (error: unknown) =>
        error instanceof ProjectFontResolutionError &&
        error.clipId === "title" &&
        /could not resolve the default font/u.test(error.message)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

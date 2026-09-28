import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InvalidProjectError } from "@vexa-video/core";
import { resolveDefaultFontFile } from "../src/fonts.js";

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

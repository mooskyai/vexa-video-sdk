import assert from "node:assert/strict";
import test from "node:test";
import { Captions } from "../src/captions.js";

test("Captions parses, templates and serializes subtitle documents", () => {
  const doc = Captions.parse("1\n00:00:00,000 --> 00:00:01,000\nHello\n", "srt");
  const styled = Captions.applyTemplate(doc,"headline",{ color:"yellow" });
  assert.equal(styled.cues[0]?.style?.color,"yellow");
  assert.match(Captions.stringify(styled,"vtt"),/^WEBVTT/u);
});

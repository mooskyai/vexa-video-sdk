import assert from "node:assert/strict";
import test from "node:test";
import { applyCaptionTemplate, normalizeCaptionDocument, parseAss, parseSrt, parseVtt, serializeCaptions } from "../src/captions.js";

test("SRT and WebVTT parsing normalize cues deterministically", () => {
  const srt = parseSrt("1\n00:00:01,000 --> 00:00:02,500\nHello world\n");
  assert.equal(srt.cues[0]?.start, 1);
  assert.equal(srt.cues[0]?.end, 2.5);
  const vtt = parseVtt("WEBVTT\n\na\n00:00:03.000 --> 00:00:04.000\nHi <b>there</b>\n");
  assert.equal(vtt.cues[0]?.text, "Hi there");
  assert.match(serializeCaptions(srt, "vtt"), /^WEBVTT/u);
});

test("ASS parsing extracts dialogue text", () => {
  const ass = parseAss("[Events]\nDialogue: 0,0:00:01.00,0:00:02.25,Default,,0,0,0,,{\\b1}Vexa\\NVideo");
  assert.equal(ass.cues[0]?.text, "Vexa\nVideo");
  assert.match(serializeCaptions(ass, "ass"), /Dialogue:/u);
});

test("caption templates and word timings are validated", () => {
  const doc = normalizeCaptionDocument({ schemaVersion: 1, format: "srt", cues: [{ id: "c1", start: 0, end: 2, text: "hello world", words: [{ text: "hello", start: 0, end: 0.8 }, { text: "world", start: 0.8, end: 2 }] }] });
  const styled = applyCaptionTemplate(doc, "subtitle");
  assert.equal(styled.cues[0]?.style?.position, "bottom");
  assert.equal(styled.cues[0]?.words?.length, 2);
});

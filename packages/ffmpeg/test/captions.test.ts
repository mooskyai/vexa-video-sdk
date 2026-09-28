import assert from "node:assert/strict";
import test from "node:test";
import type { CaptionDocument, ProbeResult } from "@moosky-video/core";
import { compileCaptionFilterGraph, createCaptionExecutionPlan } from "../src/captions.js";

const document: CaptionDocument = {
  schemaVersion: 1,
  format: "srt",
  cues: [
    { id: "1", start: 0.5, end: 2, text: "Hello Vexa", style: { fontSize: 40, animation: "fade" }, words: [{ text:"Hello",start:0.5,end:1 },{text:"Vexa",start:1,end:2}] }
  ]
};

const probe: ProbeResult = {
  source:"input.mp4", format:"mov,mp4,m4a,3gp,3g2,mj2", durationSeconds:3,sizeBytes:100,bitRate:1000,
  video:{index:0,codec:"h264",width:320,height:180,fps:30,pixelFormat:"yuv420p",bitRate:800,rotation:0},
  audio:{index:1,codec:"aac",sampleRate:48000,channels:2,channelLayout:"stereo",bitRate:128},videoStreams:[],audioStreams:[]
};

test("caption compiler emits explicit-font drawtext and animation markers", () => {
  const graph = compileCaptionFilterGraph(document, "C:\\Windows\\Fonts\\arial.ttf");
  assert.match(graph.expression,/drawtext=/u);
  assert.match(graph.expression,/C\\:\/Windows\/Fonts\/arial\.ttf/u);
  assert.ok(graph.optimizations.includes("WORD_LEVEL_TIMING_MODEL"));
  assert.ok(graph.optimizations.includes("ANIMATED_CAPTION_PRIMITIVES"));
});

test("caption execution plan forces video encode and preserves audio planning", () => {
  const plan = createCaptionExecutionPlan("input.mp4",[],document,"output.mp4",{},probe,"/tmp/font.ttf");
  assert.equal(plan.video?.mode,"encode");
  assert.match(plan.args.join(" "),/-vf .*drawtext=/u);
  assert.ok(plan.optimizations.includes("CAPTION_DRAW_TEXT_GRAPH"));
});

import type { CaptionDocument, CaptionStyle, ExportOptions, HardwareAccelerationCapabilities, MediaExecutionPlan, ProbeResult, VideoOperation } from "@vexa-video/core";
import { InvalidCaptionError, normalizeCaptionDocument } from "@vexa-video/core";
import { defaultVideoCodec, detectOutputContainer } from "./compatibility.js";
import { createExportExecutionPlan } from "./plan.js";

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function escapeDrawtext(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("%", "\\%");
}

function escapeFilterPath(value: string): string {
  return escapeDrawtext(value.replaceAll("\\", "/"));
}

function styleForCue(style: CaptionStyle | undefined): Required<Pick<CaptionStyle,"fontSize"|"color"|"outlineColor"|"outlineWidth"|"position"|"marginBottom"|"animation">> & CaptionStyle {
  return {
    fontSize: style?.fontSize ?? 42,
    color: style?.color ?? "white",
    outlineColor: style?.outlineColor ?? "black",
    outlineWidth: style?.outlineWidth ?? 2,
    position: style?.position ?? "bottom",
    marginBottom: style?.marginBottom ?? 48,
    animation: style?.animation ?? "none",
    ...style
  };
}

function positionExpressions(style: ReturnType<typeof styleForCue>): {x:string;y:string} {
  const x = "(w-text_w)/2";
  if (style.position === "top") return { x, y: formatNumber(style.marginBottom) };
  if (style.position === "center") return { x, y: "(h-text_h)/2" };
  return { x, y: `h-text_h-${formatNumber(style.marginBottom)}` };
}

function alphaExpression(start: number, end: number, animation: CaptionStyle["animation"]): string | null {
  if (animation === "fade") {
    const fade = Math.min(0.2, Math.max(0.05, (end-start)/4));
    return `if(lt(t,${formatNumber(start+fade)}),(t-${formatNumber(start)})/${formatNumber(fade)},if(gt(t,${formatNumber(end-fade)}),(${formatNumber(end)}-t)/${formatNumber(fade)},1))`;
  }
  if (animation === "pop") {
    const span = Math.min(0.18, Math.max(0.05,(end-start)/4));
    return `min(1,max(0,(t-${formatNumber(start)})/${formatNumber(span)}))`;
  }
  return null;
}

export interface CompiledCaptionGraph {
  filters: readonly string[];
  expression: string;
  optimizations: readonly string[];
}

export function compileCaptionFilterGraph(document: CaptionDocument, defaultFontFile: string | null = null): CompiledCaptionGraph {
  const normalized = normalizeCaptionDocument(document);
  if (normalized.cues.length === 0) throw new InvalidCaptionError("Caption document does not contain any cues.");
  const filters: string[] = [];
  const optimizations = ["CAPTION_DRAW_TEXT_GRAPH"];
  if (normalized.cues.some(cue => cue.words?.length)) optimizations.push("WORD_LEVEL_TIMING_MODEL");
  if (normalized.cues.some(cue => (cue.style?.animation ?? "none") !== "none")) optimizations.push("ANIMATED_CAPTION_PRIMITIVES");

  for (const cue of normalized.cues) {
    const style = styleForCue(cue.style);
    const fontFile = style.fontFile ?? defaultFontFile;
    if (!fontFile) {
      throw new InvalidCaptionError(
        `Caption cue "${cue.id}" requires an explicit readable font file on this platform. Set style.fontFile or VEXA_VIDEO_FONT_FILE.`
      );
    }
    const position = positionExpressions(style);
    const parts = [
      `drawtext=text='${escapeDrawtext(cue.text.replace(/\n/gu," "))}'`,
      `fontfile='${escapeFilterPath(fontFile)}'`,
      `fontsize=${formatNumber(style.fontSize)}`,
      `fontcolor=${escapeDrawtext(style.color)}`,
      `x='${position.x}'`,
      `y='${position.y}'`,
      `enable='between(t,${formatNumber(cue.start)},${formatNumber(cue.end)})'`
    ];
    if (style.bold) parts.push("borderw=1");
    if (style.outlineWidth > 0) {
      parts.push(`borderw=${formatNumber(style.outlineWidth)}`, `bordercolor=${escapeDrawtext(style.outlineColor)}`);
    }
    if (style.backgroundColor) {
      parts.push("box=1", `boxcolor=${escapeDrawtext(style.backgroundColor)}`, "boxborderw=12");
    }
    const alpha = alphaExpression(cue.start,cue.end,style.animation);
    if (alpha) parts.push(`alpha='${alpha}'`);
    filters.push(parts.join(":"));
  }
  return { filters, expression: filters.join(","), optimizations };
}

export function createCaptionExecutionPlan(
  source: string,
  operations: readonly VideoOperation[],
  captions: CaptionDocument,
  output: string,
  options: ExportOptions = {},
  probe: ProbeResult | null = null,
  defaultFontFile: string | null = null,
  hardwareCapabilities: HardwareAccelerationCapabilities | null = null
): MediaExecutionPlan {
  if (probe && !probe.video) throw new InvalidCaptionError("Caption burn-in requires a video stream.");
  const container = detectOutputContainer(output);
  if (options.videoCodec === "copy") throw new InvalidCaptionError('videoCodec "copy" cannot be used when burning captions.');
  const selectedVideoCodec = options.videoCodec ?? defaultVideoCodec(container);
  const forcedOptions: ExportOptions = {
    ...options,
    videoCodec: selectedVideoCodec
  };
  const base = createExportExecutionPlan(source, operations, output, forcedOptions, probe, hardwareCapabilities);
  const captionsGraph = compileCaptionFilterGraph(captions, defaultFontFile);
  const args = [...base.args];
  const vfIndex = args.indexOf("-vf");
  if (vfIndex >= 0) {
    args[vfIndex+1] = `${args[vfIndex+1]},${captionsGraph.expression}`;
  } else {
    const codecIndex = args.indexOf("-c:v");
    const insertAt = codecIndex >= 0 ? codecIndex : Math.max(0,args.length-1);
    args.splice(insertAt,0,"-vf",captionsGraph.expression);
  }
  return {
    ...base,
    args,
    filters: [...base.filters, ...captionsGraph.filters],
    optimizations: [...base.optimizations.filter(item => item !== "VIDEO_STREAM_COPY"), ...captionsGraph.optimizations]
  };
}

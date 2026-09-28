import { InvalidCaptionError } from "./errors.js";

export type CaptionFormat = "srt" | "vtt" | "ass";
export type CaptionAnimation = "none" | "fade" | "pop";
export type CaptionPosition = "top" | "center" | "bottom";

export interface CaptionWordTiming {
  text: string;
  start: number;
  end: number;
}

export interface CaptionStyle {
  fontFile?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  bold?: boolean;
  italic?: boolean;
  position?: CaptionPosition;
  marginBottom?: number;
  animation?: CaptionAnimation;
}

export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: readonly CaptionWordTiming[];
  style?: CaptionStyle;
}

export interface CaptionDocument {
  schemaVersion: 1;
  format: CaptionFormat;
  language?: string;
  cues: readonly CaptionCue[];
}

export type CaptionTemplateName = "subtitle" | "headline" | "minimal";

const templates: Record<CaptionTemplateName, CaptionStyle> = {
  subtitle: {
    fontSize: 42,
    color: "white",
    backgroundColor: "black@0.55",
    outlineColor: "black",
    outlineWidth: 2,
    position: "bottom",
    marginBottom: 48,
    animation: "fade"
  },
  headline: {
    fontSize: 64,
    color: "white",
    outlineColor: "black",
    outlineWidth: 3,
    position: "center",
    animation: "pop",
    bold: true
  },
  minimal: {
    fontSize: 38,
    color: "white",
    position: "bottom",
    marginBottom: 36,
    animation: "none"
  }
};

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new InvalidCaptionError(`${label} must be a finite non-negative number.`);
}

function parseTimestamp(value: string): number {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{3})$/u.exec(value.trim());
  if (!match) throw new InvalidCaptionError(`Invalid caption timestamp: ${value}`);
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatTimestamp(seconds: number, separator = ","): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}${separator}${String(millis).padStart(3,"0")}`;
}

function normalizeCue(cue: CaptionCue, index: number): CaptionCue {
  if (!cue.id.trim()) throw new InvalidCaptionError(`Caption cue ${index + 1} requires a non-empty id.`);
  finiteNonNegative(cue.start, `caption ${cue.id}.start`);
  finiteNonNegative(cue.end, `caption ${cue.id}.end`);
  if (cue.end <= cue.start) throw new InvalidCaptionError(`Caption cue "${cue.id}" must end after it starts.`);
  if (!cue.text.trim()) throw new InvalidCaptionError(`Caption cue "${cue.id}" requires text.`);
  const words = cue.words?.map((word, wordIndex) => {
    if (!word.text.trim()) throw new InvalidCaptionError(`Caption cue "${cue.id}" word ${wordIndex + 1} requires text.`);
    finiteNonNegative(word.start, `caption ${cue.id}.words[${wordIndex}].start`);
    finiteNonNegative(word.end, `caption ${cue.id}.words[${wordIndex}].end`);
    if (word.end <= word.start) throw new InvalidCaptionError(`Caption cue "${cue.id}" word ${wordIndex + 1} must end after it starts.`);
    if (word.start < cue.start - 1e-6 || word.end > cue.end + 1e-6) {
      throw new InvalidCaptionError(`Caption cue "${cue.id}" word timing must stay inside the cue interval.`);
    }
    return { ...word };
  });
  if (words) words.sort((a,b)=>a.start-b.start);
  const style = cue.style ? { ...cue.style } : undefined;
  if (style?.fontSize !== undefined && (!Number.isFinite(style.fontSize) || style.fontSize <= 0)) throw new InvalidCaptionError(`Caption cue "${cue.id}" fontSize must be greater than 0.`);
  if (style?.outlineWidth !== undefined && (!Number.isFinite(style.outlineWidth) || style.outlineWidth < 0)) throw new InvalidCaptionError(`Caption cue "${cue.id}" outlineWidth must be non-negative.`);
  return { ...cue, text: cue.text.trim(), ...(words ? { words } : {}), ...(style ? { style } : {}) };
}

export function normalizeCaptionDocument(document: CaptionDocument): CaptionDocument {
  if (document.schemaVersion !== 1) throw new InvalidCaptionError(`Unsupported caption schema version: ${String(document.schemaVersion)}.`);
  const ids = new Set<string>();
  const cues = document.cues.map((cue,index)=>{
    const normalized = normalizeCue(cue,index);
    if (ids.has(normalized.id)) throw new InvalidCaptionError(`Duplicate caption cue id: ${normalized.id}.`);
    ids.add(normalized.id);
    return normalized;
  }).sort((a,b)=>a.start-b.start || a.end-b.end || a.id.localeCompare(b.id));
  return { schemaVersion: 1, format: document.format, ...(document.language ? { language: document.language } : {}), cues };
}

export function captionTemplate(name: CaptionTemplateName, overrides: CaptionStyle = {}): CaptionStyle {
  return { ...templates[name], ...overrides };
}

export function applyCaptionTemplate(document: CaptionDocument, name: CaptionTemplateName, overrides: CaptionStyle = {}): CaptionDocument {
  const style = captionTemplate(name, overrides);
  return normalizeCaptionDocument({
    ...document,
    cues: document.cues.map(cue => ({ ...cue, style: { ...style, ...cue.style } }))
  });
}

export function parseSrt(content: string): CaptionDocument {
  const blocks = content.replace(/\r\n/g,"\n").trim().split(/\n{2,}/u).filter(Boolean);
  const cues: CaptionCue[] = [];
  for (let i=0;i<blocks.length;i+=1) {
    const lines = blocks[i]!.split("\n");
    const maybeId = lines[0]!.trim();
    const timingIndex = maybeId.includes("-->") ? 0 : 1;
    const timing = lines[timingIndex];
    if (!timing) continue;
    const match = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/u.exec(timing);
    if (!match) throw new InvalidCaptionError(`Invalid SRT timing line: ${timing}`);
    cues.push({
      id: timingIndex === 1 ? maybeId || String(i+1) : String(i+1),
      start: parseTimestamp(match[1]!),
      end: parseTimestamp(match[2]!),
      text: lines.slice(timingIndex+1).join("\n").trim()
    });
  }
  return normalizeCaptionDocument({ schemaVersion: 1, format: "srt", cues });
}

export function parseVtt(content: string): CaptionDocument {
  const clean = content.replace(/^\uFEFF/u,"").replace(/\r\n/g,"\n").trim();
  const body = clean.replace(/^WEBVTT[^\n]*\n*/u,"");
  const blocks = body.split(/\n{2,}/u).filter(block => block.trim() && !block.trim().startsWith("NOTE"));
  const cues: CaptionCue[] = [];
  for (let i=0;i<blocks.length;i+=1) {
    const lines = blocks[i]!.split("\n");
    const timingIndex = lines[0]!.includes("-->") ? 0 : 1;
    const timing = lines[timingIndex];
    if (!timing) continue;
    const match = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/u.exec(timing);
    if (!match) throw new InvalidCaptionError(`Invalid WebVTT timing line: ${timing}`);
    cues.push({
      id: timingIndex === 1 ? lines[0]!.trim() || String(i+1) : String(i+1),
      start: parseTimestamp(match[1]!.replace(".",",")),
      end: parseTimestamp(match[2]!.split(/\s/u)[0]!.replace(".",",")),
      text: lines.slice(timingIndex+1).join("\n").replace(/<[^>]+>/gu,"").trim()
    });
  }
  return normalizeCaptionDocument({ schemaVersion: 1, format: "vtt", cues });
}

function assTimestamp(value: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/u.exec(value.trim());
  if (!match) throw new InvalidCaptionError(`Invalid ASS timestamp: ${value}`);
  return Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) + Number(match[4])/100;
}

export function parseAss(content: string): CaptionDocument {
  const cues: CaptionCue[] = [];
  const lines = content.replace(/\r\n/g,"\n").split("\n");
  let index = 1;
  for (const line of lines) {
    if (!/^Dialogue:/iu.test(line)) continue;
    const payload = line.replace(/^Dialogue:\s*/iu,"");
    const parts = payload.split(",");
    if (parts.length < 10) continue;
    const start = assTimestamp(parts[1]!);
    const end = assTimestamp(parts[2]!);
    const text = parts.slice(9).join(",").replace(/\{[^}]*\}/gu,"").replace(/\\N/gu,"\n").trim();
    cues.push({ id: String(index++), start, end, text });
  }
  return normalizeCaptionDocument({ schemaVersion: 1, format: "ass", cues });
}

export function parseCaptions(content: string, format: CaptionFormat): CaptionDocument {
  if (format === "srt") return parseSrt(content);
  if (format === "vtt") return parseVtt(content);
  return parseAss(content);
}

export function toSrt(document: CaptionDocument): string {
  const normalized = normalizeCaptionDocument(document);
  return normalized.cues.map((cue,index)=>`${index+1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}\n`).join("\n");
}

export function toVtt(document: CaptionDocument): string {
  const normalized = normalizeCaptionDocument(document);
  return `WEBVTT\n\n${normalized.cues.map(cue=>`${cue.id}\n${formatTimestamp(cue.start,".")} --> ${formatTimestamp(cue.end,".")}\n${cue.text}\n`).join("\n")}`;
}

function assTime(seconds: number): string {
  const centis = Math.max(0,Math.round(seconds*100));
  const h = Math.floor(centis/360000);
  const m = Math.floor((centis%360000)/6000);
  const s = Math.floor((centis%6000)/100);
  const cs = centis%100;
  return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}

export function toAss(document: CaptionDocument): string {
  const normalized = normalizeCaptionDocument(document);
  const header = `[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,42,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = normalized.cues.map(cue=>`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text.replace(/\n/gu,"\\N")}`).join("\n");
  return `${header}${events}\n`;
}

export function serializeCaptions(document: CaptionDocument, format: CaptionFormat = document.format): string {
  if (format === "srt") return toSrt(document);
  if (format === "vtt") return toVtt(document);
  return toAss(document);
}

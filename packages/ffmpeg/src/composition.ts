import type {
  AudioCodec,
  HardwareAccelerationCapabilities,
  ProjectExecutionPlan,
  ProjectInputDescriptor,
  ProjectRenderOptions,
  ProjectTrack,
  TimelineClip,
  NumericProperty,
  VideoCodec,
  VideoProjectAst,
  ProbeResult
} from "@vexa-video/core";
import {
  IncompatibleOutputError,
  InvalidProjectError,
  normalizeVideoProject,
  numericPropertyHasKeyframes,
  numericPropertyValue,
  projectDurationSeconds
} from "@vexa-video/core";
import {
  assertAudioCodecCompatible,
  assertVideoCodecCompatible,
  defaultAudioCodec,
  defaultVideoCodec,
  detectOutputContainer
} from "./compatibility.js";
import { appendVideoEncoderOptions, hardwareOptimizationMarkers, resolveHardwareAcceleration } from "./hardware.js";

const AUDIO_CODECS: Record<Exclude<AudioCodec, "copy" | "none">, string> = {
  aac: "aac",
  opus: "libopus",
  mp3: "libmp3lame"
};

export type ProjectProbeMap = Readonly<Record<string, ProbeResult | null | undefined>>;

interface IndexedClip {
  track: ProjectTrack;
  clip: TimelineClip;
  inputIndex: number | null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function filterSafeToken(value: string, label: string): string {
  if (!/^[a-zA-Z0-9#@._-]+$/u.test(value)) {
    throw new InvalidProjectError(`${label} contains characters that are not supported by the current FFmpeg compiler.`);
  }
  return value;
}

function escapeDrawtext(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function escapeFilterPath(value: string): string {
  return escapeDrawtext(value.replaceAll("\\", "/"));
}

function normalizedRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function easingExpression(progress: string, easing: string): string {
  switch (easing) {
    case "hold":
      return "0";
    case "ease-in":
      return `((${progress})*(${progress}))`;
    case "ease-out":
      return `(1-(1-(${progress}))*(1-(${progress})))`;
    case "ease-in-out":
      return `if(lt((${progress}),0.5),2*(${progress})*(${progress}),1-((-2*(${progress})+2)*(-2*(${progress})+2))/2)`;
    case "linear":
    default:
      return progress;
  }
}

function numericPropertyExpression(
  property: NumericProperty | undefined,
  fallback: number,
  timeExpression: string,
  label: string
): string {
  if (property === undefined || typeof property === "number" || !property.keyframes?.length) {
    return formatNumber(numericPropertyValue(property, fallback, label));
  }

  let previousTime = 0;
  let previousValue = property.value;
  const segments: string[] = [];

  for (const keyframe of property.keyframes) {
    const span = keyframe.time - previousTime;
    let valueExpression = formatNumber(previousValue);
    if (span > 0 && keyframe.easing !== "hold") {
      const progress = `((${timeExpression})-${formatNumber(previousTime)})/${formatNumber(span)}`;
      const eased = easingExpression(progress, keyframe.easing ?? "linear");
      valueExpression = `(${formatNumber(previousValue)}+(${formatNumber(keyframe.value - previousValue)})*(${eased}))`;
    }
    segments.push(`if(lt(${timeExpression},${formatNumber(keyframe.time)}),${valueExpression},`);
    previousTime = keyframe.time;
    previousValue = keyframe.value;
  }

  return `${segments.join("")}${formatNumber(previousValue)}${")".repeat(segments.length)}`;
}

function quotedExpression(expression: string): string {
  return `'${expression}'`;
}

function hasAnimatedVisualProperty(clip: Extract<TimelineClip, { kind: "video" | "image" }>): boolean {
  return Boolean(
    numericPropertyHasKeyframes(clip.transform?.x) ||
    numericPropertyHasKeyframes(clip.transform?.y) ||
    numericPropertyHasKeyframes(clip.transform?.width) ||
    numericPropertyHasKeyframes(clip.transform?.height) ||
    numericPropertyHasKeyframes(clip.transform?.rotation) ||
    numericPropertyHasKeyframes(clip.opacity)
  );
}

function fullCanvasTransitionEligible(
  clip: Extract<TimelineClip, { kind: "video" }>,
  canvas: VideoProjectAst["canvas"]
): boolean {
  const transform = clip.transform;
  if (hasAnimatedVisualProperty(clip)) return false;
  if ((clip.blendMode ?? "normal") !== "normal") return false;
  if (numericPropertyValue(clip.opacity, 1, `clip ${clip.id}.opacity`) !== 1) return false;
  if (transform?.x !== undefined || transform?.y !== undefined || transform?.rotation !== undefined) return false;
  const width = transform?.width === undefined
    ? canvas.width
    : numericPropertyValue(transform.width, canvas.width, `clip ${clip.id}.transform.width`);
  const height = transform?.height === undefined
    ? canvas.height
    : numericPropertyValue(transform.height, canvas.height, `clip ${clip.id}.transform.height`);
  return width === canvas.width && height === canvas.height;
}

function xfadeTransitionName(type: string): string | null {
  switch (type) {
    case "crossfade": return "fade";
    case "wipe-left": return "wipeleft";
    case "wipe-right": return "wiperight";
    default: return null;
  }
}

function blendModeName(mode: string): string {
  return mode;
}

function transitionDuration(clip: TimelineClip, edge: "in" | "out"): number {
  return clip.transitions?.[edge]?.duration ?? 0;
}

function clipVisualFilters(
  clip: Extract<TimelineClip, { kind: "video" | "image" }>,
  canvas: VideoProjectAst["canvas"]
): string[] {
  const filters: string[] = [];
  const transform = clip.transform;
  const widthAnimated = numericPropertyHasKeyframes(transform?.width);
  const heightAnimated = numericPropertyHasKeyframes(transform?.height);
  const targetWidth = numericPropertyExpression(
    transform?.width,
    canvas.width,
    "t",
    `clip ${clip.id}.transform.width`
  );
  const targetHeight = numericPropertyExpression(
    transform?.height,
    canvas.height,
    "t",
    `clip ${clip.id}.transform.height`
  );
  const fit = transform?.fit ?? "contain";
  const scaleEval = widthAnimated || heightAnimated ? ":eval=frame" : "";

  if ((clip.blendMode ?? "normal") !== "normal") {
    filters.push(
      `scale=${quotedExpression(targetWidth)}:${quotedExpression(targetHeight)}${scaleEval}`,
      `pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
    );
  } else if (fit === "fill") {
    filters.push(`scale=${quotedExpression(targetWidth)}:${quotedExpression(targetHeight)}${scaleEval}`);
  } else if (fit === "cover") {
    if (widthAnimated || heightAnimated) {
      filters.push(
        `scale=${quotedExpression(targetWidth)}:${quotedExpression(targetHeight)}${scaleEval}`
      );
    } else {
      filters.push(
        `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`,
        `crop=${targetWidth}:${targetHeight}`
      );
    }
  } else if (widthAnimated || heightAnimated) {
    filters.push(
      `scale=${quotedExpression(targetWidth)}:${quotedExpression(targetHeight)}${scaleEval}`
    );
  } else {
    filters.push(
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`
    );
  }

  const rotationProperty = transform?.rotation;
  if (numericPropertyHasKeyframes(rotationProperty)) {
    const rotationExpression = numericPropertyExpression(
      rotationProperty,
      0,
      "t",
      `clip ${clip.id}.transform.rotation`
    );
    filters.push(
      `rotate=${quotedExpression(`(${rotationExpression})*PI/180`)}:ow=iw:oh=ih:c=black@0`
    );
  } else {
    const rotation = normalizedRotation(
      rotationProperty === undefined
        ? 0
        : numericPropertyValue(rotationProperty, 0, `clip ${clip.id}.transform.rotation`)
    );
    if (rotation === 90) filters.push("transpose=clock");
    else if (rotation === 180) filters.push("hflip", "vflip");
    else if (rotation === 270) filters.push("transpose=cclock");
    else if (rotation !== 0) {
      const angle = formatNumber(rotation);
      filters.push(
        `rotate=${angle}*PI/180:ow=rotw(${angle}*PI/180):oh=roth(${angle}*PI/180):c=black@0`
      );
    }
  }

  filters.push("format=rgba");

  if (numericPropertyHasKeyframes(clip.opacity)) {
    const opacityExpression = numericPropertyExpression(
      clip.opacity,
      1,
      "T",
      `clip ${clip.id}.opacity`
    );
    filters.push(
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityExpression})'`
    );
  } else {
    const opacity = numericPropertyValue(clip.opacity, 1, `clip ${clip.id}.opacity`);
    if (opacity < 1) filters.push(`colorchannelmixer=aa=${formatNumber(opacity)}`);
  }

  const fadeIn = transitionDuration(clip, "in");
  if (fadeIn > 0 && clip.transitions?.in?.type === "fade") {
    filters.push(`fade=t=in:st=0:d=${formatNumber(fadeIn)}:alpha=1`);
  }
  const fadeOut = transitionDuration(clip, "out");
  if (fadeOut > 0 && clip.transitions?.out?.type === "fade") {
    filters.push(
      `fade=t=out:st=${formatNumber(Math.max(0, clip.duration - fadeOut))}:d=${formatNumber(fadeOut)}:alpha=1`
    );
  }

  return filters;
}

function clipPosition(
  clip: Extract<TimelineClip, { kind: "video" | "image" }>
): { x: string; y: string } {
  const localTime = `(t-${formatNumber(clip.start)})`;
  const x = clip.transform?.x === undefined
    ? "(W-w)/2"
    : numericPropertyExpression(
        clip.transform.x,
        0,
        localTime,
        `clip ${clip.id}.transform.x`
      );
  const y = clip.transform?.y === undefined
    ? "(H-h)/2"
    : numericPropertyExpression(
        clip.transform.y,
        0,
        localTime,
        `clip ${clip.id}.transform.y`
      );
  return { x, y };
}

function buildInputArgs(
  project: VideoProjectAst,
  indexed: IndexedClip[],
  inputs: ProjectInputDescriptor[]
): string[] {
  const args: string[] = [];
  let index = 0;

  for (const item of indexed) {
    const { clip } = item;
    if (clip.kind === "text" || clip.enabled === false) {
      item.inputIndex = null;
      continue;
    }

    item.inputIndex = index;
    inputs.push({ index, clipId: clip.id, kind: clip.kind, source: clip.source });

    if (clip.kind === "image") {
      args.push("-loop", "1", "-framerate", formatNumber(project.canvas.fps), "-i", clip.source);
    } else {
      args.push("-i", clip.source);
    }
    index += 1;
  }

  return args;
}

function videoClipFilter(
  item: IndexedClip,
  project: VideoProjectAst,
  label: string
): string {
  const clip = item.clip;
  if (clip.kind !== "video" && clip.kind !== "image") {
    throw new InvalidProjectError(`Clip ${clip.id} is not visual media.`);
  }
  if (item.inputIndex === null) throw new InvalidProjectError(`Clip ${clip.id} has no FFmpeg input.`);

  const filters: string[] = [];
  if (clip.kind === "video") {
    filters.push(
      `trim=start=${formatNumber(clip.sourceStart ?? 0)}:duration=${formatNumber(clip.duration)}`,
      "setpts=PTS-STARTPTS"
    );
  } else {
    filters.push(`trim=duration=${formatNumber(clip.duration)}`, "setpts=PTS-STARTPTS");
  }

  filters.push(...clipVisualFilters(clip, project.canvas));
  filters.push(`setpts=PTS-STARTPTS+${formatNumber(clip.start)}/TB`);
  return `[${item.inputIndex}:v]${filters.join(",")}[${label}]`;
}

function textFilter(
  inputLabel: string,
  outputLabel: string,
  clip: Extract<TimelineClip, { kind: "text" }>
): string {
  const style = clip.style ?? {};
  const localTime = `(t-${formatNumber(clip.start)})`;
  const fontSize = numericPropertyExpression(
    style.fontSize,
    48,
    localTime,
    `clip ${clip.id}.style.fontSize`
  );
  const opacityExpression = numericPropertyExpression(
    clip.opacity,
    1,
    localTime,
    `clip ${clip.id}.opacity`
  );
  const opacity = numericPropertyValue(clip.opacity, 1, `clip ${clip.id}.opacity`);
  const x = clip.transform?.x === undefined
    ? "(w-text_w)/2"
    : numericPropertyExpression(
        clip.transform.x,
        0,
        localTime,
        `clip ${clip.id}.transform.x`
      );
  const y = clip.transform?.y === undefined
    ? "(h-text_h)/2"
    : numericPropertyExpression(
        clip.transform.y,
        0,
        localTime,
        `clip ${clip.id}.transform.y`
      );
  const start = formatNumber(clip.start);
  const end = formatNumber(clip.start + clip.duration);
  const color = filterSafeToken(style.color ?? "white", `clip ${clip.id}.style.color`);
  const options = [
    `text='${escapeDrawtext(clip.text)}'`,
    "expansion=none",
    `fontsize=${quotedExpression(fontSize)}`,
    `fontcolor=${color}`,
    `alpha=${quotedExpression(opacityExpression)}`,
    `x=${quotedExpression(x)}`,
    `y=${quotedExpression(y)}`,
    `enable='between(t,${start},${end})'`
  ];

  if (style.fontFile) options.push(`fontfile='${escapeFilterPath(style.fontFile)}'`);
  if (style.boxColor) {
    const box = filterSafeToken(style.boxColor, `clip ${clip.id}.style.boxColor`);
    options.push("box=1", `boxcolor=${box}`, `boxborderw=${formatNumber(style.boxPadding ?? 8)}`);
  }

  return `[${inputLabel}]drawtext=${options.join(":")}[${outputLabel}]`;
}

function transitionChainForTrack(
  track: ProjectTrack,
  items: IndexedClip[],
  project: VideoProjectAst,
  filters: string[]
): { label: string; start: number; end: number } | null {
  const clips = items
    .filter((item) =>
      item.track.id === track.id &&
      item.clip.kind === "video" &&
      item.clip.enabled !== false
    )
    .sort((a, b) => a.clip.start - b.clip.start);

  if (clips.length < 2) return null;
  if (clips.some((item) =>
    item.clip.kind !== "video" ||
    !fullCanvasTransitionEligible(item.clip, project.canvas)
  )) return null;

  for (let index = 1; index < clips.length; index += 1) {
    const previous = clips[index - 1]!.clip as Extract<TimelineClip, { kind: "video" }>;
    const current = clips[index]!.clip as Extract<TimelineClip, { kind: "video" }>;
    const transition = current.transitions?.in;
    if (!transition || !xfadeTransitionName(transition.type)) return null;
    const expectedStart = previous.start + previous.duration - transition.duration;
    if (Math.abs(current.start - expectedStart) > 0.02) return null;
  }

  const first = clips[0]!;
  if (first.inputIndex === null) return null;
  const firstClip = first.clip as Extract<TimelineClip, { kind: "video" }>;
  const firstLabel = `xclip_${track.id}_0`.replace(/[^a-zA-Z0-9_]/gu, "_");
  const firstFilters = [
    `trim=start=${formatNumber(firstClip.sourceStart ?? 0)}:duration=${formatNumber(firstClip.duration)}`,
    "setpts=PTS-STARTPTS",
    `scale=${project.canvas.width}:${project.canvas.height}:force_original_aspect_ratio=increase`,
    `crop=${project.canvas.width}:${project.canvas.height}`,
    `fps=${formatNumber(project.canvas.fps)}`,
    "format=yuv420p"
  ];
  filters.push(`[${first.inputIndex}:v]${firstFilters.join(",")}[${firstLabel}]`);

  let currentLabel = firstLabel;
  for (let index = 1; index < clips.length; index += 1) {
    const item = clips[index]!;
    const clip = item.clip as Extract<TimelineClip, { kind: "video" }>;
    if (item.inputIndex === null) return null;
    const prepared = `xclip_${track.id}_${index}`.replace(/[^a-zA-Z0-9_]/gu, "_");
    filters.push(
      `[${item.inputIndex}:v]trim=start=${formatNumber(clip.sourceStart ?? 0)}:duration=${formatNumber(clip.duration)},setpts=PTS-STARTPTS,scale=${project.canvas.width}:${project.canvas.height}:force_original_aspect_ratio=increase,crop=${project.canvas.width}:${project.canvas.height},fps=${formatNumber(project.canvas.fps)},format=yuv420p[${prepared}]`
    );
    const transition = clip.transitions!.in!;
    const nextLabel = `xfade_${track.id}_${index}`.replace(/[^a-zA-Z0-9_]/gu, "_");
    filters.push(
      `[${currentLabel}][${prepared}]xfade=transition=${xfadeTransitionName(transition.type)}:duration=${formatNumber(transition.duration)}:offset=${formatNumber(clip.start - firstClip.start)}[${nextLabel}]`
    );
    currentLabel = nextLabel;
  }

  const last = clips.at(-1)!.clip;
  return {
    label: currentLabel,
    start: firstClip.start,
    end: last.start + last.duration
  };
}

function compileVisualGraph(project: VideoProjectAst, indexed: IndexedClip[]): {
  filters: string[];
  outputLabel: string;
  optimizations: string[];
} {
  const filters: string[] = [];
  const optimizations: string[] = [];
  const duration = projectDurationSeconds(project);
  const background = filterSafeToken(project.canvas.background ?? "black", "project.canvas.background");
  filters.push(
    `color=c=${background}:s=${project.canvas.width}x${project.canvas.height}:r=${formatNumber(project.canvas.fps)}:d=${formatNumber(duration)},format=rgba[base0]`
  );

  let current = "base0";
  let visualIndex = 0;
  const handled = new Set<string>();

  for (const track of project.tracks) {
    if (track.hidden) continue;

    if (track.type === "video") {
      const chain = transitionChainForTrack(track, indexed, project, filters);
      if (chain) {
        const shifted = `xtrack${visualIndex}`;
        filters.push(
          `[${chain.label}]setpts=PTS+${formatNumber(chain.start)}/TB,format=rgba[${shifted}]`
        );
        const next = `base${visualIndex + 1}`;
        filters.push(
          `[${current}][${shifted}]overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto:enable='between(t,${formatNumber(chain.start)},${formatNumber(chain.end)})'[${next}]`
        );
        for (const item of indexed) {
          if (item.track.id === track.id && item.clip.kind === "video" && item.clip.enabled !== false) {
            handled.add(item.clip.id);
          }
        }
        current = next;
        visualIndex += 1;
        optimizations.push("VIDEO_XFADE_GRAPH");
      }
    }

    for (const item of indexed) {
      const { clip } = item;
      if (item.track.id !== track.id || handled.has(clip.id)) continue;
      if (clip.enabled === false || clip.kind === "audio") continue;

      if (clip.kind === "text") {
        const next = `base${visualIndex + 1}`;
        filters.push(textFilter(current, next, clip));
        if (
          numericPropertyHasKeyframes(clip.transform?.x) ||
          numericPropertyHasKeyframes(clip.transform?.y) ||
          numericPropertyHasKeyframes(clip.style?.fontSize)
        ) {
          optimizations.push("KEYFRAME_EXPRESSION_GRAPH");
        }
        current = next;
        visualIndex += 1;
        continue;
      }

      const advancedTransition = clip.transitions?.in;
      if (advancedTransition && advancedTransition.type !== "fade") {
        throw new InvalidProjectError(
          `Clip "${clip.id}" uses ${advancedTransition.type}, but advanced video transitions currently require a contiguous full-canvas video track with the transition on each incoming clip.`
        );
      }
      if (clip.transitions?.out && clip.transitions.out.type !== "fade") {
        throw new InvalidProjectError(
          `Clip "${clip.id}" uses an advanced outgoing transition. Put crossfade/wipe on the incoming clip instead.`
        );
      }

      const clipLabel = `vclip${visualIndex}`;
      filters.push(videoClipFilter(item, project, clipLabel));
      const next = `base${visualIndex + 1}`;
      const start = formatNumber(clip.start);
      const end = formatNumber(clip.start + clip.duration);
      const blendMode = clip.blendMode ?? "normal";

      if (blendMode !== "normal") {
        if (clip.transform?.x !== undefined || clip.transform?.y !== undefined) {
          throw new InvalidProjectError(
            `Clip "${clip.id}" uses blendMode "${blendMode}" with x/y positioning. Non-normal blend modes currently require full-canvas alignment.`
          );
        }
        filters.push(
          `[${current}][${clipLabel}]blend=all_mode=${blendModeName(blendMode)}:enable='between(t,${start},${end})'[${next}]`
        );
        optimizations.push("BLEND_MODE_GRAPH");
      } else {
        const { x, y } = clipPosition(clip);
        filters.push(
          `[${current}][${clipLabel}]overlay=x=${quotedExpression(x)}:y=${quotedExpression(y)}:eof_action=pass:shortest=0:format=auto:enable='between(t,${start},${end})'[${next}]`
        );
      }

      if (hasAnimatedVisualProperty(clip)) optimizations.push("KEYFRAME_EXPRESSION_GRAPH");
      current = next;
      visualIndex += 1;
    }
  }

  filters.push(
    `[${current}]fps=${formatNumber(project.canvas.fps)},format=yuv420p[vout]`
  );

  return {
    filters,
    outputLabel: "vout",
    optimizations: [...new Set(optimizations)]
  };
}

function effectiveAudioFadeDuration(
  item: IndexedClip,
  indexed: IndexedClip[],
  edge: "in" | "out"
): number {
  const transition = item.clip.transitions?.[edge];
  if (transition) return transition.duration;
  if (edge !== "out") return 0;

  const siblings = indexed
    .filter((candidate) =>
      candidate.track.id === item.track.id &&
      candidate.clip.enabled !== false &&
      (candidate.clip.kind === "video" || candidate.clip.kind === "audio")
    )
    .sort((a, b) => a.clip.start - b.clip.start);
  const position = siblings.findIndex((candidate) => candidate.clip.id === item.clip.id);
  const next = position >= 0 ? siblings[position + 1] : undefined;
  const incoming = next?.clip.transitions?.in;
  if (!incoming || incoming.type === "fade") return 0;
  const expected = item.clip.start + item.clip.duration - incoming.duration;
  return Math.abs((next?.clip.start ?? Number.NaN) - expected) <= 0.02
    ? incoming.duration
    : 0;
}

function audioFiltersForItem(
  item: IndexedClip,
  indexed: IndexedClip[],
  probeMap: ProjectProbeMap,
  label: string
): string | null {
  const { track, clip } = item;
  if (clip.enabled === false || track.hidden || track.muted || item.inputIndex === null) return null;
  if (clip.kind !== "audio" && clip.kind !== "video") return null;
  if (clip.kind === "video" && clip.includeAudio === false) return null;

  const probe = probeMap[clip.source];
  if (probe && !probe.audio) return null;

  const sourceStart = clip.sourceStart ?? 0;
  const filters = [
    `atrim=start=${formatNumber(sourceStart)}:duration=${formatNumber(clip.duration)}`,
    "asetpts=PTS-STARTPTS"
  ];

  if (numericPropertyHasKeyframes(clip.volume)) {
    const expression = numericPropertyExpression(
      clip.volume,
      1,
      "t",
      `clip ${clip.id}.volume`
    );
    filters.push(`volume=${quotedExpression(expression)}:eval=frame`);
  } else {
    const volume = numericPropertyValue(clip.volume, 1, `clip ${clip.id}.volume`);
    if (volume !== 1) filters.push(`volume=${formatNumber(volume)}`);
  }

  const fadeIn = effectiveAudioFadeDuration(item, indexed, "in");
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${formatNumber(fadeIn)}`);
  const fadeOut = effectiveAudioFadeDuration(item, indexed, "out");
  if (fadeOut > 0) {
    filters.push(
      `afade=t=out:st=${formatNumber(Math.max(0, clip.duration - fadeOut))}:d=${formatNumber(fadeOut)}`
    );
  }

  if (clip.start > 0) filters.push(`adelay=${Math.round(clip.start * 1000)}:all=1`);
  return `[${item.inputIndex}:a]${filters.join(",")}[${label}]`;
}

function compileAudioGraph(
  project: VideoProjectAst,
  indexed: IndexedClip[],
  probeMap: ProjectProbeMap
): { filters: string[]; outputLabel: string | null } {
  const filters: string[] = [];
  const labels: string[] = [];

  for (const item of indexed) {
    const label = `aclip${labels.length}`;
    const expression = audioFiltersForItem(item, indexed, probeMap, label);
    if (!expression) continue;
    filters.push(expression);
    labels.push(label);
  }

  if (labels.length === 0) return { filters, outputLabel: null };

  const duration = formatNumber(projectDurationSeconds(project));
  if (labels.length === 1) {
    filters.push(`[${labels[0]}]atrim=duration=${duration},asetpts=N/SR/TB[aout]`);
  } else {
    filters.push(
      `${labels.map((label) => `[${label}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,atrim=duration=${duration},asetpts=N/SR/TB[aout]`
    );
  }

  return { filters, outputLabel: "aout" };
}

function validateRenderOptions(options: ProjectRenderOptions): void {
  if (options.crf !== undefined && (!Number.isFinite(options.crf) || options.crf < 0 || options.crf > 63)) {
    throw new InvalidProjectError("project render crf must be between 0 and 63.");
  }
}

export function createProjectExecutionPlan(
  inputProject: VideoProjectAst,
  output: string,
  options: ProjectRenderOptions = {},
  probeMap: ProjectProbeMap = {},
  hardwareCapabilities: HardwareAccelerationCapabilities | null = null
): ProjectExecutionPlan {
  validateRenderOptions(options);
  const project = normalizeVideoProject(inputProject);
  const duration = projectDurationSeconds(project);
  if (duration <= 0) throw new InvalidProjectError("Project duration must be greater than 0 before rendering.");

  const indexed: IndexedClip[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) indexed.push({ track, clip, inputIndex: null });
  }

  const inputs: ProjectInputDescriptor[] = [];
  const inputArgs = buildInputArgs(project, indexed, inputs);
  const visual = compileVisualGraph(project, indexed);
  const audio = compileAudioGraph(project, indexed, probeMap);
  const filterComplex = [...visual.filters, ...audio.filters].join(";");
  const container = detectOutputContainer(output);
  if ((options.videoCodec as string | undefined) === "copy") {
    throw new InvalidProjectError('Project composition cannot use videoCodec "copy" because timeline rendering requires a composed video stream.');
  }
  if ((options.audioCodec as string | undefined) === "copy") {
    throw new InvalidProjectError('Project composition cannot use audioCodec "copy" because timeline audio may require mixing and timing changes.');
  }
  const videoCodec = options.videoCodec ?? defaultVideoCodec(container);
  assertVideoCodecCompatible(container, videoCodec);
  const hardware = resolveHardwareAcceleration(
    videoCodec,
    options.hardwareAcceleration,
    hardwareCapabilities,
    options.hardwareFallback !== false
  );

  const audioCodec = audio.outputLabel
    ? (options.audioCodec ?? defaultAudioCodec(container))
    : "none";
  if (audioCodec !== "none") assertAudioCodecCompatible(container, audioCodec);

  if (options.audioCodec === "none" && options.audioBitrate) {
    throw new InvalidProjectError("audioBitrate cannot be used when project audio is disabled.");
  }

  const args: string[] = [];
  args.push(options.overwrite === false ? "-n" : "-y");
  args.push(...inputArgs);
  args.push("-filter_complex", filterComplex, "-map", `[${visual.outputLabel}]`);
  if (audio.outputLabel && audioCodec !== "none") args.push("-map", `[${audio.outputLabel}]`);
  appendVideoEncoderOptions(args, hardware, {
    ...(options.crf !== undefined ? { crf: options.crf } : {}),
    ...(options.preset ? { preset: options.preset } : {}),
    pixelFormat: options.pixelFormat ?? "yuv420p",
    ...(options.videoBitrate ? { videoBitrate: options.videoBitrate } : {})
  });

  if (!audio.outputLabel || audioCodec === "none") {
    args.push("-an");
  } else {
    args.push("-c:a", AUDIO_CODECS[audioCodec]);
    if (options.audioBitrate) args.push("-b:a", options.audioBitrate);
  }

  args.push("-t", formatNumber(duration), output);

  const optimizations = [
    "TIMELINE_SINGLE_PASS_COMPOSITION",
    ...visual.optimizations,
    ...hardwareOptimizationMarkers(hardware)
  ];
  if (audio.outputLabel && audioCodec !== "none") optimizations.push("AUDIO_MIX_GRAPH");
  if (project.tracks.some((track) =>
    track.clips.some((clip) =>
      (clip.kind === "video" || clip.kind === "audio") &&
      numericPropertyHasKeyframes(clip.volume)
    )
  )) {
    optimizations.push("AUDIO_KEYFRAME_EXPRESSION_GRAPH");
  }
  if (project.tracks.some((track) => track.clips.some((clip) => clip.kind === "text" && clip.enabled !== false))) {
    optimizations.push("TEXT_IN_FILTER_GRAPH");
  }

  return {
    schemaVersion: 1,
    backend: "ffmpeg",
    task: "project-render",
    projectId: project.id,
    output,
    width: project.canvas.width,
    height: project.canvas.height,
    fps: project.canvas.fps,
    durationSeconds: duration,
    inputs,
    filterComplex,
    videoMap: visual.outputLabel,
    audioMap: audio.outputLabel,
    args,
    optimizations: [...new Set(optimizations)],
    hardware
  };
}

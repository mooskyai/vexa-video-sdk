const $ = (id) => document.getElementById(id);

const state = {
  sessionId: null,
  source: null,
  output: null,
  mode: "source",
  editorMode: "clip",
  assets: [],
  selectedAssetId: null,
  selectedProjectClipId: null,
  clipAnimationPresets: {},
  captionDocument: null,
  project: {
    schemaVersion: 1,
    id: "playground-project",
    name: "Timeline project",
    canvas: { width: 1280, height: 720, fps: 30, background: "black" },
    tracks: [
      { id: "video-1", type: "video", name: "Video 1", clips: [] },
      { id: "image-1", type: "image", name: "Images", clips: [] },
      { id: "text-1", type: "text", name: "Text 1", clips: [] },
      { id: "audio-1", type: "audio", name: "Audio 1", clips: [] }
    ]
  },
  renderController: null,
  fallbackInFlight: false,
  activeJobId: null,
  jobPollTimer: null,
  completedJobIds: new Set()
};

const log = (message, data) => {
  const time = new Date().toLocaleTimeString();
  const suffix = data === undefined ? "" : `\n${JSON.stringify(data, null, 2)}`;
  $("logOutput").textContent += `\n[${time}] ${message}${suffix}`;
  $("logOutput").scrollTop = $("logOutput").scrollHeight;
};

const numeric = (id, fallback = undefined) => {
  const value = $(id).value.trim();
  if (value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};


const propertyBase = (value, fallback = "") => {
  if (value == null) return fallback;
  return typeof value === "object" ? (value.value ?? fallback) : value;
};

const snapTime = (value) => Math.max(0, Math.round(value * 10) / 10);

function assetLabel(asset) {
  if (asset.kind === "image") {
    return `${asset.metadata.video?.width ?? "?"}×${asset.metadata.video?.height ?? "?"} · image`;
  }
  if (asset.kind === "audio") {
    return `${formatShortTime(asset.metadata.durationSeconds ?? 0)} · ${asset.metadata.audio?.codec ?? "audio"}`;
  }
  return `${asset.metadata.video?.width ?? "?"}×${asset.metadata.video?.height ?? "?"} · ${formatShortTime(asset.metadata.durationSeconds ?? 0)} · ${asset.metadata.video?.codec ?? "video"}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
}

function formatShortTime(seconds) {
  if (!Number.isFinite(seconds)) return "0s";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function editPayload() {
  return {
    trim: {
      enabled: $("trimEnabled").checked,
      start: numeric("trimStart", 0),
      duration: numeric("trimDuration", null)
    },
    resize: {
      enabled: $("resizeEnabled").checked,
      width: numeric("resizeWidth", 1280),
      height: numeric("resizeHeight", 720),
      fit: $("resizeFit").value
    },
    crop: {
      enabled: $("cropEnabled").checked,
      width: numeric("cropWidth", 720),
      height: numeric("cropHeight", 720),
      x: numeric("cropX", null),
      y: numeric("cropY", null)
    },
    rotate: {
      enabled: $("rotateEnabled").checked,
      degrees: numeric("rotateDegrees", 90)
    }
  };
}

function exportPayload() {
  const value = {};
  if ($("videoCodec").value) value.videoCodec = $("videoCodec").value;
  if ($("audioCodec").value) value.audioCodec = $("audioCodec").value;
  const crf = numeric("crf", undefined);
  if (crf !== undefined) value.crf = crf;
  if ($("preset").value) value.preset = $("preset").value;
  if ($("pixelFormat").value.trim()) value.pixelFormat = $("pixelFormat").value.trim();
  if ($("videoBitrate").value.trim()) value.videoBitrate = $("videoBitrate").value.trim();
  if ($("audioBitrate").value.trim()) value.audioBitrate = $("audioBitrate").value.trim();
  value.hardwareAcceleration = $("hardwareAcceleration").value;
  value.hardwareFallback = $("hardwareFallback").checked;
  return value;
}

function renderPayload() {
  return {
    sessionId: state.sessionId,
    ...editPayload(),
    outputFormat: $("outputFormat").value,
    export: exportPayload()
  };
}

function projectPayload() {
  return {
    project: state.project,
    outputFormat: $("outputFormat").value,
    export: exportPayload()
  };
}

function projectDuration() {
  const explicit = state.project.canvas.duration;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  let duration = 0;
  for (const track of state.project.tracks) {
    if (track.hidden && track.type !== "audio") continue;
    if (track.muted && track.type === "audio") continue;
    for (const clip of track.clips) {
      if (clip.enabled === false) continue;
      duration = Math.max(duration, clip.start + clip.duration);
    }
  }
  return duration;
}

function projectTrack(id) {
  return state.project.tracks.find((track) => track.id === id);
}

function projectClipById(id) {
  for (const track of state.project.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

function selectedAsset() {
  return state.assets.find((asset) => asset.sessionId === state.selectedAssetId) ?? null;
}

function selectedAudioAsset() {
  const asset = selectedAsset();
  return asset?.metadata?.audio ? asset : null;
}

function selectedVideoAsset() {
  const asset = selectedAsset();
  return asset?.metadata?.video ? asset : null;
}

function captionPayload() {
  const asset = selectedVideoAsset();
  if (!asset) return null;
  return {
    sessionId: asset.sessionId,
    ...editPayload(),
    format: $("captionFormat").value,
    content: $("captionSource").value,
    template: $("captionTemplate").value,
    fontSize: numeric("captionFontSize", 42),
    position: $("captionPosition").value,
    animation: $("captionAnimation").value,
    color: $("captionColor").value.trim() || "white",
    backgroundColor: $("captionBackground").value.trim() || undefined,
    outputFormat: $("outputFormat").value,
    export: exportPayload()
  };
}



function streamingPayload() {
  const asset = selectedVideoAsset();
  if (!asset) return null;
  return {
    sessionId: asset.sessionId,
    protocol: $("streamProtocol").value,
    preset: $("streamPreset").value,
    segmentDuration: numeric("streamSegmentDuration", 4),
    hlsPlaylistType: $("streamHlsPlaylistType").value,
    hardwareAcceleration: $("hardwareAcceleration").value,
    hardwareFallback: $("hardwareFallback").checked
  };
}

async function detectHardware() {
  $("hardwareOutput").textContent = "Detecting compiled encoders and probing runtime devices…";
  try {
    const response = await fetch("/api/hardware/detect", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Hardware detection failed.");
    $("hardwareOutput").textContent = JSON.stringify(result.capabilities, null, 2);
    log("Hardware acceleration capabilities detected.", result.capabilities);
  } catch (error) {
    $("hardwareOutput").textContent = `Hardware detection failed: ${error.message}`;
    log(`Hardware detection failed: ${error.message}`);
  }
}

async function benchmarkHardware() {
  const asset = selectedVideoAsset();
  if (!asset) return log("Select a video asset before benchmarking hardware encoders.");
  $("hardwareOutput").textContent = "Benchmarking selected encoding backend…";
  try {
    const response = await fetch("/api/hardware/benchmark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: asset.sessionId,
        provider: $("hardwareAcceleration").value,
        codec: $("hardwareBenchmarkCodec").value,
        durationSeconds: Math.min(3, Math.max(0.5, asset.metadata.durationSeconds ?? 3))
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Hardware benchmark failed.");
    $("hardwareOutput").textContent = JSON.stringify(result.results, null, 2);
    log("Hardware benchmark completed.", result.results);
  } catch (error) {
    $("hardwareOutput").textContent = `Hardware benchmark failed: ${error.message}`;
    log(`Hardware benchmark failed: ${error.message}`);
  }
}

function addGeneratedLink(label, url, detail = "") {
  const item = document.createElement("div");
  item.className = "generated-item generated-link";
  const icon = document.createElement("div");
  icon.className = "generated-link-icon";
  icon.textContent = "↗";
  const copy = document.createElement("div");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  copy.append(anchor);
  if (detail) {
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = detail;
    copy.append(meta);
  }
  item.append(icon, copy);
  $("generatedAssets").prepend(item);
}

function addGeneratedSprite(url, vttUrl) {
  const item = document.createElement("div");
  item.className = "generated-item streaming-sprite-item";
  item.innerHTML = `<img src="${url}?v=${Date.now()}" alt="Streaming preview sprite"><div><strong>Preview sprite</strong><div class="muted">WebVTT thumbnail map</div><a href="${vttUrl}" target="_blank" rel="noreferrer">Open VTT</a></div>`;
  $("generatedAssets").prepend(item);
}

async function planStreamingPackage() {
  const payload = streamingPayload();
  if (!payload) return log("Select a video asset before planning streaming output.");
  $("streamingOutput").textContent = "Planning adaptive package…";
  try {
    const result = await expectJson(await fetch("/api/streaming/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
    $("streamingOutput").textContent = JSON.stringify(result.plan, null, 2);
    log("Streaming package plan refreshed.", { protocol: result.plan.protocol, renditions: result.plan.renditions, optimizations: result.plan.optimizations });
  } catch (error) {
    $("streamingOutput").textContent = `Streaming plan failed: ${error.message}`;
    log(`Streaming plan failed: ${error.message}`);
  }
}

async function createStreamingPackage() {
  const payload = streamingPayload();
  if (!payload) return log("Select a video asset before packaging streaming output.");
  state.renderController = new AbortController();
  $("streamPackageButton").disabled = true;
  $("cancelButton").classList.remove("hidden");
  $("renderProgress").value = 0;
  $("progressText").textContent = "0%";
  $("renderState").textContent = "Streaming";
  $("streamingOutput").textContent = "Creating adaptive streaming package…";
  try {
    const response = await fetch("/api/streaming/package", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: state.renderController.signal
    });
    await readNdjson(response, (item) => {
      if (item.type === "progress") {
        const percent = item.progress.percent;
        if (percent != null) {
          $("renderProgress").value = percent;
          $("progressText").textContent = `${percent.toFixed(1)}%`;
        }
        $("renderState").textContent = `Streaming · ${item.progress.processedSeconds.toFixed(1)}s`;
      } else if (item.type === "complete") {
        $("renderProgress").value = 100;
        $("progressText").textContent = "100%";
        $("renderState").textContent = "Package complete";
        $("streamingOutput").textContent = `${item.manifestText}\n\nFiles:\n${item.files.map((file) => file.name).join("\n")}`;
        addGeneratedLink(item.protocol === "hls" ? "HLS master playlist" : "DASH manifest", item.manifestUrl, `${item.renditions.length} rendition(s) · ${item.files.length} files`);
        log(`${item.protocol.toUpperCase()} package completed.`, { files: item.files.length, renditions: item.renditions });
      } else if (item.type === "error") {
        throw new Error(`${item.code}: ${item.error}`);
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      $("streamingOutput").textContent = "Streaming package cancelled.";
      log("Streaming package cancelled.");
    } else {
      $("streamingOutput").textContent = `Streaming package failed: ${error.message}`;
      log(`Streaming package failed: ${error.message}`);
    }
  } finally {
    state.renderController = null;
    $("streamPackageButton").disabled = !selectedVideoAsset();
    $("cancelButton").classList.add("hidden");
  }
}

async function generateStreamingSprite() {
  const asset = selectedVideoAsset();
  if (!asset) return log("Select a video asset before generating preview sprites.");
  $("streamingOutput").textContent = "Generating preview sprite…";
  try {
    const result = await expectJson(await fetch("/api/streaming/sprite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: asset.sessionId,
        intervalSeconds: numeric("spriteInterval", 5),
        tileWidth: numeric("spriteWidth", 160),
        columns: numeric("spriteColumns", 5)
      })
    }));
    addGeneratedSprite(result.imageUrl, result.vttUrl);
    $("streamingOutput").textContent = result.vtt;
    log(`Generated preview sprite with ${result.cues.length} cue(s).`);
  } catch (error) {
    $("streamingOutput").textContent = `Preview sprite failed: ${error.message}`;
    log(`Preview sprite failed: ${error.message}`);
  }
}

function captionCssColor(value, fallback = "transparent") {
  if (!value) return fallback;
  const match = /^(.+?)@([0-9]*\.?[0-9]+)$/u.exec(String(value).trim());
  if (!match) return String(value);
  const base = match[1].trim().toLowerCase();
  const alpha = Math.min(1, Math.max(0, Number(match[2])));
  const named = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0]
  };
  if (named[base]) {
    const [r, g, b] = named[base];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const hex = /^#?([0-9a-f]{6})$/iu.exec(base);
  if (hex) {
    const value24 = Number.parseInt(hex[1], 16);
    const r = (value24 >> 16) & 255;
    const g = (value24 >> 8) & 255;
    const b = value24 & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return base;
}

function activeCaptionCue(time) {
  if (!$("captionIncludeRender")?.checked || !state.captionDocument || state.mode !== "source") return null;
  return state.captionDocument.cues.find((cue) => time >= cue.start && time <= cue.end) ?? null;
}

function updateCaptionPreview() {
  const overlay = $("captionPreviewOverlay");
  if (!overlay) return;

  const video = $("editorVideo");
  const cue = activeCaptionCue(video.currentTime || 0);
  if (!cue || !state.source?.metadata?.video || video.readyState < 1) {
    overlay.classList.add("hidden");
    return;
  }

  const style = cue.style ?? {};
  const videoRect = video.getBoundingClientRect();
  const stageRect = $("videoStage").getBoundingClientRect();
  if (!videoRect.width || !videoRect.height) {
    overlay.classList.add("hidden");
    return;
  }

  const sourceWidth = state.source.metadata.video.width || videoRect.width;
  const scale = Math.max(0.25, videoRect.width / sourceWidth);
  const fontSize = Math.max(14, Math.min(96, (style.fontSize ?? 42) * scale));
  const margin = Math.max(8, (style.marginBottom ?? 48) * scale);
  const outline = Math.max(0, (style.outlineWidth ?? 2) * scale);

  overlay.textContent = cue.text;
  overlay.style.left = `${videoRect.left - stageRect.left}px`;
  overlay.style.width = `${videoRect.width}px`;
  overlay.style.fontSize = `${fontSize}px`;
  overlay.style.color = captionCssColor(style.color, "white");
  overlay.style.background = style.backgroundColor
    ? captionCssColor(style.backgroundColor, "rgba(0,0,0,.55)")
    : "transparent";
  overlay.style.fontWeight = style.bold ? "800" : "700";
  overlay.style.fontStyle = style.italic ? "italic" : "normal";
  overlay.style.textShadow = outline > 0
    ? `0 0 ${Math.max(1, outline)}px ${captionCssColor(style.outlineColor, "black")}, 0 1px ${Math.max(1, outline)}px ${captionCssColor(style.outlineColor, "black")}`
    : "none";

  overlay.style.top = "auto";
  overlay.style.bottom = "auto";
  overlay.style.transform = "none";

  const position = style.position ?? "bottom";
  if (position === "top") {
    overlay.style.top = `${videoRect.top - stageRect.top + margin}px`;
  } else if (position === "center") {
    overlay.style.top = `${videoRect.top - stageRect.top + videoRect.height / 2}px`;
    overlay.style.transform = "translateY(-50%)";
  } else {
    overlay.style.bottom = `${stageRect.bottom - videoRect.bottom + margin}px`;
  }

  const span = Math.max(0.001, cue.end - cue.start);
  const local = Math.max(0, Math.min(span, (video.currentTime || 0) - cue.start));
  let opacity = 1;
  let scaleValue = 1;
  if (style.animation === "fade") {
    const fade = Math.min(0.2, Math.max(0.05, span / 4));
    opacity = Math.min(1, local / fade, (span - local) / fade);
  } else if (style.animation === "pop") {
    const pop = Math.min(0.18, Math.max(0.05, span / 4));
    const p = Math.min(1, local / pop);
    opacity = p;
    scaleValue = 0.86 + (0.14 * p);
  }
  overlay.style.opacity = String(Math.max(0, opacity));
  const baseTransform = position === "center" ? "translateY(-50%)" : "";
  overlay.style.transform = `${baseTransform} scale(${scaleValue})`.trim();
  overlay.classList.remove("hidden");
}

function syncCaptionRenderState() {
  const active = Boolean(state.captionDocument && $("captionIncludeRender")?.checked && selectedVideoAsset());
  if ($("captionPreviewStatus")) {
    $("captionPreviewStatus").textContent = state.captionDocument
      ? `${state.captionDocument.cues.length} cue(s) parsed · ${active ? "live preview + Render enabled" : "preview disabled"}`
      : "Parse captions to activate live preview.";
  }
  if (state.editorMode === "clip" && $("topRenderButton")) {
    $("topRenderButton").textContent = active ? "Render + captions" : "Render";
  }
  updateCaptionPreview();
}

function invalidateCaptionPreview() {
  state.captionDocument = null;
  syncCaptionRenderState();
}

async function toggleFullscreenPreview() {
  const stage = $("videoStage");
  if (!stage || stage.classList.contains("hidden")) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await stage.requestFullscreen();
    }
  } catch (error) {
    log(`Fullscreen failed: ${error.message}`);
  }
}

function syncFullscreenButton() {
  const button = $("fullscreenButton");
  if (!button) return;
  button.textContent = document.fullscreenElement ? "Exit full" : "Full";
  updateCaptionPreview();
}

function updateAudioSidechainOptions() {
  const select = $("audioDuckingSource");
  if (!select) return;
  const previous = select.value;
  const selected = selectedAsset();
  const candidates = state.assets.filter(
    (asset) => asset.metadata?.audio && asset.sessionId !== selected?.sessionId
  );
  select.innerHTML = '<option value="">Off</option>';
  for (const asset of candidates) {
    const option = document.createElement("option");
    option.value = asset.sessionId;
    option.textContent = `${asset.name} · ${asset.metadata.audio?.codec ?? "audio"}`;
    select.append(option);
  }
  if (candidates.some((asset) => asset.sessionId === previous)) select.value = previous;
}

function audioEnginePayload() {
  const asset = selectedAudioAsset();
  if (!asset) return null;
  const sidechainSessionId = $("audioDuckingSource").value || null;
  return {
    sessionId: asset.sessionId,
    normalize: {
      enabled: $("audioNormalize").value === "on",
      targetLufs: numeric("audioTargetLufs", -16),
      truePeakDb: numeric("audioTruePeak", -1.5),
      loudnessRange: numeric("audioLra", 11)
    },
    fadeIn: numeric("audioFadeIn", 0),
    fadeOut: numeric("audioFadeOut", 0),
    channels: $("audioChannels").value,
    codec: $("audioEngineCodec").value,
    bitrate: $("audioEngineCodec").value === "copy"
      ? undefined
      : ($("audioEngineBitrate").value.trim() || undefined),
    ducking: {
      enabled: Boolean(sidechainSessionId),
      sidechainSessionId,
      threshold: numeric("audioDuckingThreshold", 0.1),
      ratio: numeric("audioDuckingRatio", 8),
      mixSidechain: true
    }
  };
}

function renderAssetLibrary() {
  const target = $("assetLibrary");
  target.innerHTML = "";
  for (const asset of state.assets) {
    const card = document.createElement("div");
    card.className = `library-asset${asset.sessionId === state.selectedAssetId ? " active" : ""}`;
    const copy = document.createElement("div");
    copy.innerHTML = `<strong>${asset.name}</strong><span>${assetLabel(asset)}</span>`;
    const add = document.createElement("button");
    add.className = "add-asset";
    add.type = "button";
    add.textContent = "+ Timeline";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedAssetId = asset.sessionId;
      selectSourceAsset(asset);
      addSelectedAssetToTimeline();
    });
    card.append(copy, add);
    card.addEventListener("click", () => {
      state.selectedAssetId = asset.sessionId;
      selectSourceAsset(asset);
      renderAssetLibrary();
    });
    target.append(card);
  }
  $("addAssetToTimelineButton").disabled = !selectedAsset();
  updateAudioSidechainOptions();
  const audioReady = Boolean(selectedAudioAsset());
  for (const id of ["audioPlanButton", "audioProcessButton", "audioSilenceButton", "audioWaveformButton"]) {
    if ($(id)) $(id).disabled = !audioReady;
  }
  const captionReady = Boolean(selectedVideoAsset());
  for (const id of ["captionParseButton", "captionPlanButton", "captionBurnButton"]) {
    if ($(id)) $(id).disabled = !captionReady;
  }
  const streamingReady = Boolean(selectedVideoAsset());
  for (const id of ["streamPlanButton", "streamPackageButton", "streamSpriteButton"]) {
    if ($(id)) $(id).disabled = !streamingReady;
  }
  if ($("hardwareBenchmarkButton")) $("hardwareBenchmarkButton").disabled = !streamingReady;
  if ($("jobQueueRenderButton")) $("jobQueueRenderButton").disabled = !streamingReady;
}

function selectSourceAsset(asset) {
  state.sessionId = asset.sessionId;
  state.source = asset;
  updateAssetSummary();
  if (state.editorMode === "clip" && asset.kind === "video") setMode("source");
}

function setEditorMode(mode) {
  state.editorMode = mode;
  $("clipTimelineButton").classList.toggle("active", mode === "clip");
  $("projectTimelineButton").classList.toggle("active", mode === "project");
  $("projectVideoClips").classList.toggle("hidden", mode !== "project");
  $("projectTextClips").classList.toggle("hidden", mode !== "project");
  $("projectAudioClips").classList.toggle("hidden", mode !== "project");
  $("videoClip").classList.toggle("hidden", mode === "project" || !state.source);
  $("audioClip").classList.toggle("hidden", mode === "project" || !state.source);
  $("topRenderButton").textContent = mode === "project" ? "Render project" : "Render";
  syncCaptionRenderState();
  if (mode === "project") {
    renderProjectTimeline();
    openControlDrawer("projectSection", "Project");
  } else {
    closeControlDrawer();
    updateTimelineSelection();
  }
  updateOperationPreview();
}

function addSelectedAssetToTimeline() {
  const asset = selectedAsset();
  if (!asset) return log("Select a media asset before adding it to the timeline.");

  const trackId =
    asset.kind === "audio" ? "audio-1" :
    asset.kind === "image" ? "image-1" :
    "video-1";
  const track = projectTrack(trackId);
  if (!track) return log(`Timeline track ${trackId} is unavailable.`);
  if (track.locked) return log(`Track ${track.name ?? track.id} is locked.`);

  const start = asset.kind === "audio" ? 0 : projectDuration();
  const duration = asset.kind === "image"
    ? 3
    : Math.max(0.1, asset.metadata.durationSeconds ?? 5);

  const clip = asset.kind === "audio"
    ? {
        id: `audio-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        kind: "audio",
        source: `session:${asset.sessionId}`,
        start,
        duration,
        sourceStart: 0,
        volume: 1
      }
    : asset.kind === "image"
      ? {
          id: `image-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          kind: "image",
          source: `session:${asset.sessionId}`,
          start,
          duration,
          opacity: 1,
          transform: { fit: "contain" }
        }
      : {
          id: `video-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          kind: "video",
          source: `session:${asset.sessionId}`,
          start,
          duration,
          sourceStart: 0,
          includeAudio: true,
          opacity: 1,
          volume: 1,
          transform: { fit: "contain" }
        };

  track.clips.push(clip);
  state.selectedProjectClipId = clip.id;
  setEditorMode("project");
  selectProjectClip(clip.id);
  log(`Added ${asset.name} to the ${track.name ?? track.id} timeline.`);
}

function addTextToTimeline() {
  const text = $("projectText").value.trim();
  if (!text) return log("Enter text before adding a text layer.");
  const track = projectTrack("text-1");
  const clip = {
    id: `text-${Date.now()}`,
    kind: "text",
    text,
    start: numeric("projectTextStart", 0) ?? 0,
    duration: numeric("projectTextDuration", 2) ?? 2,
    opacity: 1,
    transform: { x: 48, y: 48 },
    style: { fontSize: numeric("projectTextSize", 48) ?? 48, color: "white" }
  };
  track.clips.push(clip);
  state.selectedProjectClipId = clip.id;
  setEditorMode("project");
  selectProjectClip(clip.id);
  log(`Added text layer: ${text}`);
}

function staticProperty(value, fallback = 0) {
  return propertyBase(value, fallback);
}

function applyMotionPreset(clip, preset) {
  const duration = Math.max(0.1, clip.duration);
  if (clip.kind !== "audio") {
    clip.transform = { ...(clip.transform ?? {}) };
  }

  const flatten = (value, fallback) => propertyBase(value, fallback);
  if (preset === "none") {
    if (clip.kind !== "audio") {
      for (const key of ["x", "y", "width", "height", "rotation"]) {
        if (clip.transform?.[key] !== undefined) {
          clip.transform[key] = flatten(clip.transform[key], 0);
        }
      }
    }
    if (clip.kind === "video" || clip.kind === "audio") {
      clip.volume = flatten(clip.volume, 1);
    }
    return;
  }

  if (preset === "pan-right" && clip.kind !== "audio") {
    const width = flatten(clip.transform?.width, state.project.canvas.width);
    const end = Math.max(0, state.project.canvas.width - width);
    clip.transform.x = {
      value: 0,
      keyframes: [{ time: duration, value: end, easing: "ease-in-out" }]
    };
  } else if (preset === "pan-left" && clip.kind !== "audio") {
    const width = flatten(clip.transform?.width, state.project.canvas.width);
    const start = Math.max(0, state.project.canvas.width - width);
    clip.transform.x = {
      value: start,
      keyframes: [{ time: duration, value: 0, easing: "ease-in-out" }]
    };
  } else if (preset === "zoom-in" && (clip.kind === "video" || clip.kind === "image")) {
    clip.transform.width = {
      value: Math.max(1, Math.round(state.project.canvas.width * 0.82)),
      keyframes: [{ time: duration, value: state.project.canvas.width, easing: "ease-in-out" }]
    };
    clip.transform.height = {
      value: Math.max(1, Math.round(state.project.canvas.height * 0.82)),
      keyframes: [{ time: duration, value: state.project.canvas.height, easing: "ease-in-out" }]
    };
  } else if (preset === "rotate-90" && (clip.kind === "video" || clip.kind === "image")) {
    clip.transform.rotation = {
      value: 0,
      keyframes: [{ time: duration, value: 90, easing: "ease-in-out" }]
    };
  } else if (preset === "volume-rise" && (clip.kind === "video" || clip.kind === "audio")) {
    clip.volume = {
      value: 0.25,
      keyframes: [{ time: duration, value: 1, easing: "ease-in-out" }]
    };
  }
}

function syncSelectedTrackButtons(track) {
  if (!track) return;
  $("projectTrackVisibleButton").textContent = track.hidden ? "Show track" : "Hide track";
  $("projectTrackMuteButton").textContent = track.muted ? "Unmute track" : "Mute track";
  $("projectTrackMuteButton").disabled = track.type !== "audio" && track.type !== "video";
  $("projectTrackLockButton").textContent = track.locked ? "Unlock track" : "Lock track";
  const index = state.project.tracks.findIndex((item) => item.id === track.id);
  $("projectTrackUpButton").disabled = index <= 0;
  $("projectTrackDownButton").disabled = index < 0 || index >= state.project.tracks.length - 1;
}

function selectedProjectTrack() {
  return projectClipById(state.selectedProjectClipId)?.track ?? null;
}

function moveSelectedTrack(delta) {
  const track = selectedProjectTrack();
  if (!track) return;
  const index = state.project.tracks.findIndex((item) => item.id === track.id);
  const next = Math.min(state.project.tracks.length - 1, Math.max(0, index + delta));
  if (next === index) return;
  const [moved] = state.project.tracks.splice(index, 1);
  state.project.tracks.splice(next, 0, moved);
  syncSelectedTrackButtons(track);
  renderProjectTimeline();
  updateOperationPreview();
  log(`Moved track ${track.name ?? track.id} to z-order ${next}.`);
}

function toggleSelectedTrack(property) {
  const track = selectedProjectTrack();
  if (!track) return;
  track[property] = !track[property];
  syncSelectedTrackButtons(track);
  renderProjectTimeline();
  updateOperationPreview();
  log(`${track.name ?? track.id}: ${property}=${track[property]}.`);
}

function attachTimelineDrag(block, clip, target) {
  const leftHandle = document.createElement("span");
  leftHandle.className = "trim-handle left";
  const rightHandle = document.createElement("span");
  rightHandle.className = "trim-handle right";
  block.append(leftHandle, rightHandle);

  const startDrag = (event, mode) => {
    event.preventDefault();
    event.stopPropagation();
    const found = projectClipById(clip.id);
    if (found?.track.locked) {
      log(`Track ${found.track.name ?? found.track.id} is locked.`);
      return;
    }
    selectProjectClip(clip.id);

    const rect = target.getBoundingClientRect();
    const timelineDuration = Math.max(projectDuration(), 1);
    const originX = event.clientX;
    const originStart = clip.start;
    const originDuration = clip.duration;
    const originSourceStart = clip.sourceStart ?? 0;
    let moved = false;

    const onMove = (moveEvent) => {
      const seconds = ((moveEvent.clientX - originX) / Math.max(1, rect.width)) * timelineDuration;
      if (Math.abs(seconds) > 0.02) moved = true;

      if (mode === "move") {
        clip.start = snapTime(originStart + seconds);
      } else if (mode === "trim-end") {
        clip.duration = Math.max(0.1, snapTime(originDuration + seconds));
      } else {
        const proposed = Math.min(
          originStart + originDuration - 0.1,
          Math.max(0, originStart + seconds)
        );
        const delta = snapTime(proposed - originStart);
        clip.start = snapTime(originStart + delta);
        clip.duration = Math.max(0.1, snapTime(originDuration - delta));
        if (clip.kind === "video" || clip.kind === "audio") {
          clip.sourceStart = Math.max(0, snapTime(originSourceStart + delta));
        }
      }

      block.style.left = `${Math.max(0, (clip.start / timelineDuration) * 100)}%`;
      block.style.width = `${Math.max(1, (clip.duration / timelineDuration) * 100)}%`;
      $("projectClipStart").value = clip.start;
      $("projectClipDuration").value = clip.duration;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        renderProjectTimeline();
        updateOperationPreview();
        log(`Timeline ${mode} updated ${clip.id}.`);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  block.addEventListener("pointerdown", (event) => {
    if (event.target === leftHandle || event.target === rightHandle) return;
    startDrag(event, "move");
  });
  leftHandle.addEventListener("pointerdown", (event) => startDrag(event, "trim-start"));
  rightHandle.addEventListener("pointerdown", (event) => startDrag(event, "trim-end"));
}

function selectProjectClip(id) {
  state.selectedProjectClipId = id;
  const found = projectClipById(id);
  if (!found) {
    $("selectedProjectClipPanel").classList.add("hidden");
    renderProjectTimeline();
    return;
  }
  const { clip } = found;
  $("selectedProjectClipPanel").classList.remove("hidden");
  $("projectClipStart").value = clip.start;
  $("projectClipDuration").value = clip.duration;
  $("projectClipX").value = propertyBase(clip.transform?.x, "");
  $("projectClipY").value = propertyBase(clip.transform?.y, "");
  $("projectClipWidth").value = propertyBase(clip.transform?.width, "");
  $("projectClipHeight").value = propertyBase(clip.transform?.height, "");
  $("projectClipRotation").value = propertyBase(clip.transform?.rotation, 0);
  $("projectClipOpacity").value = propertyBase(clip.opacity, 1);
  $("projectClipVolume").value = propertyBase(clip.volume, 1);
  $("projectClipBlend").value = clip.blendMode ?? "normal";
  $("projectClipTransitionIn").value = clip.transitions?.in?.type ?? "none";
  $("projectClipTransitionDuration").value = clip.transitions?.in?.duration ?? 0;
  $("projectClipFadeOut").value = clip.transitions?.out?.type === "fade"
    ? clip.transitions.out.duration
    : 0;
  $("projectClipAnimation").value = state.clipAnimationPresets[clip.id] ?? "none";
  syncSelectedTrackButtons(found.track);
  renderProjectTimeline();
}

function applySelectedProjectClip() {
  const found = projectClipById(state.selectedProjectClipId);
  if (!found) return;
  const { track, clip } = found;
  if (track.locked) return log(`Track ${track.name ?? track.id} is locked.`);

  clip.start = numeric("projectClipStart", clip.start) ?? clip.start;
  clip.duration = numeric("projectClipDuration", clip.duration) ?? clip.duration;
  clip.opacity = numeric("projectClipOpacity", propertyBase(clip.opacity, 1)) ?? 1;

  const x = numeric("projectClipX", null);
  const y = numeric("projectClipY", null);
  const width = numeric("projectClipWidth", null);
  const height = numeric("projectClipHeight", null);
  const rotation = numeric("projectClipRotation", 0) ?? 0;

  if (clip.kind !== "audio") {
    clip.transform = {
      ...(clip.transform ?? {}),
      ...(x == null ? {} : { x }),
      ...(y == null ? {} : { y }),
      ...(width == null ? {} : { width }),
      ...(height == null ? {} : { height }),
      rotation
    };
    if (clip.kind === "video" || clip.kind === "image") {
      clip.blendMode = $("projectClipBlend").value;
    }
  }

  if (clip.kind === "video" || clip.kind === "audio") {
    clip.volume = numeric("projectClipVolume", propertyBase(clip.volume, 1)) ?? 1;
  }

  const transitionType = $("projectClipTransitionIn").value;
  const transitionDuration = numeric("projectClipTransitionDuration", 0) ?? 0;
  const fadeOut = numeric("projectClipFadeOut", 0) ?? 0;

  if (transitionType !== "none" && transitionDuration > 0) {
    clip.transitions = {
      ...(clip.transitions ?? {}),
      in: { type: transitionType, duration: transitionDuration },
      ...(fadeOut > 0 ? { out: { type: "fade", duration: fadeOut } } : {})
    };

    if (["crossfade", "wipe-left", "wipe-right"].includes(transitionType)) {
      const siblings = track.clips
        .filter((candidate) => candidate.id !== clip.id && candidate.enabled !== false)
        .sort((a, b) => a.start - b.start);
      const previous = siblings.filter((candidate) => candidate.start <= clip.start).at(-1);
      if (previous) {
        clip.start = Math.max(0, previous.start + previous.duration - transitionDuration);
        $("projectClipStart").value = clip.start;
      }
    }
  } else {
    clip.transitions = fadeOut > 0
      ? { out: { type: "fade", duration: fadeOut } }
      : {};
  }

  const preset = $("projectClipAnimation").value;
  state.clipAnimationPresets[clip.id] = preset;
  applyMotionPreset(clip, preset);

  renderProjectTimeline();
  updateOperationPreview();
  log(`Updated timeline clip ${clip.id}.`);
}

function removeSelectedProjectClip() {
  const id = state.selectedProjectClipId;
  if (!id) return;
  for (const track of state.project.tracks) {
    track.clips = track.clips.filter((clip) => clip.id !== id);
  }
  delete state.clipAnimationPresets[id];
  state.selectedProjectClipId = null;
  $("selectedProjectClipPanel").classList.add("hidden");
  renderProjectTimeline();
  updateOperationPreview();
}

function clearProjectTimeline() {
  for (const track of state.project.tracks) track.clips = [];
  state.selectedProjectClipId = null;
  state.clipAnimationPresets = {};
  $("selectedProjectClipPanel").classList.add("hidden");
  renderProjectTimeline();
  updateOperationPreview();
  log("Project timeline cleared.");
}

function syncProjectCanvas() {
  state.project.canvas.width = numeric("projectWidth", 1280) ?? 1280;
  state.project.canvas.height = numeric("projectHeight", 720) ?? 720;
  state.project.canvas.fps = numeric("projectFps", 30) ?? 30;
  state.project.canvas.background = $("projectBackground").value.trim() || "black";
  renderProjectTimeline();
  updateOperationPreview();
}

function renderProjectTimeline() {
  if (state.editorMode !== "project") return;
  const duration = Math.max(projectDuration(), 1);
  buildTimeRuler(duration);
  const videoTarget = $("projectVideoClips");
  const textTarget = $("projectTextClips");
  const audioTarget = $("projectAudioClips");
  videoTarget.innerHTML = "";
  textTarget.innerHTML = "";
  audioTarget.innerHTML = "";

  const addBlock = (target, clip, kind, label) => {
    const block = document.createElement("button");
    block.type = "button";
    block.className = `project-timeline-clip ${kind}${clip.id === state.selectedProjectClipId ? " selected" : ""}`;
    block.style.left = `${Math.max(0, (clip.start / duration) * 100)}%`;
    block.style.width = `${Math.max(1, (clip.duration / duration) * 100)}%`;
    block.textContent = label;
    block.title = `${label} · ${clip.start.toFixed(2)}s → ${(clip.start + clip.duration).toFixed(2)}s`;
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      selectProjectClip(clip.id);
    });
    attachTimelineDrag(block, clip, target);
    target.append(block);
  };

  for (const track of state.project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === "video") {
        const asset = state.assets.find((item) => `session:${item.sessionId}` === clip.source);
        addBlock(videoTarget, clip, "video", asset?.name ?? clip.id);
        if (clip.includeAudio !== false) addBlock(audioTarget, clip, "audio", "Clip audio");
      } else if (clip.kind === "image") {
        const asset = state.assets.find((item) => `session:${item.sessionId}` === clip.source);
        addBlock(videoTarget, clip, "image", asset?.name ?? "Image");
      } else if (clip.kind === "text") {
        addBlock(textTarget, clip, "text", clip.text);
      } else if (clip.kind === "audio") {
        addBlock(audioTarget, clip, "audio", clip.id);
      }
    }
  }

  $("timelineSummary").textContent = `${state.project.tracks.reduce((count, track) => count + track.clips.length, 0)} clips · ${formatShortTime(projectDuration())} project`;
  $("projectPlanButton").disabled = projectDuration() <= 0;
  $("projectRenderButton").disabled = projectDuration() <= 0;
}

async function refreshProjectPlan() {
  if (projectDuration() <= 0) return log("Add at least one timeline clip before planning the project.");
  $("projectPlanButton").disabled = true;
  $("projectPlanPreview").textContent = "Planning timeline…";
  try {
    const result = await expectJson(await fetch("/api/project/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(projectPayload())
    }));
    $("projectPlanPreview").textContent = JSON.stringify(result.plan, null, 2);
    $("executionPlanPreview").textContent = JSON.stringify(result.plan, null, 2);
    log("Timeline composition plan refreshed.", { optimizations: result.plan.optimizations, inputs: result.plan.inputs.length });
  } catch (error) {
    $("projectPlanPreview").textContent = `Plan failed: ${error.message}`;
    log(`Timeline plan failed: ${error.message}`);
  } finally {
    $("projectPlanButton").disabled = projectDuration() <= 0;
  }
}

async function renderProject() {
  if (projectDuration() <= 0) return log("Add timeline clips before rendering the project.");
  state.renderController = new AbortController();
  $("topRenderButton").disabled = true;
  $("projectRenderButton").disabled = true;
  $("cancelButton").classList.remove("hidden");
  $("renderProgress").value = 0;
  $("progressText").textContent = "0%";
  $("renderState").textContent = "Project render";
  $("saveState").textContent = "Rendering timeline…";
  try {
    const response = await fetch("/api/project/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(projectPayload()),
      signal: state.renderController.signal
    });
    await readNdjson(response, (item) => {
      if (item.type === "progress") {
        const percent = item.progress.percent;
        if (percent != null) {
          $("renderProgress").value = percent;
          $("progressText").textContent = `${percent.toFixed(1)}%`;
        }
        $("renderState").textContent = `${item.progress.processedSeconds.toFixed(1)}s · ${item.progress.speed ?? "?"}x`;
      } else if (item.type === "start") {
        $("projectPlanPreview").textContent = JSON.stringify(item.plan, null, 2);
      } else if (item.type === "complete") {
        $("renderProgress").value = 100;
        $("progressText").textContent = "100%";
        $("renderState").textContent = "Complete";
        $("saveState").textContent = "Timeline render complete";
        state.output = {
          name: item.name,
          url: item.url,
          playbackUrl: item.playbackUrl ?? item.url,
          metadata: item.metadata,
          previewGenerated: item.previewGenerated
        };
        updateAssetSummary();
        setMode("output");
        log("Timeline project rendered.", item.metadata);
      } else if (item.type === "error") {
        throw new Error(`${item.code}: ${item.error}`);
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      $("renderState").textContent = "Cancelled";
      $("saveState").textContent = "Timeline render cancelled";
      log("Timeline render cancelled.");
    } else {
      $("renderState").textContent = "Failed";
      $("saveState").textContent = "Timeline render failed";
      log(`Timeline render failed: ${error.message}`);
    }
  } finally {
    state.renderController = null;
    $("topRenderButton").disabled = false;
    $("projectRenderButton").disabled = projectDuration() <= 0;
    $("cancelButton").classList.add("hidden");
  }
}

function updateOperationPreview() {
  $("operationPreview").textContent = JSON.stringify(
    state.editorMode === "project" ? projectPayload() : renderPayload(),
    null,
    2
  );
  if (state.editorMode === "project") {
    $("executionPlanPreview").textContent = "Project changed. Plan the timeline again.";
    renderProjectTimeline();
  } else {
    if (state.sessionId) $("executionPlanPreview").textContent = "Settings changed. Refresh the optimizer plan.";
    updateTimelineSelection();
  }
}

function metadataItems(metadata) {
  return [
    ["Duration", metadata.durationSeconds == null ? "—" : formatShortTime(metadata.durationSeconds)],
    ["Resolution", metadata.video ? `${metadata.video.width ?? "?"}×${metadata.video.height ?? "?"}` : "No video"],
    ["Video", metadata.video?.codec ?? "—"],
    ["FPS", metadata.video?.fps == null ? "—" : Number(metadata.video.fps).toFixed(2)],
    ["Audio", metadata.audio?.codec ?? "—"],
    ["Rate", metadata.audio?.sampleRate ? `${metadata.audio.sampleRate} Hz` : "—"],
    ["Channels", metadata.audio?.channels ?? "—"],
    ["Bitrate", metadata.bitRate ? `${Math.round(metadata.bitRate / 1000)} kbps` : "—"]
  ];
}

function showMetadata(targetId, metadata) {
  const target = $(targetId);
  target.classList.remove("empty");
  target.innerHTML = metadataItems(metadata)
    .map(([label, value]) => `<div class="metadata-item"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

async function expectJson(response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

function enableEditor(enabled) {
  ["topRenderButton", "thumbnailButton", "audioButton", "forcePreviewButton", "planButton"].forEach((id) => {
    $(id).disabled = !enabled;
  });
  if (!enabled) {
    for (const id of ["audioPlanButton", "audioProcessButton", "audioSilenceButton", "audioWaveformButton", "streamPlanButton", "streamPackageButton", "streamSpriteButton", "hardwareBenchmarkButton", "jobQueueRenderButton"]) {
      if ($(id)) $(id).disabled = true;
    }
  }
}

function mediaForMode() {
  return state.mode === "output" ? state.output : state.source;
}

function setLoading(message, visible = true) {
  $("loadingText").textContent = message;
  $("loadingOverlay").classList.toggle("hidden", !visible);
}

function setPlaybackError(message, visible = true) {
  $("playbackErrorText").textContent = message;
  $("playbackError").classList.toggle("hidden", !visible);
}

function loadPlayback(url) {
  const video = $("editorVideo");
  setPlaybackError("", false);
  setLoading("Loading browser preview…", true);
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.src = `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
  video.load();
}

function setMode(mode) {
  if (mode === "output" && !state.output) return;
  if (mode === "source" && state.source?.kind && state.source.kind !== "video") {
    log(`The selected ${state.source.kind} asset is timeline-only in the central video canvas.`);
    return;
  }
  state.mode = mode;
  $("sourceTab").classList.toggle("active", mode === "source");
  $("outputTab").classList.toggle("active", mode === "output");
  $("sourceAsset").classList.toggle("active", mode === "source");
  $("outputAsset").classList.toggle("active", mode === "output");

  const media = mediaForMode();
  if (!media) return;

  $("previewBadge").textContent = mode === "source" ? "Source preview" : "Rendered output";
  $("previewResolution").textContent = media.metadata?.video
    ? `${media.metadata.video.width ?? "?"}×${media.metadata.video.height ?? "?"}`
    : "Audio only";
  loadPlayback(media.playbackUrl ?? media.url);
  updateCaptionPreview();
  if (state.editorMode === "project") {
    renderProjectTimeline();
  } else {
    buildTimeRuler(media.metadata?.durationSeconds ?? 0);
    updateTimelineSelection();
  }
}

async function ensureCompatiblePreview(name) {
  if (!state.sessionId || state.fallbackInFlight) return;
  state.fallbackInFlight = true;
  setPlaybackError("", false);
  setLoading("Creating H.264/AAC browser preview…", true);
  log("Creating browser-safe preview because direct playback failed.");

  try {
    const result = await expectJson(await fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, ...(name ? { name } : {}) })
    }));

    const media = mediaForMode();
    media.playbackUrl = result.playbackUrl;
    loadPlayback(result.playbackUrl);
    log("Browser-safe H.264/AAC preview created.");
  } catch (error) {
    setLoading("", false);
    setPlaybackError(`Preview generation failed: ${error.message}`, true);
    log(`Browser preview failed: ${error.message}`);
  } finally {
    state.fallbackInFlight = false;
  }
}

function updateAssetSummary() {
  if (!state.source) return;
  const metadata = state.source.metadata;
  $("assetName").textContent = state.source.name;
  $("assetMeta").textContent = `${metadata.video?.width ?? "?"}×${metadata.video?.height ?? "?"} · ${formatShortTime(metadata.durationSeconds ?? 0)} · ${metadata.video?.codec ?? "?"}`;
  $("sourceAsset").classList.remove("hidden");
  $("mediaEmpty").classList.add("hidden");
  $("projectName").textContent = state.source.name;
  showMetadata("sourceMetadata", metadata);

  if (state.output) {
    $("outputAssetMeta").textContent = `${state.output.metadata.video?.width ?? "?"}×${state.output.metadata.video?.height ?? "?"} · ${formatShortTime(state.output.metadata.durationSeconds ?? 0)} · ${state.output.metadata.video?.codec ?? "?"}`;
    $("outputAsset").classList.remove("hidden");
    $("outputTab").disabled = false;
  }
}

function buildTimeRuler(duration) {
  const ruler = $("timeRuler");
  ruler.innerHTML = "";
  if (!duration) return;
  const marks = 8;
  for (let index = 0; index <= marks; index += 1) {
    const mark = document.createElement("span");
    mark.className = "ruler-mark";
    mark.style.left = `${(index / marks) * 100}%`;
    mark.textContent = formatShortTime((index / marks) * duration);
    ruler.append(mark);
  }
}

function updateTimelineSelection() {
  const media = mediaForMode();
  if (!media?.metadata?.durationSeconds) {
    $("videoClip").classList.add("hidden");
    $("audioClip").classList.add("hidden");
    $("timelinePlayhead").classList.add("hidden");
    $("timelineSummary").textContent = "No clip loaded";
    return;
  }

  const fullDuration = media.metadata.durationSeconds;
  let start = 0;
  let duration = fullDuration;

  if (state.mode === "source" && $("trimEnabled").checked) {
    start = Math.min(Math.max(numeric("trimStart", 0) ?? 0, 0), fullDuration);
    const requested = numeric("trimDuration", null);
    duration = requested == null ? fullDuration - start : Math.min(requested, fullDuration - start);
  }

  const left = Math.max(0, Math.min(100, (start / fullDuration) * 100));
  const width = Math.max(0.5, Math.min(100 - left, (duration / fullDuration) * 100));

  for (const id of ["videoClip", "audioClip"]) {
    $(id).classList.remove("hidden");
    $(id).style.left = `${left}%`;
    $(id).style.width = `${width}%`;
  }
  $("videoClipName").textContent = state.mode === "source" ? state.source.name : "Rendered output";
  $("videoClipDuration").textContent = formatShortTime(duration);
  $("timelineSummary").textContent = `${formatShortTime(duration)} selected · ${state.mode === "source" ? "source" : "output"}`;
  $("timelinePlayhead").classList.remove("hidden");
  updatePlayhead();
}

function updatePlayhead() {
  const video = $("editorVideo");
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const percent = duration > 0 ? Math.min(100, Math.max(0, (video.currentTime / duration) * 100)) : 0;
  $("timelinePlayhead").style.left = `${percent}%`;
  $("seekBar").value = video.currentTime || 0;
  $("currentTime").textContent = formatTime(video.currentTime || 0);
}

function syncTransport() {
  const video = $("editorVideo");
  const ready = Number.isFinite(video.duration) && video.duration > 0;
  $("playButton").disabled = !ready;
  $("muteButton").disabled = !ready;
  $("playbackRate").disabled = !ready;
  $("seekBar").disabled = !ready;
  $("seekBar").max = ready ? video.duration : 100;
  $("durationTime").textContent = formatTime(ready ? video.duration : 0);
  $("playButton").textContent = video.paused ? "▶" : "❚❚";
  $("muteButton").textContent = video.muted ? "Muted" : "Sound";
  updatePlayhead();
}

function registerImportedAsset(result, logMessage) {
  const asset = {
    sessionId: result.sessionId,
    name: result.originalName,
    kind: result.assetKind ?? (result.metadata.video ? "video" : result.metadata.audio ? "audio" : "unknown"),
    url: result.sourceUrl,
    playbackUrl: result.playbackUrl ?? result.sourceUrl,
    metadata: result.metadata,
    previewGenerated: result.previewGenerated
  };
  state.assets.push(asset);
  state.selectedAssetId = asset.sessionId;
  state.sessionId = asset.sessionId;
  state.source = asset;

  enableEditor(true);
  renderAssetLibrary();
  updateAssetSummary();
  updateOperationPreview();
  if (asset.kind === "video") {
    setMode("source");
  } else {
    setLoading("", false);
    $("emptyStage").classList.remove("hidden");
    $("videoStage").classList.add("hidden");
  }
  $("saveState").textContent = result.previewGenerated ? "Browser-safe preview generated" : `${asset.kind} source ready`;
  log(logMessage, result.metadata);
  if (result.previewGenerated) log("Source codec/container required an automatic H.264/AAC browser preview.");
}

async function uploadSelectedFile() {
  const file = $("fileInput").files[0];
  if (!file) return;

  $("saveState").textContent = "Uploading and probing…";
  setLoading("Uploading and probing source…", true);
  $("emptyStage").classList.add("hidden");
  $("videoStage").classList.remove("hidden");

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: {
        "x-vexa-filename": encodeURIComponent(file.name),
        "content-type": file.type || "application/octet-stream"
      },
      body: file
    });
    const result = await expectJson(response);

    registerImportedAsset(result, "Source uploaded and probed.");
  } catch (error) {
    setLoading("", false);
    $("saveState").textContent = "Upload failed";
    $("emptyStage").classList.remove("hidden");
    $("videoStage").classList.add("hidden");
    log(`Upload failed: ${error.message}`);
  }
}

async function importRemoteMedia() {
  const url = $("remoteMediaUrl").value.trim();
  if (!url) return log("Enter a public HTTPS media URL before importing.");

  $("saveState").textContent = "Importing remote media…";
  setLoading("Downloading and probing remote media…", true);
  $("emptyStage").classList.add("hidden");
  $("videoStage").classList.remove("hidden");
  $("remoteImportButton").disabled = true;

  try {
    const result = await expectJson(await fetch("/api/remote-import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url })
    }));
    registerImportedAsset(result, "Remote media imported and probed.");
  } catch (error) {
    setLoading("", false);
    $("saveState").textContent = "Remote import failed";
    if (!state.source) {
      $("emptyStage").classList.remove("hidden");
      $("videoStage").classList.add("hidden");
    }
    log(`Remote import failed: ${error.message}`);
  } finally {
    $("remoteImportButton").disabled = false;
  }
}

async function readNdjson(response, onItem) {
  if (!response.ok || !response.body) throw new Error(`Render request failed with HTTP ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onItem(JSON.parse(line));
    if (done) break;
  }

  if (buffer.trim()) onItem(JSON.parse(buffer));
}

async function refreshExecutionPlan() {
  if (!state.sessionId) return log("Upload a source video before planning.");
  $("planButton").disabled = true;
  $("executionPlanPreview").textContent = "Planning…";
  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renderPayload())
    });
    const result = await expectJson(response);
    $("executionPlanPreview").textContent = JSON.stringify(result.plan, null, 2);
    log("Optimizer execution plan refreshed.", {
      video: result.plan.video,
      audio: result.plan.audio,
      optimizations: result.plan.optimizations
    });
  } catch (error) {
    $("executionPlanPreview").textContent = `Plan failed: ${error.message}`;
    log(`Execution plan failed: ${error.message}`);
  } finally {
    $("planButton").disabled = !state.sessionId;
  }
}

function displayJob(job) {
  if (!job) return;
  $("jobOutput").textContent = JSON.stringify(job, null, 2);
  state.activeJobId = job.descriptor.id;
  $("jobCancelButton").disabled = ["succeeded", "failed", "cancelled"].includes(job.state);

  const percent = job.progress?.percent;
  if (percent != null) {
    $("renderProgress").value = percent;
    $("progressText").textContent = `${Number(percent).toFixed(1)}%`;
  }
  $("renderState").textContent = `Job · ${job.state}${job.attempt ? ` · attempt ${job.attempt}` : ""}`;

  if (job.state === "succeeded" && job.result && !state.completedJobIds.has(job.descriptor.id)) {
    state.completedJobIds.add(job.descriptor.id);
    state.output = {
      name: job.result.name,
      url: job.result.url,
      playbackUrl: job.result.playbackUrl ?? job.result.url,
      metadata: job.result.metadata,
      previewGenerated: job.result.previewGenerated
    };
    $("renderProgress").value = 100;
    $("progressText").textContent = "100%";
    $("saveState").textContent = "Background render complete";
    updateAssetSummary();
    setMode("output");
    log(`Job ${job.descriptor.id} completed.`, job.result.metadata);
  }
}

function stopJobPolling() {
  if (state.jobPollTimer) clearTimeout(state.jobPollTimer);
  state.jobPollTimer = null;
}

async function pollJob(jobId) {
  stopJobPolling();
  try {
    const result = await expectJson(await fetch(`/api/jobs/${encodeURIComponent(jobId)}`));
    displayJob(result.job);
    if (!["succeeded", "failed", "cancelled"].includes(result.job.state)) {
      state.jobPollTimer = setTimeout(() => pollJob(jobId), 400);
    }
  } catch (error) {
    $("jobOutput").textContent = `Job polling failed: ${error.message}`;
    log(`Job polling failed: ${error.message}`);
  }
}

async function queueRenderJob() {
  if (!state.sessionId || !selectedVideoAsset()) return log("Select a video before queueing a render job.");
  $("jobQueueRenderButton").disabled = true;
  try {
    const idempotencyKey = $("jobIdempotencyKey").value.trim();
    const maxAttempts = Math.max(1, Math.min(5, Math.round(numeric("jobMaxAttempts", 1))));
    const result = await expectJson(await fetch("/api/jobs/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        render: renderPayload(),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        maxAttempts
      })
    }));
    displayJob(result.job);
    log(`Queued render job ${result.job.descriptor.id}.`, {
      idempotencyKey: result.job.descriptor.idempotencyKey ?? null,
      maxAttempts: result.job.descriptor.retry.maxAttempts
    });
    await pollJob(result.job.descriptor.id);
  } catch (error) {
    $("jobOutput").textContent = `Queue failed: ${error.message}`;
    log(`Queue render failed: ${error.message}`);
  } finally {
    $("jobQueueRenderButton").disabled = !selectedVideoAsset();
  }
}

async function cancelActiveJob() {
  if (!state.activeJobId) return;
  try {
    const result = await expectJson(await fetch(`/api/jobs/${encodeURIComponent(state.activeJobId)}/cancel`, {
      method: "POST"
    }));
    displayJob(result.job);
    log(`Cancellation requested for job ${state.activeJobId}.`);
  } catch (error) {
    log(`Job cancellation failed: ${error.message}`);
  }
}

async function refreshJobs() {
  try {
    const result = await expectJson(await fetch("/api/jobs"));
    $("jobOutput").textContent = JSON.stringify(result.jobs, null, 2);
    log(`Refreshed ${result.jobs.length} background job(s).`);
  } catch (error) {
    $("jobOutput").textContent = `Job refresh failed: ${error.message}`;
  }
}

async function renderVideo() {
  if (!state.sessionId) return log("Upload a source video before rendering.");

  state.renderController = new AbortController();
  $("topRenderButton").disabled = true;
  $("cancelButton").classList.remove("hidden");
  $("renderProgress").value = 0;
  $("progressText").textContent = "0%";
  $("renderState").textContent = "Starting";
  $("saveState").textContent = "Rendering…";
  log("Render requested.", renderPayload());

  try {
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renderPayload()),
      signal: state.renderController.signal
    });

    await readNdjson(response, (item) => {
      if (item.type === "progress") {
        const percent = item.progress.percent;
        if (percent != null) {
          $("renderProgress").value = percent;
          $("progressText").textContent = `${percent.toFixed(1)}%`;
        }
        $("renderState").textContent = `${item.progress.processedSeconds.toFixed(1)}s · ${item.progress.speed ?? "?"}x`;
      } else if (item.type === "complete") {
        $("renderProgress").value = 100;
        $("progressText").textContent = "100%";
        $("renderState").textContent = "Complete";
        $("saveState").textContent = "Render complete";
        state.output = {
          name: item.name,
          url: item.url,
          playbackUrl: item.playbackUrl ?? item.url,
          metadata: item.metadata,
          previewGenerated: item.previewGenerated
        };
        updateAssetSummary();
        setMode("output");
        log("Render completed.", item.metadata);
        if (item.previewGenerated) log("Rendered codec required a separate H.264/AAC browser preview.");
      } else if (item.type === "error") {
        throw new Error(`${item.code}: ${item.error}`);
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      $("renderState").textContent = "Cancelled";
      $("saveState").textContent = "Render cancelled";
      log("Render cancelled from the browser.");
    } else {
      $("renderState").textContent = "Failed";
      $("saveState").textContent = "Render failed";
      log(`Render failed: ${error.message}`);
    }
  } finally {
    state.renderController = null;
    $("topRenderButton").disabled = !state.sessionId;
    $("cancelButton").classList.add("hidden");
  }
}

function addGeneratedThumbnail(url) {
  const item = document.createElement("div");
  item.className = "generated-item";
  item.innerHTML = `<img src="${url}?v=${Date.now()}" alt="Generated thumbnail"><div><strong>Thumbnail</strong><div class="muted">Visual SDK output</div></div>`;
  $("generatedAssets").prepend(item);
}

function addGeneratedAudio(url, label) {
  const item = document.createElement("div");
  item.className = "generated-item";
  item.innerHTML = `<div><strong>${label}</strong></div><audio controls src="${url}?v=${Date.now()}"></audio>`;
  $("generatedAssets").prepend(item);
}

function addGeneratedWaveform(url) {
  const item = document.createElement("div");
  item.className = "generated-item waveform-item";
  item.innerHTML = `<img src="${url}?v=${Date.now()}" alt="Generated audio waveform"><div><strong>Waveform</strong><div class="muted">Audio engine visualization</div></div>`;
  $("generatedAssets").prepend(item);
}

async function planAudioEngine() {
  const payload = audioEnginePayload();
  if (!payload) return log("Select an asset with audio before planning audio processing.");
  $("audioEngineOutput").textContent = "Planning audio pipeline…";
  try {
    const result = await expectJson(await fetch("/api/audio-engine/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
    $("audioEngineOutput").textContent = JSON.stringify(result.plan, null, 2);
    log("Audio execution plan refreshed.", { optimizations: result.plan.optimizations });
  } catch (error) {
    $("audioEngineOutput").textContent = `Audio plan failed: ${error.message}`;
    log(`Audio plan failed: ${error.message}`);
  }
}

async function processAudioEngine() {
  const payload = audioEnginePayload();
  if (!payload) return log("Select an asset with audio before processing it.");
  $("audioProcessButton").disabled = true;
  $("audioEngineOutput").textContent = "Processing audio…";
  try {
    const result = await expectJson(await fetch("/api/audio-engine/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
    addGeneratedAudio(result.url, `Processed ${payload.codec.toUpperCase()} audio`);
    $("audioEngineOutput").textContent = JSON.stringify(result.plan, null, 2);
    log("Audio processing completed.", result.metadata);
  } catch (error) {
    $("audioEngineOutput").textContent = `Audio processing failed: ${error.message}`;
    log(`Audio processing failed: ${error.message}`);
  } finally {
    $("audioProcessButton").disabled = !selectedAudioAsset();
  }
}

async function detectAudioSilence() {
  const asset = selectedAudioAsset();
  if (!asset) return log("Select an asset with audio before detecting silence.");
  $("audioEngineOutput").textContent = "Detecting silence…";
  try {
    const result = await expectJson(await fetch("/api/audio-engine/silence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: asset.sessionId,
        noiseDb: numeric("audioSilenceNoise", -40),
        minDuration: numeric("audioSilenceDuration", 0.5)
      })
    }));
    $("audioEngineOutput").textContent = JSON.stringify(result, null, 2);
    log(`Detected ${result.ranges.length} silence range(s).`, result.ranges);
  } catch (error) {
    $("audioEngineOutput").textContent = `Silence detection failed: ${error.message}`;
    log(`Silence detection failed: ${error.message}`);
  }
}

async function generateAudioWaveform() {
  const asset = selectedAudioAsset();
  if (!asset) return log("Select an asset with audio before generating a waveform.");
  $("audioEngineOutput").textContent = "Generating waveform…";
  try {
    const result = await expectJson(await fetch("/api/audio-engine/waveform", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: asset.sessionId, width: 1200, height: 240 })
    }));
    addGeneratedWaveform(result.url);
    $("audioEngineOutput").textContent = `Waveform generated: ${result.name}`;
    log("Waveform generated.");
  } catch (error) {
    $("audioEngineOutput").textContent = `Waveform generation failed: ${error.message}`;
    log(`Waveform generation failed: ${error.message}`);
  }
}

async function parseCaptionSource() {
  const payload = captionPayload();
  if (!payload) return log("Select a video asset before parsing captions.");
  $("captionOutput").textContent = "Parsing captions…";
  try {
    const result = await expectJson(await fetch("/api/captions/parse", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    }));
    state.captionDocument = result.document;
    $("captionIncludeRender").checked = true;
    $("captionOutput").textContent = JSON.stringify(result.document, null, 2);
    syncCaptionRenderState();
    log(`Parsed ${result.document.cues.length} caption cue(s). Captions are now live in the source preview and included by Render.`);
  } catch (error) {
    state.captionDocument = null;
    syncCaptionRenderState();
    $("captionOutput").textContent = `Caption parse failed: ${error.message}`;
    log(`Caption parse failed: ${error.message}`);
  }
}

async function planCaptionBurn() {
  const payload = captionPayload();
  if (!payload) return log("Select a video asset before planning captions.");
  $("captionOutput").textContent = "Planning caption burn-in…";
  try {
    const result = await expectJson(await fetch("/api/captions/plan", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    }));
    $("captionOutput").textContent = JSON.stringify(result.plan, null, 2);
    log("Caption burn-in plan created.", result.plan.optimizations);
  } catch (error) {
    $("captionOutput").textContent = `Caption planning failed: ${error.message}`;
    log(`Caption planning failed: ${error.message}`);
  }
}

async function burnCaptionsFromEditor() {
  const payload = captionPayload();
  if (!payload) return log("Select a video asset before burning captions.");
  state.renderController = new AbortController();
  $("captionBurnButton").disabled = true;
  $("cancelButton").classList.remove("hidden");
  $("renderProgress").value = 0;
  $("progressText").textContent = "0%";
  $("captionOutput").textContent = "Burning captions…";
  try {
    const response = await fetch("/api/captions/burn", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: state.renderController.signal
    });
    await readNdjson(response, (item) => {
      if (item.type === "progress") {
        const percent = item.progress.percent;
        if (percent != null) { $("renderProgress").value = percent; $("progressText").textContent = `${percent.toFixed(1)}%`; }
        $("renderState").textContent = `Captions · ${item.progress.processedSeconds.toFixed(1)}s`;
      } else if (item.type === "complete") {
        state.output = { name:item.name, url:item.url, playbackUrl:item.playbackUrl ?? item.url, metadata:item.metadata, previewGenerated:item.previewGenerated };
        $("renderProgress").value = 100; $("progressText").textContent = "100%"; $("renderState").textContent = "Complete";
        $("captionOutput").textContent = JSON.stringify(item.document, null, 2);
        updateAssetSummary(); setMode("output");
        log("Caption burn-in completed.", item.metadata);
      } else if (item.type === "error") { throw new Error(`${item.code}: ${item.error}`); }
    });
  } catch (error) {
    if (error.name === "AbortError") log("Caption burn-in cancelled."); else log(`Caption burn-in failed: ${error.message}`);
    $("captionOutput").textContent = `Caption burn-in failed: ${error.message}`;
  } finally {
    state.renderController = null;
    $("captionBurnButton").disabled = !selectedVideoAsset();
    $("cancelButton").classList.add("hidden");
  }
}

async function createThumbnail() {
  if (!state.sessionId) return;
  try {
    const result = await expectJson(await fetch("/api/thumbnail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        ...editPayload(),
        at: numeric("thumbnailAt", 0),
        quality: numeric("thumbnailQuality", 3)
      })
    }));
    addGeneratedThumbnail(result.url);
    log("Thumbnail generated.");
  } catch (error) {
    log(`Thumbnail failed: ${error.message}`);
  }
}

async function extractAudio() {
  if (!state.sessionId) return;
  try {
    const codec = $("extractCodec").value;
    const result = await expectJson(await fetch("/api/audio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        ...editPayload(),
        codec,
        bitrate: $("extractBitrate").value.trim() || undefined
      })
    }));
    addGeneratedAudio(result.url, `${codec.toUpperCase()} audio`);
    log("Audio extracted.");
  } catch (error) {
    log(`Audio extraction failed: ${error.message}`);
  }
}

function chooseFile() {
  $("fileInput").click();
}

["topUploadButton", "mediaUploadButton", "dropZone", "stageUploadButton"].forEach((id) => {
  $(id).addEventListener("click", chooseFile);
});
$("fileInput").addEventListener("change", uploadSelectedFile);
$("remoteImportButton").addEventListener("click", importRemoteMedia);
$("remoteMediaUrl").addEventListener("keydown", (event) => {
  if (event.key === "Enter") importRemoteMedia();
});

$("topRenderButton").addEventListener("click", () => {
  if (state.editorMode === "project") return renderProject();
  if (state.captionDocument && $("captionIncludeRender").checked && selectedVideoAsset()) {
    return burnCaptionsFromEditor();
  }
  return renderVideo();
});
$("cancelButton").addEventListener("click", () => state.renderController?.abort());
$("thumbnailButton").addEventListener("click", createThumbnail);
$("audioButton").addEventListener("click", extractAudio);
$("audioPlanButton").addEventListener("click", planAudioEngine);
$("audioProcessButton").addEventListener("click", processAudioEngine);
$("audioSilenceButton").addEventListener("click", detectAudioSilence);
$("audioWaveformButton").addEventListener("click", generateAudioWaveform);
$("captionParseButton").addEventListener("click", parseCaptionSource);
$("captionPlanButton").addEventListener("click", planCaptionBurn);
$("captionBurnButton").addEventListener("click", burnCaptionsFromEditor);
$("streamPlanButton").addEventListener("click", planStreamingPackage);
$("streamPackageButton").addEventListener("click", createStreamingPackage);
$("streamSpriteButton").addEventListener("click", generateStreamingSprite);
$("jobQueueRenderButton").addEventListener("click", queueRenderJob);
$("jobCancelButton").addEventListener("click", cancelActiveJob);
$("jobRefreshButton").addEventListener("click", refreshJobs);
$("captionIncludeRender").addEventListener("change", syncCaptionRenderState);
for (const id of ["captionFormat", "captionTemplate", "captionFontSize", "captionPosition", "captionAnimation", "captionColor", "captionBackground", "captionSource"]) {
  const element = $(id);
  element.addEventListener(id === "captionSource" || id === "captionFontSize" || id === "captionColor" || id === "captionBackground" ? "input" : "change", invalidateCaptionPreview);
}
$("clipTimelineButton").addEventListener("click", () => setEditorMode("clip"));
$("projectTimelineButton").addEventListener("click", () => setEditorMode("project"));
$("addAssetToTimelineButton").addEventListener("click", addSelectedAssetToTimeline);
$("addTextToTimelineButton").addEventListener("click", addTextToTimeline);
$("applyProjectClipButton").addEventListener("click", applySelectedProjectClip);
$("removeProjectClipButton").addEventListener("click", removeSelectedProjectClip);
$("projectTrackUpButton").addEventListener("click", () => moveSelectedTrack(-1));
$("projectTrackDownButton").addEventListener("click", () => moveSelectedTrack(1));
$("projectTrackVisibleButton").addEventListener("click", () => toggleSelectedTrack("hidden"));
$("projectTrackMuteButton").addEventListener("click", () => toggleSelectedTrack("muted"));
$("projectTrackLockButton").addEventListener("click", () => toggleSelectedTrack("locked"));
$("clearTimelineButton").addEventListener("click", clearProjectTimeline);
$("projectPlanButton").addEventListener("click", refreshProjectPlan);
$("projectRenderButton").addEventListener("click", renderProject);
for (const id of ["projectWidth", "projectHeight", "projectFps", "projectBackground"]) {
  $(id).addEventListener("change", syncProjectCanvas);
}
$("forcePreviewButton").addEventListener("click", () => ensureCompatiblePreview(state.mode === "output" ? state.output?.name : undefined));
$("playbackFallbackButton").addEventListener("click", () => ensureCompatiblePreview(state.mode === "output" ? state.output?.name : undefined));

[$("sourceTab"), $("sourceAsset")].forEach((element) => element.addEventListener("click", () => setMode("source")));
[$("outputTab"), $("outputAsset")].forEach((element) => element.addEventListener("click", () => setMode("output")));

const video = $("editorVideo");
video.addEventListener("loadedmetadata", () => {
  setLoading("", false);
  setPlaybackError("", false);
  syncTransport();
  updateTimelineSelection();
  updateCaptionPreview();
});
video.addEventListener("canplay", () => setLoading("", false));
video.addEventListener("timeupdate", () => {
  updatePlayhead();
  updateCaptionPreview();
});
video.addEventListener("play", syncTransport);
video.addEventListener("pause", syncTransport);
video.addEventListener("ended", syncTransport);
video.addEventListener("error", () => {
  setLoading("", false);
  const media = mediaForMode();
  if (!media) return;
  const alreadyPreview = media.playbackUrl !== media.url;
  if (!alreadyPreview && !state.fallbackInFlight) {
    ensureCompatiblePreview(state.mode === "output" ? state.output?.name : undefined);
    return;
  }
  setPlaybackError("The browser could not decode this preview. Check the acceptance log and FFmpeg output.", true);
});

$("playButton").addEventListener("click", () => video.paused ? video.play() : video.pause());
$("backFiveButton").addEventListener("click", () => { video.currentTime = Math.max(0, video.currentTime - 5); });
$("forwardFiveButton").addEventListener("click", () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); });
$("seekBar").addEventListener("input", () => { video.currentTime = Number($("seekBar").value); });
$("muteButton").addEventListener("click", () => { video.muted = !video.muted; syncTransport(); });
$("playbackRate").addEventListener("change", () => { video.playbackRate = Number($("playbackRate").value); });
$("fullscreenButton").addEventListener("click", toggleFullscreenPreview);
document.addEventListener("fullscreenchange", syncFullscreenButton);
window.addEventListener("resize", updateCaptionPreview);

$("timelineCanvas").addEventListener("click", (event) => {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const rect = $("timelineCanvas").getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  video.currentTime = (x / rect.width) * video.duration;
});

$("fitSegmented").querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => {
    $("resizeFit").value = button.dataset.fit;
    $("fitSegmented").querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    updateOperationPreview();
  });
});

$("transformSection").parentElement.querySelectorAll("[data-rotate]").forEach((button) => {
  button.addEventListener("click", () => {
    $("rotateEnabled").checked = true;
    $("rotateDegrees").value = button.dataset.rotate;
    updateOperationPreview();
  });
});

for (const element of document.querySelectorAll("input, select")) {
  if (element.id === "fileInput" || element.id === "seekBar" || element.id === "playbackRate") continue;
  element.addEventListener("input", updateOperationPreview);
  element.addEventListener("change", updateOperationPreview);
}



const drawerSectionTitles = {
  projectSection: "Project",
  audioSection: "Audio",
  captionsSection: "Captions",
  streamingSection: "Streaming",
  hardwareSection: "Hardware",
  jobsSection: "Jobs"
};
let lastDrawerSectionId = "projectSection";
let drawerReturnFocus = null;

function openControlDrawer(sectionId = lastDrawerSectionId, title) {
  const drawer = $("secondaryDrawer");
  const backdrop = $("drawerBackdrop");
  const target = $(sectionId);
  if (!drawer || !target) return;

  const wasOpen = drawer.classList.contains("open");
  if (!wasOpen && document.activeElement instanceof HTMLElement) drawerReturnFocus = document.activeElement;

  lastDrawerSectionId = sectionId;
  $("drawerTitle").textContent = title ?? drawerSectionTitles[sectionId] ?? "Controls";
  drawer.classList.add("open");
  backdrop.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.setAttribute("aria-hidden", "false");
  $("openControlsDrawer").setAttribute("aria-expanded", "true");
  document.body.classList.add("drawer-open");

  document.querySelectorAll("[data-drawer-jump]").forEach((button) => {
    button.classList.toggle("active", button.dataset.drawerJump === sectionId);
  });

  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!wasOpen) $("drawerCloseButton").focus({ preventScroll: true });
  });
}

function closeControlDrawer() {
  const drawer = $("secondaryDrawer");
  const backdrop = $("drawerBackdrop");
  if (!drawer || !backdrop) return;
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  backdrop.setAttribute("aria-hidden", "true");
  $("openControlsDrawer").setAttribute("aria-expanded", "false");
  document.body.classList.remove("drawer-open");
  if (drawerReturnFocus instanceof HTMLElement && drawerReturnFocus.isConnected) {
    drawerReturnFocus.focus({ preventScroll: true });
  }
  drawerReturnFocus = null;
}

$("jsonTabButton").addEventListener("click", () => {
  $("jsonTabButton").classList.add("active");
  $("inspectorContent").classList.add("hidden");
  $("payloadContent").classList.remove("hidden");
  $("jsonTabButton").previousElementSibling.classList.remove("active");
});
$("jsonTabButton").previousElementSibling.addEventListener("click", (event) => {
  event.currentTarget.classList.add("active");
  $("jsonTabButton").classList.remove("active");
  $("inspectorContent").classList.remove("hidden");
  $("payloadContent").classList.add("hidden");
});

$("hardwareDetectButton").addEventListener("click", detectHardware);
$("hardwareBenchmarkButton").addEventListener("click", benchmarkHardware);
$("planButton").addEventListener("click", refreshExecutionPlan);
$("clearLogButton").addEventListener("click", () => { $("logOutput").textContent = "Log cleared."; });


$("openControlsDrawer").addEventListener("click", () => openControlDrawer(lastDrawerSectionId));
$("drawerCloseButton").addEventListener("click", closeControlDrawer);
$("drawerBackdrop").addEventListener("click", closeControlDrawer);
document.querySelectorAll("[data-drawer-jump]").forEach((button) => {
  button.addEventListener("click", () => openControlDrawer(button.dataset.drawerJump));
});

document.querySelectorAll(".rail-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".rail-button").forEach((item) => item.classList.toggle("active", item === button));
    const target = $(button.dataset.section);
    if (!target) return;

    if (target.closest("#secondaryDrawer")) {
      openControlDrawer(button.dataset.section, button.dataset.drawerTitle);
      return;
    }

    closeControlDrawer();
    if (target.closest(".inspector-content")) {
      $("jsonTabButton").previousElementSibling.click();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("secondaryDrawer")?.classList.contains("open")) {
    closeControlDrawer();
    return;
  }
  if (event.code === "Space" && !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    if (!video.paused) video.pause(); else if (!$("playButton").disabled) video.play();
  }
});

enableEditor(false);
renderAssetLibrary();
setEditorMode("clip");
updateOperationPreview();
syncTransport();

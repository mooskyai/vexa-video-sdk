import {
  createProgrammableSceneRenderGraph,
  evaluateExecutableComposition,
  getExecutableCompositionStaticMetadata
} from "@vexa-video/core/browser";
import { createVexaStudioSession } from "@vexa-video/studio";

const $ = (id) => document.getElementById(id);

const state = {
  session: null,
  unsubscribeSession: null,
  executables: new Map(),
  manifest: null,
  scene: null,
  active: false,
  busy: false,
  draftText: "{}",
  draftDirty: false,
  renderController: null,
  renderResult: null,
  renderProgress: null,
  raf: 0,
  lastTick: 0,
  log: [],
  eventSource: null,
  hotReloadTimer: 0,
  pendingHotReload: null,
  lastHotReloadRevision: 0,
  watchConnected: false,
  lastError: null
};

function installWorkspace() {
  const railAnchor = $("bundlerRailButton") ?? $("playerRailButton");
  railAnchor.insertAdjacentHTML(
    "afterend",
    '<button id="studioRailButton" class="rail-button" type="button" title="Vexa Studio"><span>V</span><small>Studio</small></button>'
  );
  const tabAnchor = $("bundlerTab") ?? $("playerTab");
  tabAnchor.insertAdjacentHTML(
    "afterend",
    '<button id="studioTab" class="mode-tab" type="button">Studio</button>'
  );

  document.querySelector(".stage-wrap").insertAdjacentHTML(
    "beforeend",
    `<div id="studioWorkspace" class="studio-workspace hidden" aria-label="Vexa Studio workspace">
      <header class="studio-heading">
        <div>
          <span class="kicker">Programmable development</span>
          <h1>Vexa Studio</h1>
          <p>Preview, inspect props and metadata, scrub frames, and render the selected composition from one local workspace.</p>
        </div>
        <div class="studio-heading-actions">
          <span id="studioWatchState" class="studio-watch-state" data-tone="idle"><i></i><span>Watch idle</span></span>
          <span id="studioStatus" class="studio-status">Ready</span>
          <button id="studioReloadButton" class="button secondary compact" type="button">Reload bundle</button>
          <button id="studioFullscreenButton" class="button secondary compact" type="button">Full screen</button>
        </div>
      </header>

      <div class="studio-shell-grid">
        <aside class="studio-panel studio-compositions-panel">
          <div class="studio-panel-title"><strong>Compositions</strong><span id="studioCompositionCount">0</span></div>
          <div id="studioCompositionList" class="studio-composition-list">
            <p class="studio-empty">Open Studio to build the development bundle.</p>
          </div>
        </aside>

        <section class="studio-preview-column">
          <div class="studio-preview-toolbar">
            <div>
              <strong id="studioPreviewTitle">No composition</strong>
              <span id="studioPreviewMeta">—</span>
            </div>
            <div class="studio-preview-actions">
              <button id="studioStepBack" class="transport-button" type="button" title="Previous frame">−1f</button>
              <button id="studioPlay" class="play-button" type="button" aria-label="Play Studio preview">▶</button>
              <button id="studioStepForward" class="transport-button" type="button" title="Next frame">+1f</button>
            </div>
          </div>
          <div id="studioPreviewStage" class="studio-preview-stage">
            <div id="studioSceneSurface" class="studio-scene-surface">
              <div class="studio-preview-empty">Build the development bundle to start Studio.</div>
            </div>
            <div id="studioFrameBadge" class="studio-frame-badge">Frame 0</div>
            <div id="studioErrorOverlay" class="studio-error-overlay hidden" role="alert" aria-live="assertive">
              <div class="studio-error-card">
                <span class="kicker">Studio error</span>
                <strong id="studioErrorTitle">Composition error</strong>
                <pre id="studioErrorMessage"></pre>
                <div class="studio-error-actions">
                  <button id="studioErrorLogs" class="button secondary compact" type="button">Open logs</button>
                  <button id="studioErrorDismiss" class="button secondary compact" type="button">Dismiss</button>
                </div>
              </div>
            </div>
          </div>
          <div class="studio-timeline">
            <div class="studio-timeline-header">
              <strong>Playhead</strong>
              <span id="studioTimeReadout">0.00s · frame 0</span>
            </div>
            <input id="studioSeek" type="range" min="0" max="0" step="1" value="0" aria-label="Studio playhead">
            <div class="studio-timeline-footer">
              <span id="studioTimelineStart">0</span>
              <span id="studioTimelineDuration">1 frame</span>
              <label>Zoom <input id="studioTimelineZoom" type="range" min="30" max="220" step="10" value="80"></label>
            </div>
          </div>
        </section>

        <aside class="studio-panel studio-inspector-panel">
          <div class="studio-tabs" role="tablist" aria-label="Studio inspector">
            <button class="active" data-studio-panel="props">Props</button>
            <button data-studio-panel="metadata">Metadata</button>
            <button data-studio-panel="assets">Assets</button>
            <button data-studio-panel="console">Console</button>
          </div>
          <div class="studio-inspector-scroll">
            <section class="studio-inspector-section" data-studio-content="props">
              <div class="studio-section-heading"><strong>Input props</strong><span id="studioPropsState">resolved</span></div>
              <textarea id="studioProps" spellcheck="false" aria-label="Composition props">{}</textarea>
              <div id="studioValidation" class="studio-validation hidden"></div>
              <button id="studioApplyProps" class="button primary full" type="button">Apply props</button>
            </section>

            <section class="studio-inspector-section hidden" data-studio-content="metadata">
              <div class="studio-section-heading"><strong>Resolved metadata</strong><span>live</span></div>
              <pre id="studioMetadata">No metadata yet.</pre>
            </section>

            <section class="studio-inspector-section hidden" data-studio-content="assets">
              <div class="studio-section-heading"><strong>Scene assets</strong><span id="studioAssetCount">0</span></div>
              <div id="studioAssets" class="studio-assets"><p class="studio-empty">No scene evaluated.</p></div>
            </section>

            <section class="studio-inspector-section hidden" data-studio-content="console">
              <div class="studio-section-heading"><strong>Studio console</strong><button id="studioClearConsole" class="text-button" type="button">Clear</button></div>
              <pre id="studioConsole">Studio ready.</pre>
            </section>

            <section class="studio-render-card">
              <div class="studio-section-heading"><strong>Render</strong><span>Node renderer</span></div>
              <div class="studio-render-controls">
                <label>Target <select id="studioRenderTarget" class="compact-select"></select></label>
                <label>Hardware
                  <select id="studioHardware" class="compact-select">
                    <option value="cpu">CPU</option>
                    <option value="auto">Auto</option>
                    <option value="nvidia">NVIDIA</option>
                    <option value="intel">Intel</option>
                    <option value="amd">AMD</option>
                    <option value="apple">Apple</option>
                  </select>
                </label>
              </div>
              <div class="studio-render-actions">
                <button id="studioRenderButton" class="button primary" type="button">Render</button>
                <button id="studioCancelRender" class="button secondary" type="button" disabled>Cancel</button>
              </div>
              <div class="studio-render-progress">
                <progress id="studioRenderProgress" max="100" value="0"></progress>
                <span id="studioRenderProgressText">Ready</span>
              </div>
              <div id="studioRenderOutput" class="studio-render-output"><p>Rendered output appears here.</p></div>
            </section>
          </div>
        </aside>
      </div>
    </div>`
  );
}

function log(message, detail) {
  const stamp = new Date().toLocaleTimeString();
  const suffix = detail === undefined ? "" : `\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`;
  state.log.push(`[${stamp}] ${message}${suffix}`);
  if (state.log.length > 120) state.log.splice(0, state.log.length - 120);
  if ($("studioConsole")) {
    $("studioConsole").textContent = state.log.join("\n\n") || "Studio ready.";
    $("studioConsole").scrollTop = $("studioConsole").scrollHeight;
  }
}

function setStatus(label, tone = "") {
  const status = $("studioStatus");
  status.textContent = label;
  status.dataset.tone = tone;
}

function setWatchState(label, tone = "idle", revision = state.lastHotReloadRevision) {
  const element = $("studioWatchState");
  if (!element) return;
  element.dataset.tone = tone;
  element.dataset.revision = String(revision);
  const copy = element.querySelector("span");
  if (copy) copy.textContent = label;
}

function studioErrorMessage(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error ?? "Unknown Studio error");
}

function showStudioError(title, error) {
  state.lastError = { title, message: studioErrorMessage(error), at: Date.now() };
  const overlay = $("studioErrorOverlay");
  if (!overlay) return;
  $("studioErrorTitle").textContent = title;
  $("studioErrorMessage").textContent = state.lastError.message;
  overlay.classList.remove("hidden");
}

function clearStudioError() {
  state.lastError = null;
  $("studioErrorOverlay")?.classList.add("hidden");
}

function openStudioPanel(panel) {
  document.querySelector(`[data-studio-panel="${panel}"]`)?.click();
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const diagnostic = payload.diagnostics?.[0];
    const suffix = diagnostic?.file ? ` · ${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}` : "";
    throw new Error(`${payload.code ?? "STUDIO_HOST_ERROR"}: ${payload.error ?? "Request failed"}${suffix}`);
  }
  return payload;
}

async function requestNdjson(path, options, onEvent) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`${payload.code ?? "STUDIO_RENDER_ERROR"}: ${payload.error ?? "Render request failed"}`);
  }
  if (!response.body) throw new Error("Studio render response stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(`${event.code ?? "STUDIO_RENDER_ERROR"}: ${event.error ?? "Render failed"}`);
    onEvent(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
}

function bundleUrl(path) {
  const clean = String(path).replace(/^\.\//u, "").split("/").map(encodeURIComponent).join("/");
  return `/composition-bundle/${clean}`;
}

function installBundleCss(manifest) {
  const existing = $("studioBundleCss");
  if (!manifest.cssEntry) {
    existing?.remove();
    return;
  }
  const link = existing ?? document.createElement("link");
  link.id = "studioBundleCss";
  link.rel = "stylesheet";
  link.href = `${bundleUrl(manifest.cssEntry)}?v=${Date.now()}`;
  if (!existing) document.head.append(link);
}

function selectedExecutable() {
  const id = state.session?.getSnapshot().selectedComposition.id;
  return id ? state.executables.get(id) ?? null : null;
}

function resolvedRenderTargetOptions(snapshot) {
  return snapshot.resolvedMetadata.kind === "video"
    ? [["frame", "Current frame"], ["video", "Full video"]]
    : [["still", "Still image"]];
}

function syncRenderTargets(snapshot) {
  const select = $("studioRenderTarget");
  const previous = select.value;
  const options = resolvedRenderTargetOptions(snapshot);
  select.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  if (options.some(([value]) => value === previous)) select.value = previous;
  $("studioHardware").disabled = select.value !== "video" || state.renderController !== null;
}

function renderCompositions(snapshot) {
  $("studioCompositionCount").textContent = String(snapshot.compositions.length);
  const list = $("studioCompositionList");
  list.replaceChildren(...snapshot.compositions.map((composition) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `studio-composition${composition.id === snapshot.selectedComposition.id ? " active" : ""}`;
    const timing = composition.kind === "video" ? `${composition.durationInFrames}f · ${composition.fps}fps` : "still";
    button.innerHTML = `<strong>${composition.id}</strong><span>${composition.width}×${composition.height} · ${timing}</span>`;
    button.addEventListener("click", () => void selectComposition(composition.id));
    return button;
  }));
}

function resolvedSceneAssetUrl(asset) {
  if (asset?.source?.kind !== "static") return null;
  const src = String(asset.source.src ?? "");
  if (!src) return null;
  if (/^(?:https?:|data:|blob:|\/)/u.test(src)) return src;
  return bundleUrl(src);
}

function accumulatedTransform(item) {
  const result = { x: 0, y: 0, width: undefined, height: undefined };
  for (const transform of item.transformChain ?? []) {
    if (Number.isFinite(transform.x)) result.x += transform.x;
    if (Number.isFinite(transform.y)) result.y += transform.y;
    if (Number.isFinite(transform.width)) result.width = transform.width;
    if (Number.isFinite(transform.height)) result.height = transform.height;
  }
  return result;
}

function positionSceneNode(element, item, scene) {
  const transform = accumulatedTransform(item);
  element.style.left = `${transform.x / scene.width * 100}%`;
  element.style.top = `${transform.y / scene.height * 100}%`;
  if (transform.width !== undefined) element.style.width = `${transform.width / scene.width * 100}%`;
  if (transform.height !== undefined) element.style.height = `${transform.height / scene.height * 100}%`;
  element.style.opacity = String(item.opacity ?? 1);
  element.style.zIndex = String(100 + item.zIndex);
}

function renderScene(snapshot) {
  const container = $("studioSceneSurface");
  container.replaceChildren();
  const scene = state.scene;
  if (!scene) {
    const empty = document.createElement("div");
    empty.className = "studio-preview-empty";
    empty.textContent = snapshot.validationError ?? "Evaluate the selected composition to preview its scene.";
    container.append(empty);
    return;
  }

  container.style.background = scene.background ?? "#05080d";
  container.style.aspectRatio = `${scene.width} / ${scene.height}`;
  const graph = createProgrammableSceneRenderGraph(scene);
  for (const item of graph.items) {
    if (snapshot.frame < item.absoluteStartFrame || snapshot.frame >= item.absoluteEndFrame) continue;
    const node = item.node;
    let element = null;

    if (node.kind === "fill") {
      element = document.createElement("div");
      element.style.inset = "0";
      element.style.background = node.color;
    } else if (node.kind === "solid") {
      element = document.createElement("div");
      element.style.background = node.color;
      element.style.width = `${node.width / scene.width * 100}%`;
      element.style.height = `${node.height / scene.height * 100}%`;
    } else if (node.kind === "text") {
      element = document.createElement("div");
      element.className = "studio-scene-text";
      element.textContent = node.text;
      if (node.style?.color) element.style.color = node.style.color;
      if (Number.isFinite(node.style?.fontSize)) element.style.fontSize = `${Math.max(8, node.style.fontSize / scene.height * 100)}cqh`;
      if (node.style?.boxColor) element.style.background = node.style.boxColor;
    } else if (node.kind === "image") {
      const asset = scene.assets.find((candidate) => candidate.id === node.assetId);
      const source = resolvedSceneAssetUrl(asset);
      if (source) {
        element = document.createElement("img");
        element.src = source;
        element.alt = node.id;
        element.style.objectFit = node.fit ?? "contain";
      }
    } else if (node.kind === "video") {
      const asset = scene.assets.find((candidate) => candidate.id === node.assetId);
      const source = resolvedSceneAssetUrl(asset);
      if (source) {
        element = document.createElement("video");
        element.src = source;
        element.muted = true;
        element.playsInline = true;
        element.preload = "metadata";
        element.style.objectFit = node.fit ?? "contain";
      }
    }

    if (!element) {
      if (node.kind === "audio") continue;
      element = document.createElement("div");
      element.className = "studio-scene-placeholder";
      element.textContent = `${node.kind}: ${node.id}`;
    }
    element.classList.add("studio-scene-node");
    if (node.kind !== "fill") positionSceneNode(element, item, scene);
    container.append(element);
  }
}

function renderAssets() {
  const assets = state.scene?.assets ?? [];
  $("studioAssetCount").textContent = String(assets.length);
  const container = $("studioAssets");
  if (!assets.length) {
    container.innerHTML = '<p class="studio-empty">This scene has no declared assets.</p>';
    return;
  }
  container.replaceChildren(...assets.map((asset) => {
    const row = document.createElement("div");
    row.className = "studio-asset-row";
    const source = asset.source.kind === "static"
      ? asset.source.src
      : `${asset.source.source.kind}${asset.source.source.kind === "object" ? `:${asset.source.source.provider}` : ""}`;
    row.innerHTML = `<div><strong>${asset.id}</strong><span>${asset.kind}</span></div><code>${source}</code>`;
    return row;
  }));
}

function renderMetadata(snapshot) {
  $("studioMetadata").textContent = JSON.stringify({
    selected: snapshot.selectedComposition,
    resolved: snapshot.resolvedMetadata,
    frame: snapshot.frame,
    timeline: {
      playheadSeconds: snapshot.timeline.playheadSeconds,
      zoom: snapshot.timeline.viewport.zoom,
      scrollSeconds: snapshot.timeline.viewport.scrollSeconds
    }
  }, null, 2);
}

function renderSnapshot(snapshot = state.session?.getSnapshot()) {
  if (!snapshot) return;
  const metadata = snapshot.resolvedMetadata;
  const duration = metadata.kind === "video" ? metadata.durationInFrames : 1;
  const fps = metadata.kind === "video" ? metadata.fps : 1;
  $("studioPreviewTitle").textContent = snapshot.selectedComposition.id;
  $("studioPreviewMeta").textContent = `${metadata.width}×${metadata.height} · ${metadata.kind === "video" ? `${fps}fps · ${duration} frames` : "still"}`;
  $("studioFrameBadge").textContent = `Frame ${snapshot.frame}`;
  $("studioTimeReadout").textContent = `${(snapshot.frame / fps).toFixed(2)}s · frame ${snapshot.frame}`;
  $("studioTimelineDuration").textContent = `${duration} frame${duration === 1 ? "" : "s"}`;
  $("studioSeek").max = String(Math.max(0, duration - 1));
  $("studioSeek").value = String(snapshot.frame);
  $("studioPlay").textContent = snapshot.playing ? "Ⅱ" : "▶";
  $("studioPlay").disabled = metadata.kind !== "video";
  $("studioStepBack").disabled = metadata.kind !== "video";
  $("studioStepForward").disabled = metadata.kind !== "video";
  const propsDraft = state.draftDirty || snapshot.propsDirty;
  $("studioPropsState").textContent = snapshot.validationError ? "invalid" : propsDraft ? "draft" : "resolved";
  $("studioPropsState").dataset.tone = snapshot.validationError ? "error" : propsDraft ? "draft" : "success";
  const validation = $("studioValidation");
  validation.classList.toggle("hidden", !snapshot.validationError);
  validation.textContent = snapshot.validationError ?? "";
  if (!state.draftDirty && document.activeElement !== $("studioProps")) {
    state.draftText = JSON.stringify(snapshot.props, null, 2);
    $("studioProps").value = state.draftText;
  }
  $("studioTimelineZoom").value = String(snapshot.timeline.viewport.zoom);
  renderCompositions(snapshot);
  renderScene(snapshot);
  renderAssets();
  renderMetadata(snapshot);
  syncRenderTargets(snapshot);
}

async function evaluateSelected({ useDraft = false } = {}) {
  if (!state.session) return;
  const executable = selectedExecutable();
  if (!executable) throw new Error("Selected composition has no executable browser export.");

  let props = state.session.getSnapshot().props;
  if (useDraft) {
    let parsed;
    try {
      parsed = JSON.parse($("studioProps").value);
    } catch (error) {
      state.session.setValidationError(`Props JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
      showStudioError("Invalid props JSON", error);
      log("Props validation failed.", error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      const error = new Error("Props JSON must be an object.");
      state.session.setValidationError(error);
      showStudioError("Invalid props", error);
      log("Props validation failed.", error.message);
      throw error;
    }
    state.session.setProps(parsed);
    props = state.session.getSnapshot().props;
  }

  try {
    const evaluated = await evaluateExecutableComposition(executable, props);
    state.scene = evaluated.scene;
    state.session.applyResolvedComposition(evaluated.resolved);
    state.draftDirty = false;
    state.draftText = JSON.stringify(evaluated.resolved.props, null, 2);
    $("studioProps").value = state.draftText;
    clearStudioError();
    log(`Evaluated ${evaluated.resolved.metadata.id}.`, evaluated.resolved.metadata);
  } catch (error) {
    state.scene = null;
    state.session.setValidationError(error instanceof Error ? error : String(error));
    showStudioError("Composition evaluation failed", error);
    log("Composition evaluation failed.", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function selectComposition(id) {
  if (!state.session || state.busy) return;
  state.session.selectComposition(id);
  state.scene = null;
  state.draftDirty = false;
  state.draftText = JSON.stringify(state.session.getSnapshot().props, null, 2);
  $("studioProps").value = state.draftText;
  try {
    await evaluateSelected();
  } catch {
    // The session already carries the typed validation message.
  }
}

async function loadBundle({ preserve = true, reason = "manual" } = {}) {
  if (state.busy || (reason === "hot-reload" && state.renderController)) {
    if (reason === "hot-reload") state.pendingHotReload = { revision: state.lastHotReloadRevision };
    return false;
  }
  state.busy = true;
  $("studioReloadButton").disabled = true;
  setStatus(reason === "hot-reload" ? "Refreshing…" : "Building…");
  if (reason === "hot-reload") setWatchState("Reloading", "busy");
  try {
    const previous = state.session?.getSnapshot();
    const previousDraft = state.draftText;
    const previousDraftDirty = state.draftDirty;
    const payload = await requestJson("/api/compositions/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "development", sourceMap: "external" })
    });
    state.manifest = payload.manifest;
    installBundleCss(state.manifest);
    const moduleNamespace = await import(`${bundleUrl(state.manifest.browserEntry)}?studio=${Date.now()}`);
    const entries = moduleNamespace.vexaExecutableCompositions;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("Composition bundle must export a non-empty vexaExecutableCompositions array.");
    }
    const nextExecutables = new Map(entries.map((entry) => [entry.definition.id, entry]));
    const metadata = entries.map((entry) => getExecutableCompositionStaticMetadata(entry));
    state.executables = nextExecutables;

    if (!state.session) {
      state.session = createVexaStudioSession({ compositions: metadata });
      state.unsubscribeSession = state.session.subscribe((snapshot) => renderSnapshot(snapshot));
    } else {
      state.session.reloadCompositions(metadata, {
        preserveFrame: preserve,
        preserveProps: preserve
      });
    }

    const restoreDirtyDraft = Boolean(
      preserve &&
      previousDraftDirty &&
      previous &&
      state.session.getSnapshot().selectedComposition.id === previous.selectedComposition.id
    );

    clearStudioError();
    let evaluationFailed = false;
    try {
      await evaluateSelected();
    } catch {
      evaluationFailed = true;
      // Validation/error overlay remains visible while the rest of Studio stays usable.
    }

    if (restoreDirtyDraft) {
      state.draftText = previousDraft;
      state.draftDirty = true;
      $("studioProps").value = previousDraft;
      renderSnapshot();
    }

    if (!evaluationFailed) setStatus("Bundle ready", "success");
    else setStatus("Composition error", "error");
    setWatchState("Watching", "success");
    log(reason === "hot-reload" ? "Studio hot reload completed." : "Studio bundle loaded.", {
      browserEntry: state.manifest.browserEntry,
      compositions: metadata.map((item) => item.id),
      ...(reason === "hot-reload" ? { revision: state.lastHotReloadRevision } : {})
    });
    return !evaluationFailed;
  } catch (error) {
    setStatus("Build failed", "error");
    setWatchState(state.watchConnected ? "Watching" : "Watch error", state.watchConnected ? "success" : "error");
    showStudioError("Bundle build failed", error);
    log("Studio bundle failed.", error instanceof Error ? error.message : String(error));
    if (state.session) state.session.setValidationError(error instanceof Error ? error : String(error));
    return false;
  } finally {
    state.busy = false;
    $("studioReloadButton").disabled = false;
    renderSnapshot();
    if (state.pendingHotReload && state.active) {
      state.pendingHotReload = null;
      window.setTimeout(() => void loadBundle({ preserve: true, reason: "hot-reload" }), 0);
    }
  }
}

function scheduleHotReload(event) {
  state.lastHotReloadRevision = Math.max(state.lastHotReloadRevision, Number(event.revision ?? 0));
  setWatchState("Source changed", "changed", state.lastHotReloadRevision);
  log("Composition source changed.", { revision: state.lastHotReloadRevision, paths: event.paths ?? [] });
  window.clearTimeout(state.hotReloadTimer);
  state.hotReloadTimer = window.setTimeout(() => {
    state.hotReloadTimer = 0;
    void loadBundle({ preserve: true, reason: "hot-reload" });
  }, 180);
}

function disconnectStudioEvents() {
  window.clearTimeout(state.hotReloadTimer);
  state.hotReloadTimer = 0;
  state.eventSource?.close();
  state.eventSource = null;
  state.watchConnected = false;
  if (!state.active) setWatchState("Watch idle", "idle");
}

function connectStudioEvents() {
  if (state.eventSource || typeof EventSource === "undefined") {
    if (typeof EventSource === "undefined") setWatchState("Watch unavailable", "error");
    return;
  }

  const source = new EventSource("/api/studio/events");
  state.eventSource = source;
  setWatchState("Connecting…", "busy");

  source.onopen = () => {
    state.watchConnected = true;
    setWatchState("Watching", "success");
  };
  source.onmessage = (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    if (event.type === "ready") {
      const revision = Number(event.revision ?? 0);
      const missedChange = revision > state.lastHotReloadRevision && Boolean(state.session);
      state.lastHotReloadRevision = Math.max(state.lastHotReloadRevision, revision);
      setWatchState("Watching", "success", state.lastHotReloadRevision);
      if (missedChange && state.active) scheduleHotReload({ type: "source-change", revision, paths: [] });
      return;
    }
    if (event.type === "source-change" && state.active) {
      scheduleHotReload(event);
      return;
    }
    if (event.type === "watch-error") {
      setWatchState("Watch error", "error");
      log("Studio source watcher failed.", event.error ?? "Unknown watcher error");
    }
  };
  source.onerror = () => {
    const wasConnected = state.watchConnected;
    state.watchConnected = false;
    setWatchState("Reconnecting…", "busy");
    if (wasConnected) log("Studio source watch connection interrupted; reconnecting.");
  };
}

function renderRenderOutput() {
  const container = $("studioRenderOutput");
  container.replaceChildren();
  const payload = state.renderResult;
  if (!payload) {
    const p = document.createElement("p");
    p.textContent = "Rendered output appears here.";
    container.append(p);
    return;
  }
  const output = payload.output;
  if (payload.target === "video") {
    const video = document.createElement("video");
    video.src = output.url;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    container.append(video);
  } else {
    const image = document.createElement("img");
    image.src = output.url;
    image.alt = "Studio rendered output";
    container.append(image);
  }
  const actions = document.createElement("div");
  actions.className = "studio-output-actions";
  for (const [label, download] of [["Open", false], ["Download", true]]) {
    const link = document.createElement("a");
    link.href = output.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = label;
    if (download) link.download = "";
    actions.append(link);
  }
  container.append(actions);
}

function setRenderProgress(progress, text) {
  const percent = progress ? Math.max(0, Math.min(100, Number(progress.percent ?? 0))) : 0;
  $("studioRenderProgress").value = percent;
  $("studioRenderProgressText").textContent = text ?? (progress ? `${Math.round(percent)}% · ${progress.completedFrames}/${progress.totalFrames} frames` : "Ready");
}

async function renderComposition() {
  if (!state.session || state.renderController) return;
  const snapshot = state.session.getSnapshot();
  const target = $("studioRenderTarget").value;
  const controller = new AbortController();
  state.renderController = controller;
  state.renderResult = null;
  renderRenderOutput();
  $("studioRenderButton").disabled = true;
  $("studioCancelRender").disabled = false;
  $("studioHardware").disabled = true;
  setRenderProgress(null, "Starting…");
  setStatus("Rendering…");
  clearStudioError();

  try {
    let completed = null;
    const duration = snapshot.resolvedMetadata.kind === "video" ? snapshot.resolvedMetadata.durationInFrames : 1;
    await requestNdjson("/api/compositions/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        compositionId: snapshot.selectedComposition.id,
        target,
        frame: target === "video" ? 0 : snapshot.frame,
        endFrameExclusive: target === "video" ? duration : snapshot.frame + 1,
        timeoutMs: 120000,
        hardwareAcceleration: $("studioHardware").value,
        inputProps: snapshot.props
      })
    }, (event) => {
      if (event.type === "progress") setRenderProgress(event.progress);
      if (event.type === "complete") completed = event.result;
    });
    if (!completed) throw new Error("Render stream ended without a completed result.");
    state.renderResult = completed;
    setRenderProgress({ percent: 100, completedFrames: 1, totalFrames: 1 }, "Complete · 100%");
    setStatus("Render complete", "success");
    log("Studio render completed.", completed.result.metadata);
    renderRenderOutput();
  } catch (error) {
    if (error?.name === "AbortError") {
      setRenderProgress(null, "Cancelled");
      setStatus("Render cancelled");
      log("Studio render cancelled.");
    } else {
      setRenderProgress(null, "Failed");
      setStatus("Render failed", "error");
      showStudioError("Render failed", error);
      log("Studio render failed.", error instanceof Error ? error.message : String(error));
    }
  } finally {
    state.renderController = null;
    $("studioRenderButton").disabled = false;
    $("studioCancelRender").disabled = true;
    syncRenderTargets(state.session.getSnapshot());
    if (state.pendingHotReload && state.active) {
      state.pendingHotReload = null;
      window.setTimeout(() => void loadBundle({ preserve: true, reason: "hot-reload" }), 0);
    }
  }
}

function updateResponsiveRoot() {
  const focused = document.body.classList.contains("studio-workspace-active") ||
    document.body.classList.contains("bundler-workspace-active") ||
    document.body.classList.contains("player-workspace-active");
  document.documentElement.classList.toggle("workspace-responsive-mode", focused);
}

function hideWorkspace({ restoreTransport = true } = {}) {
  if (!state.active) return;
  state.active = false;
  state.session?.pause();
  disconnectStudioEvents();
  document.body.classList.remove("studio-workspace-active");
  $("studioTab").classList.remove("active");
  $("studioWorkspace").classList.add("hidden");
  if (restoreTransport && !document.body.classList.contains("player-workspace-active") && !document.body.classList.contains("bundler-workspace-active")) {
    $("mediaTransportBar").classList.remove("hidden");
  }
  updateResponsiveRoot();
}

async function showWorkspace() {
  if (document.body.classList.contains("player-workspace-active") || document.body.classList.contains("bundler-workspace-active")) {
    $("sourceTab").click();
  }
  state.active = true;
  document.body.classList.add("studio-workspace-active");
  $("sourceTab").classList.remove("active");
  $("outputTab").classList.remove("active");
  $("playerTab").classList.remove("active");
  $("bundlerTab")?.classList.remove("active");
  $("studioTab").classList.add("active");
  $("emptyStage").classList.add("hidden");
  $("videoStage").classList.add("hidden");
  $("playerDemoStage").classList.add("hidden");
  $("bundlerWorkspace")?.classList.add("hidden");
  $("mediaTransportBar").classList.add("hidden");
  $("playerDemoTransport").classList.add("hidden");
  $("studioWorkspace").classList.remove("hidden");
  document.querySelectorAll(".rail-button").forEach((item) => item.classList.toggle("active", item.id === "studioRailButton"));
  $("previewBadge").textContent = "Studio";
  $("previewResolution").textContent = "programmable";
  updateResponsiveRoot();
  connectStudioEvents();
  if (!state.session) await loadBundle({ preserve: false });
}

function togglePlay() {
  if (!state.session) return;
  const snapshot = state.session.getSnapshot();
  if (snapshot.resolvedMetadata.kind !== "video") return;
  if (snapshot.playing) state.session.pause(); else state.session.play();
}

function animationTick(now) {
  if (state.active && state.session) {
    const snapshot = state.session.getSnapshot();
    if (snapshot.playing && state.lastTick > 0) state.session.advanceByMilliseconds(Math.min(100, now - state.lastTick));
  }
  state.lastTick = now;
  state.raf = requestAnimationFrame(animationTick);
}

async function toggleFullscreen() {
  const workspace = document.querySelector(".preview-workspace");
  if (!workspace) return;
  if (document.fullscreenElement === workspace) {
    await document.exitFullscreen();
    return;
  }
  try {
    if (typeof workspace.requestFullscreen === "function") {
      await workspace.requestFullscreen();
    } else {
      workspace.classList.toggle("workspace-pseudo-fullscreen");
    }
  } catch {
    workspace.classList.toggle("workspace-pseudo-fullscreen");
  }
}

installWorkspace();
renderRenderOutput();
state.raf = requestAnimationFrame(animationTick);

$("studioTab").addEventListener("click", () => void showWorkspace());
$("studioRailButton").addEventListener("click", () => void showWorkspace());
$("studioReloadButton").addEventListener("click", () => void loadBundle({ preserve: true, reason: "manual" }));
$("studioFullscreenButton").addEventListener("click", () => void toggleFullscreen());
$("studioStepBack").addEventListener("click", () => state.session?.stepFrames(-1));
$("studioStepForward").addEventListener("click", () => state.session?.stepFrames(1));
$("studioPlay").addEventListener("click", togglePlay);
$("studioSeek").addEventListener("input", () => state.session?.seekFrame(Number($("studioSeek").value)));
$("studioTimelineZoom").addEventListener("input", () => state.session?.setTimelineViewport({ zoom: Number($("studioTimelineZoom").value) }));
$("studioProps").addEventListener("input", () => {
  state.draftText = $("studioProps").value;
  state.draftDirty = true;
  $("studioPropsState").textContent = "draft";
  $("studioPropsState").dataset.tone = "draft";
});
$("studioApplyProps").addEventListener("click", () => void evaluateSelected({ useDraft: true }).catch(() => {}));
$("studioRenderTarget").addEventListener("change", () => state.session && syncRenderTargets(state.session.getSnapshot()));
$("studioRenderButton").addEventListener("click", () => void renderComposition());
$("studioCancelRender").addEventListener("click", () => state.renderController?.abort());
$("studioClearConsole").addEventListener("click", () => {
  state.log = [];
  $("studioConsole").textContent = "Studio console cleared.";
});
$("studioErrorLogs").addEventListener("click", () => openStudioPanel("console"));
$("studioErrorDismiss").addEventListener("click", clearStudioError);

for (const button of document.querySelectorAll("[data-studio-panel]")) {
  button.addEventListener("click", () => {
    const panel = button.dataset.studioPanel;
    document.querySelectorAll("[data-studio-panel]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-studio-content]").forEach((item) => item.classList.toggle("hidden", item.dataset.studioContent !== panel));
  });
}

for (const id of ["sourceTab", "outputTab", "playerTab", "bundlerTab"]) {
  $(id)?.addEventListener("click", () => hideWorkspace({ restoreTransport: id !== "playerTab" && id !== "bundlerTab" }));
}

document.addEventListener("click", (event) => {
  const railButton = event.target.closest?.(".rail-button");
  if (!railButton || railButton.id === "studioRailButton" || !state.active) return;
  hideWorkspace({ restoreTransport: false });
  if (!["playerRailButton", "bundlerRailButton"].includes(railButton.id)) $("sourceTab").click();
}, true);

window.addEventListener("keydown", (event) => {
  if (!state.active || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.session?.stepFrames(event.shiftKey ? -10 : -1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    state.session?.stepFrames(event.shiftKey ? 10 : 1);
  }
});

document.addEventListener("fullscreenchange", () => {
  $("studioFullscreenButton").textContent = document.fullscreenElement === document.querySelector(".preview-workspace") ? "Exit full screen" : "Full screen";
});
window.addEventListener("error", (event) => {
  if (!state.active) return;
  const error = event.error ?? event.message;
  showStudioError("Browser runtime error", error);
  log("Browser runtime error.", studioErrorMessage(error));
});

window.addEventListener("unhandledrejection", (event) => {
  if (!state.active) return;
  showStudioError("Unhandled Studio promise", event.reason);
  log("Unhandled Studio promise.", studioErrorMessage(event.reason));
});

window.addEventListener("beforeunload", () => {
  disconnectStudioEvents();
  state.renderController?.abort();
  state.unsubscribeSession?.();
  cancelAnimationFrame(state.raf);
});

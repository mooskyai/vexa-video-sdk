const $ = (id) => document.getElementById(id);

const state = {
  compositions: [],
  selectedId: null,
  manifest: null,
  renderPlan: null,
  renderResult: null,
  renderController: null,
  loading: false
};

function installWorkspace() {
  $("playerRailButton").insertAdjacentHTML(
    "afterend",
    '<button id="bundlerRailButton" class="rail-button" type="button" title="Composition bundles"><span>B</span><small>Bundles</small></button>'
  );
  $("playerTab").insertAdjacentHTML(
    "afterend",
    '<button id="bundlerTab" class="mode-tab" type="button">Compositions</button>'
  );

  document.querySelector(".stage-wrap").insertAdjacentHTML(
    "beforeend",
    `<div id="bundlerWorkspace" class="bundler-workspace hidden" aria-label="Composition bundling workspace">
      <header class="bundler-heading">
        <div>
          <span class="kicker">Composition tooling</span>
          <h1>Composition bundles</h1>
          <p>Discover deterministic composition metadata and inspect the browser bundle emitted by @vexa-video/bundler.</p>
        </div>
        <div class="bundler-actions">
          <label>Mode
            <select id="bundlerMode" class="compact-select"><option value="development">Development</option><option value="production">Production</option></select>
          </label>
          <label>Source maps
            <select id="bundlerSourceMap" class="compact-select"><option value="external">External</option><option value="inline">Inline</option><option value="none">None</option></select>
          </label>
          <button id="bundlerDiscover" class="button secondary compact" type="button">Discover</button>
          <button id="bundlerBuild" class="button primary compact" type="button">Build bundle</button>
        </div>
      </header>

      <div class="bundler-status-row">
        <div class="bundler-status"><span>Status</span><strong id="bundlerStatus">Ready</strong></div>
        <div class="bundler-stat"><span>Compositions</span><strong id="bundlerCompositionCount">—</strong></div>
        <div class="bundler-stat"><span>Files</span><strong id="bundlerFileCount">—</strong></div>
        <div class="bundler-stat"><span>Bundle size</span><strong id="bundlerBytes">—</strong></div>
        <div class="bundler-stat wide"><span>Fixture</span><strong>examples/visual-playground/compositions/entry.tsx</strong></div>
      </div>

      <div class="bundler-grid">
        <section class="bundler-panel bundler-discovery-panel">
          <div class="bundler-panel-title"><strong>Discovered compositions</strong><span>stable ID order</span></div>
          <div id="bundlerCompositionList" class="bundler-composition-list"><p class="bundler-empty">Run discovery to inspect composition metadata.</p></div>
        </section>

        <section class="bundler-panel bundler-detail-panel">
          <div class="bundler-panel-title"><strong>Selected composition</strong><span id="bundlerSelectedKind">—</span></div>
          <div id="bundlerSelected" class="bundler-selected"><p class="bundler-empty">Select a discovered composition.</p></div>
          <div class="renderer-plan-controls">
            <label>Target
              <select id="rendererTarget" class="compact-select"></select>
            </label>
            <label id="rendererFrameField"><span id="rendererFrameLabel">Frame</span>
              <input id="rendererFrame" type="number" min="0" step="1" value="0">
            </label>
            <label id="rendererEndField">End frame
              <input id="rendererEndFrame" type="number" min="1" step="1" value="1">
            </label>
            <button id="rendererPlanButton" class="button secondary compact" type="button">Plan</button>
            <button id="rendererRenderButton" class="button primary compact" type="button">Render</button>
          </div>
          <div class="renderer-runtime-controls">
            <label>Hardware
              <select id="rendererHardware" class="compact-select">
                <option value="cpu">CPU</option>
                <option value="auto">Auto</option>
                <option value="nvidia">NVIDIA</option>
                <option value="intel">Intel</option>
                <option value="amd">AMD</option>
                <option value="apple">Apple</option>
              </select>
            </label>
            <label>Timeout ms
              <input id="rendererTimeout" type="number" min="1" step="1000" value="120000">
            </label>
            <button id="rendererCancelButton" class="button secondary compact" type="button" disabled>Cancel</button>
            <div class="renderer-progress" aria-live="polite">
              <progress id="rendererProgressBar" max="100" value="0"></progress>
              <span id="rendererProgressText">Ready</span>
            </div>
          </div>
          <pre id="rendererPlan" class="renderer-plan-output">Build a bundle, select a composition, then create a render plan.</pre>
          <div id="rendererResult" class="renderer-result"><p>Run a render to inspect the generated output.</p></div>
        </section>

        <section class="bundler-panel bundler-files-panel">
          <div class="bundler-panel-title"><strong>Bundle outputs</strong><span id="bundlerManifestMode">not built</span></div>
          <div id="bundlerFiles" class="bundler-files"><p class="bundler-empty">Build the fixture to inspect emitted JS, CSS, chunks, source maps, copied public files, and fingerprinted assets.</p></div>
        </section>

        <section class="bundler-panel bundler-manifest-panel">
          <div class="bundler-panel-title"><strong>Manifest</strong><span>vexa.bundle.json</span></div>
          <pre id="bundlerManifest">No bundle manifest yet.</pre>
        </section>
      </div>
    </div>`
  );
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} KB`;
}

function setStatus(label, tone = "") {
  const element = $("bundlerStatus");
  element.textContent = label;
  element.dataset.tone = tone;
}


function syncRenderControls() {
  const selected = state.compositions.find((item) => item.id === state.selectedId);
  const target = $("rendererTarget");
  if (!selected) {
    target.replaceChildren();
    $("rendererPlanButton").disabled = true;
    $("rendererRenderButton").disabled = true;
    $("rendererHardware").disabled = true;
    return;
  }

  const options = selected.kind === "video"
    ? [["frame", "Single frame"], ["frame-range", "Frame range"], ["video", "Video"]]
    : [["still", "Still image"], ["frame", "Single frame"]];
  const previous = target.value;
  target.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  if (options.some(([value]) => value === previous)) target.value = previous;

  const duration = selected.kind === "video" ? selected.durationInFrames : 1;
  $("rendererFrame").max = String(Math.max(duration - 1, 0));
  $("rendererEndFrame").max = String(duration);
  if (Number($("rendererEndFrame").value) > duration || Number($("rendererEndFrame").value) <= 0) {
    $("rendererEndFrame").value = String(duration);
  }
  $("rendererPlanButton").disabled = !state.manifest || state.renderController !== null;
  $("rendererRenderButton").disabled = !state.manifest || state.renderController !== null;
  syncRenderTargetFields();
}

function syncRenderTargetFields() {
  const target = $("rendererTarget").value;
  $("rendererFrameField").classList.toggle("hidden", target === "still");
  $("rendererEndField").classList.toggle("hidden", target !== "frame-range" && target !== "video");
  $("rendererFrameLabel").textContent = target === "frame" ? "Frame" : "Start frame";
  $("rendererHardware").disabled = target !== "video" || !state.manifest || state.renderController !== null;
}

function setRenderProgress(progress = null, label = null) {
  const percent = progress ? Math.min(100, Math.max(0, Number(progress.percent ?? 0))) : 0;
  $("rendererProgressBar").value = percent;
  if (label) {
    $("rendererProgressText").textContent = label;
    return;
  }
  if (!progress) {
    $("rendererProgressText").textContent = "Ready";
    return;
  }
  const frameText = progress.totalFrames > 1
    ? ` · ${progress.completedFrames}/${progress.totalFrames} frames`
    : "";
  const speedText = Number.isFinite(progress.media?.speed)
    ? ` · ${progress.media.speed.toFixed(2)}x`
    : "";
  $("rendererProgressText").textContent = `${Math.round(percent)}%${frameText}${speedText}`;
}

async function requestNdjson(path, options, onEvent) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`${payload.code ?? "RENDER_ERROR"}: ${payload.error ?? "Render request failed"}`);
  }
  if (!response.body) throw new Error("Render response stream is unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") {
      throw new Error(`${event.code ?? "RENDER_ERROR"}: ${event.error ?? "Render failed"}`);
    }
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

function renderRenderPlan() {
  $("rendererPlan").textContent = state.renderPlan
    ? JSON.stringify(state.renderPlan, null, 2)
    : "Build a bundle, select a composition, then create a render plan.";
}

function outputLink(label, url, download = false) {
  const link = document.createElement("a");
  link.href = url;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noreferrer";
  if (download) link.download = "";
  return link;
}

function renderRenderResult() {
  const container = $("rendererResult");
  container.replaceChildren();
  const payload = state.renderResult;
  if (!payload) {
    const empty = document.createElement("p");
    empty.textContent = "Run a render to inspect the generated output.";
    container.append(empty);
    return;
  }

  const meta = document.createElement("div");
  meta.className = "renderer-result-meta";
  meta.textContent = `${payload.target} · ${payload.result.plan.frames.startFrame}–${payload.result.plan.frames.endFrameExclusive} · ${payload.result.metadata.width}×${payload.result.metadata.height}`;
  container.append(meta);

  if (payload.target === "frame-range") {
    const files = payload.output.files ?? [];
    if (files[0]) {
      const image = document.createElement("img");
      image.src = files[0].url;
      image.alt = `Rendered frame ${files[0].frame}`;
      container.append(image);
    }
    const actions = document.createElement("div");
    actions.className = "renderer-result-actions";
    const label = document.createElement("span");
    label.textContent = `${files.length} frame files`;
    actions.append(label);
    for (const file of files.slice(0, 8)) actions.append(outputLink(`Open ${file.frame}`, file.url));
    container.append(actions);
    return;
  }

  if (payload.target === "video") {
    const video = document.createElement("video");
    video.src = payload.output.url;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    container.append(video);
  } else {
    const image = document.createElement("img");
    image.src = payload.output.url;
    image.alt = "Rendered composition output";
    container.append(image);
  }

  const actions = document.createElement("div");
  actions.className = "renderer-result-actions";
  actions.append(
    outputLink("Open", payload.output.url),
    outputLink("Download", payload.output.url, true)
  );
  container.append(actions);
}

function renderSelected() {
  const selected = state.compositions.find((item) => item.id === state.selectedId);
  if (!selected) {
    $("bundlerSelectedKind").textContent = "—";
    $("bundlerSelected").innerHTML = '<p class="bundler-empty">Select a discovered composition.</p>';
    syncRenderControls();
    return;
  }
  $("bundlerSelectedKind").textContent = selected.kind;
  const duration = selected.kind === "video" ? `${selected.durationInFrames} frames · ${selected.fps}fps` : "single still";
  $("bundlerSelected").innerHTML = `
    <dl>
      <div><dt>ID</dt><dd>${selected.id}</dd></div>
      <div><dt>Canvas</dt><dd>${selected.width}×${selected.height}</dd></div>
      <div><dt>Kind</dt><dd>${selected.kind}</dd></div>
      <div><dt>Timing</dt><dd>${duration}</dd></div>
    </dl>`;
  syncRenderControls();
}

function renderCompositions() {
  $("bundlerCompositionCount").textContent = String(state.compositions.length);
  const list = $("bundlerCompositionList");
  if (state.compositions.length === 0) {
    list.innerHTML = '<p class="bundler-empty">No compositions discovered.</p>';
    renderSelected();
    return;
  }
  if (!state.compositions.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.compositions[0].id;
  }
  list.replaceChildren(...state.compositions.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bundler-composition${item.id === state.selectedId ? " active" : ""}`;
    button.innerHTML = `<strong>${item.id}</strong><span>${item.kind} · ${item.width}×${item.height}${item.fps ? ` · ${item.fps}fps` : ""}</span>`;
    button.addEventListener("click", () => {
      state.selectedId = item.id;
      state.renderPlan = null;
      state.renderResult = null;
      renderCompositions();
      renderRenderPlan();
      renderRenderResult();
    });
    return button;
  }));
  renderSelected();
}

function renderManifest() {
  const manifest = state.manifest;
  if (!manifest) {
    $("bundlerFileCount").textContent = "—";
    $("bundlerBytes").textContent = "—";
    $("bundlerManifestMode").textContent = "not built";
    $("bundlerFiles").innerHTML = '<p class="bundler-empty">Build the fixture to inspect emitted files.</p>';
    $("bundlerManifest").textContent = "No bundle manifest yet.";
    return;
  }

  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  $("bundlerFileCount").textContent = String(manifest.files.length);
  $("bundlerBytes").textContent = formatBytes(totalBytes);
  $("bundlerManifestMode").textContent = `${manifest.mode} · schema ${manifest.schemaVersion}`;
  $("bundlerFiles").replaceChildren(...manifest.files.map((file) => {
    const row = document.createElement("div");
    row.className = "bundler-file";
    row.innerHTML = `<strong>${file.path}</strong><span>${formatBytes(file.bytes)}</span><code>${file.sha256.slice(0, 12)}</code>`;
    return row;
  }));
  $("bundlerManifest").textContent = JSON.stringify(manifest, null, 2);
}

async function request(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    const diagnostic = payload.diagnostics?.[0];
    const detail = diagnostic?.file ? ` (${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""})` : "";
    throw new Error(`${payload.code ?? "BUNDLE_ERROR"}: ${payload.error ?? "Request failed"}${detail}`);
  }
  return payload;
}

async function discover() {
  if (state.loading) return;
  state.loading = true;
  setStatus("Discovering…");
  try {
    const payload = await request("/api/compositions/discover");
    state.compositions = payload.compositions ?? [];
    renderCompositions();
    setStatus("Discovered", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.loading = false;
  }
}

async function buildBundle() {
  if (state.loading) return;
  state.loading = true;
  setStatus("Building…");
  try {
    const payload = await request("/api/compositions/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: $("bundlerMode").value,
        sourceMap: $("bundlerSourceMap").value
      })
    });
    state.manifest = payload.manifest;
    state.compositions = payload.manifest.compositions ?? state.compositions;
    state.renderPlan = null;
    state.renderResult = null;
    renderCompositions();
    renderManifest();
    renderRenderPlan();
    renderRenderResult();
    setStatus("Bundle ready", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.loading = false;
  }
}



async function renderComposition() {
  if (state.loading || !state.manifest || !state.selectedId || state.renderController) return;
  const controller = new AbortController();
  state.renderController = controller;
  state.loading = true;
  state.renderResult = null;
  renderRenderResult();
  $("rendererPlanButton").disabled = true;
  $("rendererRenderButton").disabled = true;
  $("rendererCancelButton").disabled = false;
  syncRenderTargetFields();
  setRenderProgress(null, "Starting…");
  setStatus("Rendering…");

  let completed = null;
  try {
    const target = $("rendererTarget").value;
    await requestNdjson("/api/compositions/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        compositionId: state.selectedId,
        target,
        frame: Number($("rendererFrame").value),
        endFrameExclusive: Number($("rendererEndFrame").value),
        timeoutMs: Number($("rendererTimeout").value),
        hardwareAcceleration: $("rendererHardware").value
      })
    }, (event) => {
      if (event.type === "progress") setRenderProgress(event.progress);
      if (event.type === "complete") completed = event.result;
    });

    if (!completed) throw new Error("Render stream ended without a completed result.");
    state.renderResult = completed;
    state.renderPlan = completed.result.plan;
    renderRenderPlan();
    renderRenderResult();
    const completedFrameCount = completed.result.plan.frames.frameCount;
    setRenderProgress({ percent: 100, completedFrames: completedFrameCount, totalFrames: completedFrameCount }, "Complete · 100%");
    setStatus("Render complete", "success");
  } catch (error) {
    if (error?.name === "AbortError") {
      setRenderProgress(null, "Cancelled");
      setStatus("Render cancelled");
    } else {
      setRenderProgress(null, "Failed");
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  } finally {
    state.renderController = null;
    state.loading = false;
    $("rendererCancelButton").disabled = true;
    $("rendererPlanButton").disabled = !state.manifest;
    $("rendererRenderButton").disabled = !state.manifest;
    syncRenderTargetFields();
  }
}

async function planRender() {
  if (state.loading || !state.manifest || !state.selectedId) return;
  state.loading = true;
  setStatus("Planning…");
  try {
    const target = $("rendererTarget").value;
    const payload = await request("/api/compositions/render-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        compositionId: state.selectedId,
        target,
        frame: Number($("rendererFrame").value),
        endFrameExclusive: Number($("rendererEndFrame").value)
      })
    });
    state.renderPlan = payload.plan;
    renderRenderPlan();
    setStatus("Render plan ready", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.loading = false;
  }
}

function hideWorkspace({ restoreTransport = true } = {}) {
  document.body.classList.remove("bundler-workspace-active");
  $("bundlerTab").classList.remove("active");
  $("bundlerWorkspace").classList.add("hidden");
  if (restoreTransport && !document.body.classList.contains("player-workspace-active")) {
    $("mediaTransportBar").classList.remove("hidden");
  }
}

function showWorkspace() {
  if (document.body.classList.contains("player-workspace-active")) $("sourceTab").click();
  document.body.classList.add("bundler-workspace-active");
  $("sourceTab").classList.remove("active");
  $("outputTab").classList.remove("active");
  $("playerTab").classList.remove("active");
  $("bundlerTab").classList.add("active");
  $("emptyStage").classList.add("hidden");
  $("videoStage").classList.add("hidden");
  $("playerDemoStage").classList.add("hidden");
  $("mediaTransportBar").classList.add("hidden");
  $("playerDemoTransport").classList.add("hidden");
  $("bundlerWorkspace").classList.remove("hidden");
  document.querySelectorAll(".rail-button").forEach((item) => item.classList.toggle("active", item.id === "bundlerRailButton"));
  $("previewBadge").textContent = "Bundler";
  $("previewResolution").textContent = "manifest";
  if (state.compositions.length === 0) void discover();
}

installWorkspace();
renderManifest();
renderRenderPlan();
renderRenderResult();

$("bundlerTab").addEventListener("click", showWorkspace);
$("bundlerRailButton").addEventListener("click", showWorkspace);
$("bundlerDiscover").addEventListener("click", () => void discover());
$("bundlerBuild").addEventListener("click", () => void buildBundle());
$("rendererTarget").addEventListener("change", syncRenderTargetFields);
$("rendererPlanButton").addEventListener("click", () => void planRender());
$("rendererRenderButton").addEventListener("click", () => void renderComposition());
$("rendererCancelButton").addEventListener("click", () => {
  if (!state.renderController) return;
  setRenderProgress(null, "Cancelling…");
  setStatus("Cancelling…");
  state.renderController.abort();
});

$("sourceTab").addEventListener("click", () => hideWorkspace());
$("outputTab").addEventListener("click", () => hideWorkspace());
$("playerTab").addEventListener("click", () => hideWorkspace({ restoreTransport: false }));

document.addEventListener("click", (event) => {
  const railButton = event.target.closest?.(".rail-button");
  if (!railButton || railButton.id === "bundlerRailButton" || !document.body.classList.contains("bundler-workspace-active")) return;
  hideWorkspace({ restoreTransport: false });
  if (railButton.id !== "playerRailButton") $("sourceTab").click();
}, true);

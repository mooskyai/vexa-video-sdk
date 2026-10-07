const $ = (id) => document.getElementById(id);

const state = {
  compositions: [],
  selectedId: null,
  manifest: null,
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
          <span class="kicker">V2.6 build tooling</span>
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
          <div id="bundlerCompositionList" class="bundler-composition-list"><p class="bundler-empty">Run discovery to inspect V2.6 metadata.</p></div>
        </section>

        <section class="bundler-panel bundler-detail-panel">
          <div class="bundler-panel-title"><strong>Selected composition</strong><span id="bundlerSelectedKind">—</span></div>
          <div id="bundlerSelected" class="bundler-selected"><p class="bundler-empty">Select a discovered composition.</p></div>
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

function renderSelected() {
  const selected = state.compositions.find((item) => item.id === state.selectedId);
  if (!selected) {
    $("bundlerSelectedKind").textContent = "—";
    $("bundlerSelected").innerHTML = '<p class="bundler-empty">Select a discovered composition.</p>';
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
      renderCompositions();
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
    renderCompositions();
    renderManifest();
    setStatus("Bundle ready", "success");
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
  $("previewResolution").textContent = "V2.6";
  if (state.compositions.length === 0) void discover();
}

installWorkspace();
renderManifest();

$("bundlerTab").addEventListener("click", showWorkspace);
$("bundlerRailButton").addEventListener("click", showWorkspace);
$("bundlerDiscover").addEventListener("click", () => void discover());
$("bundlerBuild").addEventListener("click", () => void buildBundle());

$("sourceTab").addEventListener("click", () => hideWorkspace());
$("outputTab").addEventListener("click", () => hideWorkspace());
$("playerTab").addEventListener("click", () => hideWorkspace({ restoreTransport: false }));

document.addEventListener("click", (event) => {
  const railButton = event.target.closest?.(".rail-button");
  if (!railButton || railButton.id === "bundlerRailButton" || !document.body.classList.contains("bundler-workspace-active")) return;
  hideWorkspace({ restoreTransport: false });
  if (railButton.id !== "playerRailButton") $("sourceTab").click();
}, true);

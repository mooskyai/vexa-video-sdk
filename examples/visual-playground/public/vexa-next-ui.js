const $ = (id) => document.getElementById(id);

const ui = {
  studioSceneObserver: null,
  studioCompositionObserver: null,
  studioSceneSyncFrame: 0,
  searchQuery: "",
  mediaFilter: "all",
  toastTimer: 0,
  panelMode: "editor"
};

function make(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function toast(message) {
  let element = $("vexaUiToast");
  if (!element) {
    element = make("div", "vexa-ui-toast");
    element.id = "vexaUiToast";
    document.body.append(element);
  }
  element.textContent = message;
  requestAnimationFrame(() => element.classList.add("visible"));
  clearTimeout(ui.toastTimer);
  ui.toastTimer = window.setTimeout(() => element.classList.remove("visible"), 2600);
}

function clickIfPresent(id) {
  const element = $(id);
  if (!element) return false;
  element.click();
  return true;
}

function isFocusedWorkspace() {
  return document.body.classList.contains("studio-workspace-active") ||
    document.body.classList.contains("player-workspace-active") ||
    document.body.classList.contains("bundler-workspace-active");
}

function syncModeUi() {
  const body = document.body;
  const studio = body.classList.contains("studio-workspace-active");
  const compositions = body.classList.contains("bundler-workspace-active");
  const player = body.classList.contains("player-workspace-active");
  const mode = studio ? "studio" : compositions ? "compositions" : player ? "player" : "editor";
  ui.panelMode = mode;
  body.dataset.vexaMode = mode;
  body.classList.toggle("vexa-editor-mode", mode === "editor");

  const title = document.querySelector(".brand strong");
  const subtitle = document.querySelector(".brand span");
  if (title) title.textContent = studio ? "Vexa Studio" : "Vexa Editor";
  if (subtitle) subtitle.textContent = studio ? "Programmable Video Composition" : "Professional Video Editing";

  const project = $("projectName");
  if (project && studio && (project.textContent === "Untitled Project" || project.textContent === "Untitled video")) {
    project.textContent = "Product Launch";
  }
  const saveState = $("saveState");
  if (saveState) saveState.textContent = studio ? "Development workspace" : "Saved locally";

  const upload = $("topUploadButton");
  if (upload) upload.textContent = studio ? "Quick actions" : "Import";
  const render = $("topRenderButton");
  if (render) render.textContent = studio ? "Build / Reload" : "Export Video";

  document.querySelectorAll("[data-vexa-mode-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.vexaModeTarget === mode);
  });

  syncRailForMode(mode);
}

function installModeSwitcher() {
  const brand = document.querySelector(".brand");
  if (!brand || $("vexaModeSwitcher")) return;
  const switcher = make("div", "vexa-mode-switcher");
  switcher.id = "vexaModeSwitcher";
  switcher.innerHTML = `
    <button type="button" data-vexa-mode-target="editor" title="Video Editor">Editor</button>
    <button type="button" data-vexa-mode-target="studio" title="Composition Studio">Studio</button>
    <button type="button" data-vexa-mode-target="compositions" title="Composition bundles">Comps</button>`;
  brand.after(switcher);
  switcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vexa-mode-target]");
    if (!button) return;
    const mode = button.dataset.vexaModeTarget;
    if (mode === "editor") clickIfPresent("sourceTab");
    if (mode === "studio") clickIfPresent("studioTab");
    if (mode === "compositions") clickIfPresent("bundlerTab");
    requestAnimationFrame(syncModeUi);
  });
}

function installBrandShell() {
  document.documentElement.classList.add("vexa-creative-ui");
  installModeSwitcher();

  const project = $("projectName");
  if (project && project.textContent === "Untitled video") project.textContent = "Untitled Project";

  const topbar = document.querySelector(".topbar");
  if (topbar && !$("vexaCommandSearch")) {
    const wrapper = make("label", "vexa-command-search");
    wrapper.id = "vexaCommandSearch";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search media, effects, captions…";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search Vexa workspace");
    const key = document.createElement("kbd");
    key.textContent = navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
    wrapper.append(input, key);
    const actions = topbar.querySelector(".top-actions");
    topbar.insertBefore(wrapper, actions);

    input.addEventListener("input", () => {
      ui.searchQuery = input.value.trim().toLowerCase();
      filterMediaLibrary();
      filterToolRail();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      input.value = "";
      ui.searchQuery = "";
      filterMediaLibrary();
      filterToolRail();
      input.blur();
    });
  }

  const actions = document.querySelector(".top-actions");
  if (actions && !$("vexaTopUtilityActions")) {
    const utilities = make("div", "vexa-top-utility-actions");
    utilities.id = "vexaTopUtilityActions";
    utilities.innerHTML = `
      <button type="button" title="Quick actions">✦</button>
      <button type="button" title="Help and documentation">?</button>
      <button type="button" title="Settings">⚙</button>
      <button type="button" class="vexa-share-button" title="Copy workspace link">Share</button>`;
    actions.prepend(utilities);
    utilities.querySelector('[title="Quick actions"]').addEventListener("click", () => toast("Quick actions are available from the tool rail and command search."));
    utilities.querySelector('[title="Help and documentation"]').addEventListener("click", () => toast("Vexa SDK documentation is available from the repository docs."));
    utilities.querySelector('[title="Settings"]').addEventListener("click", () => activateDrawerSection("hardwareSection", "Settings"));
    utilities.querySelector(".vexa-share-button").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast("Workspace link copied.");
      } catch {
        toast("Copy the current browser address to share this local workspace.");
      }
    });
  }

  $("topRenderButton")?.addEventListener("click", (event) => {
    if (!document.body.classList.contains("studio-workspace-active")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    $("studioReloadButton")?.click();
  }, true);

  for (const id of ["sourceTab", "outputTab", "playerTab", "bundlerTab", "studioTab", "playerRailButton", "studioRailButton"]) {
    $(id)?.addEventListener("click", () => requestAnimationFrame(syncModeUi));
  }

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("vexaCommandSearch")?.querySelector("input")?.focus();
    }
  });

  syncModeUi();
}

const editorRailLabels = new Map([
  ["mediaPanel", ["▣", "Media"]],
  ["projectSection", ["▤", "Timeline"]],
  ["transformSection", ["✦", "Effects"]],
  ["trimSection", ["◇", "Transitions"]],
  ["captionsSection", ["CC", "Captions"]],
  ["audioSection", ["♫", "Audio"]],
  ["exportSection", ["⇧", "Exports"]],
  ["hardwareSection", ["⚙", "Settings"]]
]);

function applyRailLabel(button, iconText, labelText) {
  const icon = button.querySelector("span");
  const label = button.querySelector("small");
  if (icon) icon.textContent = iconText;
  if (label) label.textContent = labelText;
}

function syncRailForMode(mode) {
  const buttons = [...document.querySelectorAll(".tool-rail .rail-button")];
  buttons.forEach((button) => button.classList.remove("vexa-secondary-rail-item"));

  if (mode === "studio") {
    const studioLabels = [
      ["studioRailButton", "⌂", "Studio"],
      ["bundlerRailButton", "▣", "Compositions"],
      ["mediaPanel", "▧", "Assets"],
      ["transformSection", "◇", "Inspector"],
      ["exportSection", "▶", "Renders"],
      ["hardwareSection", "⚙", "Settings"]
    ];
    for (const [target, icon, label] of studioLabels) {
      const button = target.endsWith("Button") ? $(target) : document.querySelector(`.rail-button[data-section="${target}"]`);
      if (button) applyRailLabel(button, icon, label);
    }
    buttons.forEach((button) => {
      const visible = button.id === "studioRailButton" || button.id === "bundlerRailButton" ||
        ["mediaPanel", "transformSection", "exportSection", "hardwareSection"].includes(button.dataset.section);
      button.classList.toggle("vexa-secondary-rail-item", !visible);
    });
    return;
  }

  if (mode === "compositions") {
    for (const button of buttons) {
      if (button.id === "bundlerRailButton") applyRailLabel(button, "▣", "Compositions");
      if (button.id === "studioRailButton") applyRailLabel(button, "◆", "Studio");
      if (button.dataset.section === "exportSection") applyRailLabel(button, "▶", "Renders");
      if (button.dataset.section === "hardwareSection") applyRailLabel(button, "⚙", "Settings");
      const visible = button.id === "bundlerRailButton" || button.id === "studioRailButton" ||
        ["exportSection", "hardwareSection"].includes(button.dataset.section);
      button.classList.toggle("vexa-secondary-rail-item", !visible);
    }
    return;
  }

  for (const button of buttons) {
    const mapping = editorRailLabels.get(button.dataset.section);
    if (mapping) applyRailLabel(button, mapping[0], mapping[1]);
    /* Editor navigation follows the product mockup. Player/Studio/Compositions
     * remain reachable from the workspace switcher instead of duplicating them
     * in the primary editing rail. */
    button.classList.toggle("vexa-secondary-rail-item", !editorRailLabels.has(button.dataset.section));
  }
}

function installRailLabels() {
  syncRailForMode(ui.panelMode);
}

function mediaKind(element) {
  const text = element.textContent.toLowerCase();
  if (/\.(?:mp3|wav|m4a|aac|opus|ogg)\b/u.test(text)) return "audio";
  if (/\.(?:png|jpe?g|webp|gif|svg)\b/u.test(text)) return "images";
  if (/\.(?:mp4|mov|mkv|avi|webm|m4v)\b/u.test(text)) return "video";
  if (element.closest(".generated-section") || element.id === "outputAsset") return "generated";
  return "all";
}

function filterMediaLibrary() {
  const query = ui.searchQuery;
  const filter = ui.mediaFilter;
  const candidates = [
    ...document.querySelectorAll("#mediaList .asset-card"),
    ...document.querySelectorAll("#assetLibrary > *"),
    ...document.querySelectorAll("#generatedAssets > *")
  ];
  for (const item of candidates) {
    if (item.id === "mediaEmpty") continue;
    const matchesQuery = !query || item.textContent.toLowerCase().includes(query);
    const kind = mediaKind(item);
    const matchesKind = filter === "all" || kind === filter || (kind === "all" && filter !== "generated");
    item.style.display = matchesQuery && matchesKind ? "" : "none";
  }
}

function filterToolRail() {
  const query = ui.searchQuery;
  for (const button of document.querySelectorAll(".tool-rail .rail-button")) {
    if (button.classList.contains("vexa-secondary-rail-item")) continue;
    button.style.display = !query || button.textContent.toLowerCase().includes(query) ? "" : "none";
  }
}

function setMediaFilter(value) {
  ui.mediaFilter = value;
  document.querySelectorAll("[data-media-filter]").forEach((item) => item.classList.toggle("active", item.dataset.mediaFilter === value));
  filterMediaLibrary();
}

function installMediaLibraryUi() {
  const panel = $("mediaPanel");
  const title = panel?.querySelector(".panel-title");
  if (!panel || !title || $("vexaMediaTabs")) return;

  const titleText = title.querySelector("h2");
  if (titleText) titleText.textContent = "Media Library";
  const kicker = title.querySelector(".kicker");
  if (kicker) kicker.textContent = "Project media";

  const tabs = make("div", "vexa-media-tabs");
  tabs.id = "vexaMediaTabs";
  for (const [value, label] of [["all", "All"], ["video", "Video"], ["audio", "Audio"], ["images", "Images"], ["generated", "Generated"]]) {
    const button = make("button", value === "all" ? "active" : "", label);
    button.type = "button";
    button.dataset.mediaFilter = value;
    button.addEventListener("click", () => setMediaFilter(value));
    tabs.append(button);
  }

  const search = make("label", "vexa-media-search");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search media…";
  input.setAttribute("aria-label", "Search media");
  input.addEventListener("input", () => {
    ui.searchQuery = input.value.trim().toLowerCase();
    filterMediaLibrary();
  });
  search.append(input);

  const browser = make("div", "vexa-media-browser");
  browser.id = "vexaMediaBrowser";
  const navigation = make("aside", "vexa-media-nav");
  navigation.innerHTML = `
    <button type="button" class="active" data-media-filter="all"><span>▣</span>All Files<small>124</small></button>
    <button type="button" data-vexa-media-nav="favorites"><span>♡</span>Favorites<small>12</small></button>
    <button type="button" data-vexa-media-nav="recent"><span>◷</span>Recent<small>28</small></button>
    <strong>Folders</strong>
    <button type="button" data-media-filter="all"><span>□</span>Project Media<small>24</small></button>
    <button type="button" data-media-filter="video"><span>□</span>B-Roll<small>43</small></button>
    <button type="button" data-media-filter="audio"><span>□</span>Music<small>12</small></button>
    <button type="button" data-media-filter="audio"><span>□</span>SFX<small>8</small></button>
    <button type="button" data-media-filter="generated"><span>□</span>Generated<small>16</small></button>
    <strong>Smart Bins</strong>
    <button type="button" data-media-filter="video"><span>□</span>Product Shots<small>22</small></button>
    <button type="button" data-media-filter="video"><span>□</span>Slow Motion<small>8</small></button>`;
  navigation.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.mediaFilter) setMediaFilter(button.dataset.mediaFilter);
    else toast(button.dataset.vexaMediaNav === "favorites" ? "Favorites filter ready." : "Recent media filter ready.");
  });

  const main = make("div", "vexa-media-main");
  for (const selector of ["#dropZone", ".remote-import-card", "#mediaList", ".media-details", ".generated-section"]) {
    const node = panel.querySelector(selector);
    if (node) main.append(node);
  }
  browser.append(navigation, main);
  title.after(tabs, search, browser);
}

function activateDrawerSection(section, label) {
  const rail = document.querySelector(`.rail-button[data-section="${section}"]`);
  if (rail) {
    rail.click();
    toast(`${label} controls opened.`);
    return;
  }
  toast(`${label} is available through the Vexa SDK integration surface.`);
}

function installInspectorWorkflowTabs() {
  const panel = document.querySelector(".inspector-panel");
  const oldTabs = panel?.querySelector(".inspector-tabs");
  if (!panel || !oldTabs || $("vexaInspectorWorkflowTabs")) return;
  oldTabs.classList.add("vexa-legacy-inspector-tabs");
  const tabs = make("div", "vexa-inspector-workflow-tabs");
  tabs.id = "vexaInspectorWorkflowTabs";
  const items = [
    ["Inspector", null],
    ["Effects", "transformSection"],
    ["Color", "transformSection"],
    ["Audio", "audioSection"],
    ["Captions", "captionsSection"]
  ];
  items.forEach(([label, section], index) => {
    const button = make("button", index === 0 ? "active" : "", label);
    button.type = "button";
    button.addEventListener("click", () => {
      tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      if (section) activateDrawerSection(section, label);
      else $("inspectorContent")?.scrollTo({ top: 0, behavior: "smooth" });
    });
    tabs.append(button);
  });
  panel.prepend(tabs);
}

function installAiCard() {
  const content = $("inspectorContent");
  if (!content || $("vexaAiCard")) return;
  const card = make("section", "vexa-ai-card");
  card.id = "vexaAiCard";
  card.innerHTML = `
    <div class="vexa-ai-card-header"><strong>✦ AI Tools</strong><span>BETA</span><button type="button">See all</button></div>
    <div class="vexa-ai-grid">
      <button type="button" data-vexa-ai="captions"><i>CC</i><strong>Auto Captions</strong><small>Generate captions with AI</small></button>
      <button type="button" data-vexa-ai="reframe"><i>⌗</i><strong>Smart Reframe</strong><small>Reformat for any platform</small></button>
      <button type="button" data-vexa-ai="scene"><i>✣</i><strong>Scene Detect</strong><small>Find the best moments</small></button>
      <button type="button" data-vexa-ai="highlights"><i>✦</i><strong>Highlight Extraction</strong><small>Create clips automatically</small></button>
    </div>`;
  content.append(card);
  card.querySelector(".vexa-ai-card-header button").addEventListener("click", () => toast("AI editing workflows will surface here as each tool is enabled."));
  card.querySelector('[data-vexa-ai="captions"]').addEventListener("click", () => activateDrawerSection("captionsSection", "Captions"));
  card.querySelector('[data-vexa-ai="reframe"]').addEventListener("click", () => activateDrawerSection("projectSection", "Timeline"));
  card.querySelector('[data-vexa-ai="scene"]').addEventListener("click", () => toast("Scene Detect is exposed through @vexa-video/ai."));
  card.querySelector('[data-vexa-ai="highlights"]').addEventListener("click", () => toast("Highlight Extraction is exposed through @vexa-video/ai."));
}

function installPreviewChrome() {
  const toolbar = document.querySelector(".preview-toolbar");
  if (!toolbar || $("vexaPreviewHeading")) return;
  const heading = make("div", "vexa-preview-heading");
  heading.id = "vexaPreviewHeading";
  heading.innerHTML = '<span>▣</span><strong>Preview</strong>';
  toolbar.prepend(heading);

  const tools = make("div", "vexa-preview-tools");
  tools.innerHTML = `
    <button type="button" class="vexa-viewport-chip">4K UHD (3840 × 2160)</button>
    <button type="button" class="vexa-fit-chip">Fit⌄</button>
    <button type="button" data-vexa-panel="media" title="Toggle media">▦</button>
    <button type="button" data-vexa-panel="inspector" title="Toggle inspector">▤</button>`;
  toolbar.append(tools);
  tools.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vexa-panel]");
    if (!button) return;
    document.body.classList.toggle(`vexa-${button.dataset.vexaPanel}-open`);
  });
}

function sceneNodeLabel(node, index) {
  if (node.tagName === "IMG") return node.alt || `Image ${index + 1}`;
  if (node.tagName === "VIDEO") return node.getAttribute("aria-label") || `Video ${index + 1}`;
  if (node.classList.contains("studio-scene-text")) return node.textContent.trim().slice(0, 28) || `Text ${index + 1}`;
  const text = node.textContent.trim();
  if (text.includes(":")) return text.split(":").slice(1).join(":").trim();
  return text || `Layer ${index + 1}`;
}

function sceneNodeKind(node) {
  if (node.tagName === "IMG") return ["▧", "image"];
  if (node.tagName === "VIDEO") return ["▶", "video"];
  if (node.classList.contains("studio-scene-text")) return ["T", "text"];
  if (node.classList.contains("studio-scene-placeholder")) return ["◇", "node"];
  return ["■", "layer"];
}

function syncStudioTrackPlayhead() {
  const stack = $("vexaStudioTrackStack");
  const seek = $("studioSeek");
  if (!stack || !seek) return;
  const playhead = stack.querySelector(".vexa-studio-track-playhead");
  if (!playhead) return;
  const max = Math.max(1, Number(seek.max) || 1);
  const fraction = Math.min(1, Math.max(0, Number(seek.value) / max));
  playhead.style.left = `calc(104px + (100% - 104px) * ${fraction})`;
}

function syncStudioSceneNavigator() {
  const tree = $("vexaStudioSceneTree");
  const stack = $("vexaStudioTrackStack");
  const surface = $("studioSceneSurface");
  if (!tree || !surface) return;
  const nodes = [...surface.querySelectorAll(".studio-scene-node")];
  const rows = [];
  const background = make("div", "vexa-scene-row active");
  background.innerHTML = '<i>▧</i><span>Background</span><small>canvas</small>';
  rows.push(background);
  nodes.slice(0, 9).forEach((node, index) => {
    const [icon, kind] = sceneNodeKind(node);
    const row = make("div", "vexa-scene-row");
    row.innerHTML = `<i>${icon}</i><span>${sceneNodeLabel(node, index)}</span><small>${kind}</small>`;
    rows.push(row);
  });
  tree.replaceChildren(...rows);
  const count = $("vexaStudioSceneCount");
  if (count) count.textContent = String(rows.length);

  if (stack) {
    const colors = ["camera", "product", "background", "title", "overlay", "effect"];
    const trackRows = rows.slice(0, 6).map((row, index) => {
      const track = make("div", `vexa-studio-track-row ${colors[index] || "layer"}`);
      const label = make("div", "vexa-studio-track-label", row.querySelector("span")?.textContent || "Layer");
      const lane = make("div", "vexa-studio-track-lane");
      const clip = make("div", "vexa-studio-track-clip", index === 1 ? "product" : "");
      lane.append(clip);
      track.append(label, lane);
      return track;
    });
    const playhead = make("div", "vexa-studio-track-playhead");
    stack.replaceChildren(...trackRows, playhead);
    syncStudioTrackPlayhead();
  }
}

function scheduleStudioSceneSync() {
  if (ui.studioSceneSyncFrame) return;
  ui.studioSceneSyncFrame = requestAnimationFrame(() => {
    ui.studioSceneSyncFrame = 0;
    syncStudioSceneNavigator();
  });
}

function decorateStudioCompositions() {
  const list = $("studioCompositionList");
  if (!list) return;
  [...list.querySelectorAll(".studio-composition")].forEach((button, index) => {
    if (button.querySelector(".vexa-composition-thumb")) return;
    const thumb = make("span", `vexa-composition-thumb thumb-${index % 3}`);
    button.prepend(thumb);
  });
}

function installStudioEnhancements() {
  const panel = document.querySelector("#studioWorkspace .studio-compositions-panel");
  const timeline = document.querySelector("#studioWorkspace .studio-timeline");
  const surface = $("studioSceneSurface");
  const list = $("studioCompositionList");
  if (!panel || !timeline || !surface || !list) return false;

  const studioHeading = document.querySelector("#studioWorkspace .studio-heading h1");
  if (studioHeading) studioHeading.textContent = "Vexa Studio";
  const assetsTab = document.querySelector('[data-studio-panel="assets"]');
  if (assetsTab) assetsTab.textContent = "Scene";
  const consoleTab = document.querySelector('[data-studio-panel="console"]');
  if (consoleTab) consoleTab.textContent = "Logs";

  if (!$("vexaStudioScenePanel")) {
    const scenePanel = make("section", "vexa-studio-scene-panel");
    scenePanel.id = "vexaStudioScenePanel";
    scenePanel.innerHTML = `
      <div class="vexa-studio-scene-title"><strong>Scene</strong><span id="vexaStudioSceneCount">0</span></div>
      <div id="vexaStudioSceneTree" class="vexa-studio-scene-tree"></div>`;
    panel.append(scenePanel);
  }

  if (!$("vexaStudioTrackStack")) {
    const stack = make("div", "vexa-studio-track-stack");
    stack.id = "vexaStudioTrackStack";
    timeline.append(stack);
    $("studioSeek")?.addEventListener("input", syncStudioTrackPlayhead);
    $("studioSeek")?.addEventListener("change", syncStudioTrackPlayhead);
  }

  if (!ui.studioSceneObserver) {
    ui.studioSceneObserver = new MutationObserver(scheduleStudioSceneSync);
    ui.studioSceneObserver.observe(surface, { childList: true, subtree: true });
  }
  if (!ui.studioCompositionObserver) {
    ui.studioCompositionObserver = new MutationObserver(decorateStudioCompositions);
    ui.studioCompositionObserver.observe(list, { childList: true });
  }

  decorateStudioCompositions();
  syncStudioSceneNavigator();
  return true;
}

function installStudioEnhancementsWhenReady() {
  if (installStudioEnhancements()) return;
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    if (installStudioEnhancements() || attempts >= 45) return;
    requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

function install() {
  installBrandShell();
  installRailLabels();
  installMediaLibraryUi();
  installInspectorWorkflowTabs();
  installAiCard();
  installPreviewChrome();
  installStudioEnhancementsWhenReady();
  window.addEventListener("resize", () => requestAnimationFrame(syncModeUi));
}

install();

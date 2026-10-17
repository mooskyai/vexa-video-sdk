const $ = (id) => document.getElementById(id);

function previewWorkspace() {
  return document.querySelector(".preview-workspace");
}

function activeWorkspaceMode() {
  if (document.body.classList.contains("bundler-workspace-active")) return "bundler";
  if (document.body.classList.contains("player-workspace-active")) return "player";
  return null;
}

function syncResponsiveRoot() {
  document.documentElement.classList.toggle("workspace-responsive-mode", activeWorkspaceMode() !== null);
}

function isWorkspaceFullscreen() {
  const workspace = previewWorkspace();
  return Boolean(workspace && (document.fullscreenElement === workspace || workspace.classList.contains("workspace-pseudo-fullscreen")));
}

function updateFullscreenButtons() {
  const active = isWorkspaceFullscreen();
  for (const id of ["bundlerWorkspaceFullscreen", "playerWorkspaceFullscreen"]) {
    const button = $(id);
    if (!button) continue;
    button.textContent = active ? "Exit full screen" : "Full screen";
    button.setAttribute("aria-pressed", String(active));
  }
}

async function exitWorkspaceFullscreen() {
  const workspace = previewWorkspace();
  if (!workspace) return;
  workspace.classList.remove("workspace-pseudo-fullscreen");
  if (document.fullscreenElement === workspace) await document.exitFullscreen();
  updateFullscreenButtons();
  window.dispatchEvent(new Event("resize"));
}

async function enterWorkspaceFullscreen() {
  const workspace = previewWorkspace();
  if (!workspace) return;
  if (isWorkspaceFullscreen()) {
    await exitWorkspaceFullscreen();
    return;
  }

  if (document.fullscreenElement && document.fullscreenElement !== workspace) {
    await document.exitFullscreen();
  }

  try {
    if (workspace.requestFullscreen) {
      await workspace.requestFullscreen();
    } else {
      workspace.classList.add("workspace-pseudo-fullscreen");
    }
  } catch {
    workspace.classList.add("workspace-pseudo-fullscreen");
  }

  updateFullscreenButtons();
  window.dispatchEvent(new Event("resize"));
}

function makeButton(id, className, text, title) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.title = title;
  return button;
}

function makeFullscreenButton(id, label) {
  const button = makeButton(
    id,
    "button secondary compact workspace-fullscreen-button",
    "Full screen",
    label
  );
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => void enterWorkspaceFullscreen());
  return button;
}

function syncBundlerFocusButton() {
  const workspace = $("bundlerWorkspace");
  const button = $("bundlerRenderFocus");
  if (!workspace || !button) return;
  const focused = workspace.classList.contains("render-focus");
  button.textContent = focused ? "Show all" : "Focus render";
  button.setAttribute("aria-pressed", String(focused));
  button.title = focused
    ? "Restore discovery, bundle outputs, and manifest panels"
    : "Expand render controls and generated output";
}

function toggleBundlerFocus() {
  const workspace = $("bundlerWorkspace");
  if (!workspace) return;
  workspace.classList.toggle("render-focus");
  syncBundlerFocusButton();
  window.dispatchEvent(new Event("resize"));
}

function rendererGuidanceText() {
  const target = $("rendererTarget")?.value;
  const frame = Number($("rendererFrame")?.value ?? 0);
  const end = Number($("rendererEndFrame")?.value ?? 0);
  const hardware = $("rendererHardware")?.value ?? "cpu";

  if (target === "still") return "Still output → one image from the composition's single frame.";
  if (target === "frame") return `Frame ${Math.max(0, frame)} → one image artifact.`;
  if (target === "frame-range") {
    const count = Number.isFinite(end - frame) ? Math.max(0, end - frame) : 0;
    return `Frames ${Math.max(0, frame)} → ${Math.max(0, end)} use an exclusive end and will create ${count} image${count === 1 ? "" : "s"}.`;
  }
  if (target === "video") {
    return `Video ${Math.max(0, frame)} → ${Math.max(0, end)} uses an exclusive end and renders through ${hardware.toUpperCase()} selection.`;
  }
  return "Choose an output target, create a plan, then render the artifact.";
}

function updateRendererGuidance() {
  const guidance = $("rendererGuidance");
  if (guidance) guidance.textContent = rendererGuidanceText();
}

function installRendererGuidance() {
  if ($("rendererGuidance")) return true;
  const plan = $("rendererPlan");
  if (!plan?.parentElement) return false;
  const guidance = document.createElement("div");
  guidance.id = "rendererGuidance";
  guidance.className = "renderer-guidance";
  guidance.setAttribute("aria-live", "polite");
  plan.parentElement.insertBefore(guidance, plan);

  for (const id of ["rendererTarget", "rendererFrame", "rendererEndFrame", "rendererHardware"]) {
    $(id)?.addEventListener("input", updateRendererGuidance);
    $(id)?.addEventListener("change", updateRendererGuidance);
  }
  updateRendererGuidance();
  return true;
}

function installBundlerEnhancements() {
  const actions = document.querySelector("#bundlerWorkspace .bundler-actions");
  if (!actions) return false;

  if (!$("bundlerRenderFocus")) {
    const focus = makeButton(
      "bundlerRenderFocus",
      "button secondary compact workspace-focus-button",
      "Focus render",
      "Expand render controls and generated output"
    );
    focus.setAttribute("aria-pressed", "false");
    focus.addEventListener("click", toggleBundlerFocus);
    actions.append(focus);
  }

  if (!$("bundlerWorkspaceFullscreen")) {
    actions.append(makeFullscreenButton("bundlerWorkspaceFullscreen", "Toggle the Compositions workspace full screen"));
  }

  syncBundlerFocusButton();
  return installRendererGuidance();
}

function syncPlayerDetailsButton() {
  const stage = $("playerDemoStage");
  const button = $("playerWorkspaceDetails");
  if (!stage || !button) return;
  const collapsed = stage.classList.contains("player-details-collapsed");
  button.textContent = collapsed ? "Show details" : "Hide details";
  button.setAttribute("aria-pressed", String(collapsed));
  button.title = collapsed ? "Show Player diagnostics" : "Give the Player canvas more room";
}

function togglePlayerDetails() {
  const stage = $("playerDemoStage");
  if (!stage) return;
  stage.classList.toggle("player-details-collapsed");
  syncPlayerDetailsButton();
  window.dispatchEvent(new Event("resize"));
}

function installPlayerEnhancements() {
  const heading = document.querySelector("#playerDemoStage .player-workspace-heading");
  const status = heading?.querySelector(".player-status-card");
  if (!heading || !status) return false;

  const canvasFullscreen = $("playerDemoFullscreen");
  if (canvasFullscreen) {
    canvasFullscreen.textContent = "Canvas";
    canvasFullscreen.title = "Toggle only the Player canvas full screen";
  }

  let actions = heading.querySelector(".workspace-heading-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "workspace-heading-actions";
    status.replaceWith(actions);
    actions.append(status);
  }

  if (!$("playerWorkspaceDetails")) {
    const details = makeButton(
      "playerWorkspaceDetails",
      "button secondary compact workspace-details-button",
      "Hide details",
      "Give the Player canvas more room"
    );
    details.setAttribute("aria-pressed", "false");
    details.addEventListener("click", togglePlayerDetails);
    actions.append(details);
  }

  if (!$("playerWorkspaceFullscreen")) {
    actions.append(makeFullscreenButton("playerWorkspaceFullscreen", "Toggle the complete Player workspace full screen"));
  }

  syncPlayerDetailsButton();
  return true;
}

function installWorkspaceEnhancements(attempt = 0) {
  syncResponsiveRoot();
  const bundlerReady = installBundlerEnhancements();
  const playerReady = installPlayerEnhancements();
  updateFullscreenButtons();

  if ((!bundlerReady || !playerReady) && attempt < 30) {
    requestAnimationFrame(() => installWorkspaceEnhancements(attempt + 1));
  }
}

const bodyClassObserver = new MutationObserver(() => {
  syncResponsiveRoot();
  updateRendererGuidance();
});
bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

document.addEventListener("fullscreenchange", () => {
  updateFullscreenButtons();
  window.dispatchEvent(new Event("resize"));
});

window.addEventListener("keydown", (event) => {
  const workspace = previewWorkspace();
  if (event.key === "Escape" && workspace?.classList.contains("workspace-pseudo-fullscreen")) {
    workspace.classList.remove("workspace-pseudo-fullscreen");
    updateFullscreenButtons();
    window.dispatchEvent(new Event("resize"));
    return;
  }

  if (event.shiftKey && event.key.toLowerCase() === "f" && activeWorkspaceMode()) {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    void enterWorkspaceFullscreen();
  }
});

installWorkspaceEnhancements();

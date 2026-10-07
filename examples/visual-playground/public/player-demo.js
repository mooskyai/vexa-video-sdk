import {
  createVexaPlayerController,
  mountVexaPlayer
} from "@vexa-video/player";

const $ = (id) => document.getElementById(id);
const WIDTH = 960;
const HEIGHT = 540;
const FPS = 30;
const DURATION_IN_FRAMES = 300;

const runtime = {
  controller: null,
  mounted: null,
  unsubscribe: null,
  events: []
};

function formatEvent(event) {
  const snapshot = event.snapshot;
  if (event.type === "frame") return `frame ${event.previousFrame} → ${event.frame}`;
  if (event.type === "seek") return `seek ${event.previousFrame} → ${event.frame}`;
  if (event.type === "loop") return `loop wraps=${event.wraps}`;
  if (event.type === "error") return `error ${event.error}`;
  return `${event.type} frame=${snapshot.frame}`;
}

function appendEvent(event) {
  if (event.type === "statechange") return;
  if (event.type === "frame" && event.frame % 10 !== 0 && event.frame !== DURATION_IN_FRAMES - 1) return;
  runtime.events.unshift(formatEvent(event));
  runtime.events = runtime.events.slice(0, 18);
  $("playerDemoEvents").textContent = runtime.events.join("\n") || "No events yet.";
}

function ensureFrameScene(viewport) {
  let scene = viewport.querySelector("[data-player-demo-scene]");
  if (scene) return scene;

  viewport.classList.add("player-demo-viewport");
  viewport.innerHTML = `
    <div class="player-demo-scene" data-player-demo-scene>
      <div class="player-demo-grid"></div>
      <div class="player-demo-orbit" data-player-demo-orbit></div>
      <div class="player-demo-copy">
        <span>Vexa programmable playback</span>
        <strong data-player-demo-title>FRAME 000</strong>
        <p>Deterministic browser state driven by @vexa-video/player.</p>
      </div>
      <div class="player-demo-progress"><i data-player-demo-progress></i></div>
      <div class="player-demo-frame-chip" data-player-demo-chip>0.00s</div>
    </div>`;
  return viewport.querySelector("[data-player-demo-scene]");
}

function renderFrame({ frame, viewport }) {
  const scene = ensureFrameScene(viewport);
  const progress = frame / (DURATION_IN_FRAMES - 1);
  const orbit = scene.querySelector("[data-player-demo-orbit]");
  const title = scene.querySelector("[data-player-demo-title]");
  const progressBar = scene.querySelector("[data-player-demo-progress]");
  const chip = scene.querySelector("[data-player-demo-chip]");
  const x = 8 + progress * 78;
  const y = 42 + Math.sin(progress * Math.PI * 4) * 18;
  orbit.style.left = `${x}%`;
  orbit.style.top = `${y}%`;
  orbit.style.transform = `translate(-50%, -50%) rotate(${progress * 540}deg) scale(${0.8 + progress * 0.45})`;
  title.textContent = `FRAME ${String(frame).padStart(3, "0")}`;
  progressBar.style.width = `${progress * 100}%`;
  chip.textContent = `${(frame / FPS).toFixed(2)}s`;
  scene.style.setProperty("--player-glow-x", `${18 + progress * 55}%`);
}

function sync(snapshot) {
  const statusLabel = snapshot.buffering
    ? "Buffering"
    : snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1);
  $("playerDemoStatus").textContent = statusLabel;
  $("playerDemoFrame").textContent = `${snapshot.frame} / ${DURATION_IN_FRAMES - 1}`;
  $("playerDemoTime").textContent = `${snapshot.seconds.toFixed(2)}s`;
  $("playerDemoVolumeReadout").textContent = `${Math.round(snapshot.effectiveVolume * 100)}%`;
  $("playerDemoScale").textContent = `${snapshot.viewport.scale.toFixed(3)}×`;
  $("playerDemoSeek").value = String(snapshot.frame);
  $("playerDemoPlay").textContent = snapshot.playing ? "Ⅱ" : "▶";
  $("playerDemoPlay").setAttribute("aria-label", snapshot.playing ? "Pause programmable player" : "Play programmable player");
  $("playerDemoMute").textContent = snapshot.muted ? "Unmute" : "Mute";
  $("playerDemoLoop").checked = snapshot.loop;
  $("playerDemoBuffering").checked = snapshot.buffering;
  $("playerDemoVolume").value = String(snapshot.volume);
  $("playerDemoRate").value = String(snapshot.playbackRate);
}

function disposePlayer() {
  runtime.unsubscribe?.();
  runtime.unsubscribe = null;
  runtime.mounted?.dispose();
  runtime.mounted = null;
  runtime.controller?.dispose();
  runtime.controller = null;
  $("playerDemoMount").replaceChildren();
}

function mountPlayer({ preserve = false } = {}) {
  const previous = preserve && runtime.controller ? runtime.controller.getSnapshot() : null;
  const wasPlaying = previous?.playing ?? false;
  const initialFrame = previous?.frame ?? 0;
  const loop = previous?.loop ?? $("playerDemoLoop").checked;
  const volume = previous?.volume ?? Number($("playerDemoVolume").value);
  const muted = previous?.muted ?? false;
  const playbackRate = previous?.playbackRate ?? Number($("playerDemoRate").value);

  disposePlayer();

  const controller = createVexaPlayerController({
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    durationInFrames: DURATION_IN_FRAMES,
    initialFrame,
    posterFrame: 0,
    loop,
    volume,
    muted,
    playbackRate,
    fit: $("playerDemoFit").value,
    controls: $("playerDemoControls").value,
    ariaLabel: "Vexa programmable player"
  });

  const mounted = mountVexaPlayer($("playerDemoMount"), controller, {
    controls: $("playerDemoControls").value,
    renderFrame
  });

  runtime.controller = controller;
  runtime.mounted = mounted;
  $("playerDemoStage").dataset.playerMounted = "true";
  runtime.unsubscribe = controller.subscribe((event) => {
    appendEvent(event);
    sync(event.snapshot);
  });

  mounted.refreshLayout();
  sync(controller.getSnapshot());
  if (wasPlaying) controller.play();
}

function showPlayerDemo() {
  document.body.classList.add("player-workspace-active");
  $("sourceTab").classList.remove("active");
  $("outputTab").classList.remove("active");
  $("playerTab").classList.add("active");
  document.querySelectorAll(".rail-button").forEach((item) => item.classList.toggle("active", item.id === "playerRailButton"));
  $("emptyStage").classList.add("hidden");
  $("videoStage").classList.add("hidden");
  $("mediaTransportBar").classList.add("hidden");
  $("playerDemoStage").classList.remove("hidden");
  $("playerDemoTransport").classList.remove("hidden");
  $("previewBadge").textContent = "Player";
  $("previewResolution").textContent = `${WIDTH}×${HEIGHT} · ${FPS}fps`;
  if (!runtime.controller) mountPlayer();
  runtime.mounted?.refreshLayout();
}

function hidePlayerDemo({ restoreMediaRail = true } = {}) {
  document.body.classList.remove("player-workspace-active");
  $("playerTab").classList.remove("active");
  $("playerDemoStage").classList.add("hidden");
  $("playerDemoTransport").classList.add("hidden");
  $("mediaTransportBar").classList.remove("hidden");
  runtime.controller?.pause();
  if (restoreMediaRail) {
    document.querySelectorAll(".rail-button").forEach((item) => {
      item.classList.toggle("active", item.dataset.section === "mediaPanel");
    });
  }
}

$("playerTab").addEventListener("click", showPlayerDemo);
$("playerRailButton").addEventListener("click", showPlayerDemo);

document.addEventListener("click", (event) => {
  const railButton = event.target.closest?.(".rail-button");
  if (!railButton || railButton.id === "playerRailButton" || !document.body.classList.contains("player-workspace-active")) return;
  hidePlayerDemo({ restoreMediaRail: false });
  $("sourceTab").click();
}, true);
$("sourceTab").addEventListener("click", hidePlayerDemo);
$("outputTab").addEventListener("click", hidePlayerDemo);

$("playerDemoPlay").addEventListener("click", () => {
  const controller = runtime.controller;
  if (!controller) return;
  controller.getSnapshot().playing ? controller.pause() : controller.play();
});

$("playerDemoStepBack").addEventListener("click", () => runtime.controller?.stepFrames(-1));
$("playerDemoStepForward").addEventListener("click", () => runtime.controller?.stepFrames(1));
$("playerDemoSeek").addEventListener("input", () => runtime.controller?.seekToFrame(Number($("playerDemoSeek").value)));
$("playerDemoLoop").addEventListener("change", () => runtime.controller?.setLoop($("playerDemoLoop").checked));
$("playerDemoBuffering").addEventListener("change", () => runtime.controller?.setBuffering($("playerDemoBuffering").checked));
$("playerDemoVolume").addEventListener("input", () => runtime.controller?.setVolume(Number($("playerDemoVolume").value)));
$("playerDemoMute").addEventListener("click", () => runtime.controller?.toggleMuted());
$("playerDemoRate").addEventListener("change", () => runtime.controller?.setPlaybackRate(Number($("playerDemoRate").value)));
$("playerDemoFit").addEventListener("change", () => mountPlayer({ preserve: true }));
$("playerDemoControls").addEventListener("change", () => mountPlayer({ preserve: true }));

$("playerDemoFullscreen").addEventListener("click", async () => {
  if (!runtime.mounted || !runtime.controller) return;
  try {
    if (runtime.controller.getSnapshot().fullscreen) await runtime.mounted.exitFullscreen();
    else await runtime.mounted.requestFullscreen();
  } catch (error) {
    runtime.controller.setError(error instanceof Error ? error : String(error));
  }
});

$("playerDemoReset").addEventListener("click", () => {
  const controller = runtime.controller;
  if (!controller) return;
  if (controller.getSnapshot().status === "error") controller.clearError();
  controller.pause();
  controller.setBuffering(false);
  controller.setLoop(false);
  controller.setMuted(false);
  controller.setVolume(1);
  controller.setPlaybackRate(1);
  controller.seekToFrame(0);
});

$("playerDemoClearEvents").addEventListener("click", () => {
  runtime.events = [];
  $("playerDemoEvents").textContent = "Event log cleared.";
});

window.addEventListener("keydown", (event) => {
  if (!$("playerTab").classList.contains("active") || event.code !== "Space") return;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const controller = runtime.controller;
  if (!controller) return;
  controller.getSnapshot().playing ? controller.pause() : controller.play();
}, true);

$("playerTab").dataset.playerRuntime = "ready";
if (window.location.hash === "#player-demo") {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}
window.addEventListener("beforeunload", disposePlayer);

$("playerDemoEvents").textContent = "Player ready. Open the Player workspace to begin.";

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repositoryRoot = resolve(import.meta.dirname, "..");
const studioSourceRelative = "examples/visual-playground/compositions/metadata.ts";
const acceptanceRoot = resolve(repositoryRoot, ".tmp/v2-studio-browser-acceptance");

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolvePort(port) : reject(new Error("Unable to allocate local port.")));
    });
  });
}

function where(command) {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).map((item) => item.trim()).find(Boolean) ?? null;
}

function browserCandidates() {
  const explicit = String(process.env.VEXA_STUDIO_BROWSER ?? "").trim();
  const values = explicit ? [explicit] : [];
  if (process.platform === "win32") {
    for (const command of ["chrome.exe", "msedge.exe", "chromium.exe"]) {
      const found = where(command);
      if (found) values.push(found);
    }
    for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (!root) continue;
      values.push(join(root, "Google/Chrome/Application/chrome.exe"));
      values.push(join(root, "Microsoft/Edge/Application/msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    values.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    values.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
    values.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
      const found = where(command);
      if (found) values.push(found);
    }
  }
  return [...new Set(values)];
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Chromium browser not found. Set VEXA_STUDIO_BROWSER to Chrome/Edge/Chromium executable path.");
}

async function createExecutionRoot() {
  if (process.platform !== "win32") return { root: repositoryRoot, link: null };
  const parent = resolve(acceptanceRoot, "repository path with spaces");
  const linkedRoot = resolve(parent, "vexa video sdk");
  await mkdir(parent, { recursive: true });
  await symlink(repositoryRoot, linkedRoot, "junction");
  return { root: linkedRoot, link: linkedRoot };
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else pending.resolve(message.result ?? {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) pending.reject(new Error("Chromium DevTools connection closed."));
      this.#pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
  }
}

async function connectWebSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("Unable to connect to Chromium DevTools.")), { once: true });
  });
  return new CdpClient(socket);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Browser evaluation failed.");
  }
  return result.result?.value;
}

async function waitForExpression(cdp, expression, { timeoutMs = 20_000, label = expression } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, expression);
    if (last) return last;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(last)}`);
}

async function waitForStudioRenderTerminal(cdp, { timeoutMs = 125_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, `(() => ({
      status: document.querySelector("#studioStatus")?.textContent ?? "",
      target: document.querySelector("#studioRenderTarget")?.value ?? "",
      progress: Number(document.querySelector("#studioRenderProgress")?.value || 0),
      progressText: document.querySelector("#studioRenderProgressText")?.textContent ?? "",
      propsState: document.querySelector("#studioPropsState")?.textContent ?? "",
      renderDisabled: Boolean(document.querySelector("#studioRenderButton")?.disabled),
      outputUrl: document.querySelector("#studioRenderOutput a")?.href ?? "",
      outputImage: Boolean(document.querySelector("#studioRenderOutput img")),
      errorVisible: !document.querySelector("#studioErrorOverlay")?.classList.contains("hidden"),
      errorTitle: document.querySelector("#studioErrorTitle")?.textContent ?? "",
      errorMessage: document.querySelector("#studioErrorMessage")?.textContent ?? ""
    }))()`);
    const completed =
      last?.progress === 100 &&
      /^Complete\b/u.test(last?.progressText ?? "") &&
      Boolean(last?.outputUrl) &&
      last?.outputImage === true &&
      last?.renderDisabled === false;
    const failed =
      last?.errorVisible === true &&
      last?.errorTitle === "Render failed" &&
      last?.renderDisabled === false;
    if (completed || failed) return { ...last, outcome: completed ? "complete" : "failed" };
    await delay(100);
  }
  throw new Error(`Timed out waiting for Studio render terminal state. Last state: ${JSON.stringify(last)}`);
}

async function createPage(debugPort, pageUrl) {
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create Chromium page: HTTP ${response.status}`);
  const page = await response.json();
  if (!page.webSocketDebuggerUrl) throw new Error("Chromium page did not expose a DevTools websocket URL.");
  return page;
}

async function run() {
  const browser = findBrowser();
  const playgroundPort = await freePort();
  const debugPort = await freePort();
  const playgroundUrl = `http://127.0.0.1:${playgroundPort}/`;
  const userDataDir = resolve(acceptanceRoot, "chromium-profile");
  await rm(acceptanceRoot, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const execution = await createExecutionRoot();
  const executionRoot = execution.root;
  const studioSource = resolve(executionRoot, studioSourceRelative);
  const repositoryPathHasSpaces = executionRoot.includes(" ");
  if (process.platform === "win32" && !repositoryPathHasSpaces) {
    throw new Error(`Windows Studio acceptance must execute through a repository path containing spaces: ${executionRoot}`);
  }

  const playground = spawn(process.execPath, ["--preserve-symlinks-main", "examples/visual-playground/server.mjs"], {
    cwd: executionRoot,
    env: { ...process.env, VEXA_PLAYGROUND_PORT: String(playgroundPort) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const browserProcess = spawn(browser, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-component-update",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--window-size=1600,1000",
    "about:blank"
  ], {
    cwd: executionRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let cdp = null;
  try {
    await waitForHttp(playgroundUrl);
    const page = await createPage(debugPort, playgroundUrl);
    cdp = await connectWebSocket(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.bringToFront");
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.send("Page.navigate", { url: playgroundUrl });

    await waitForExpression(cdp, 'document.readyState === "complete"', { label: "Playground page load" });
    await waitForExpression(cdp, 'Boolean(document.querySelector("#studioTab"))', { label: "Studio tab" });
    await evaluate(cdp, 'document.querySelector("#studioTab").click(); true');
    await waitForExpression(cdp, 'document.querySelector("#studioStatus")?.textContent === "Bundle ready"', {
      timeoutMs: 30_000,
      label: "initial Studio bundle"
    });

    const compositionCount = await evaluate(cdp, 'Number(document.querySelector("#studioCompositionCount")?.textContent || 0)');
    if (compositionCount < 3) throw new Error(`Expected at least 3 Studio compositions, received ${compositionCount}.`);

    await evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll("#studioCompositionList .studio-composition")]
        .find((item) => item.querySelector("strong")?.textContent === "social-square");
      if (!button) throw new Error("social-square composition button was not found.");
      button.click();
      return true;
    })()`);
    await waitForExpression(cdp, 'document.querySelector("#studioPreviewTitle")?.textContent === "social-square"', { label: "composition switch to still" });
    await evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll("#studioCompositionList .studio-composition")]
        .find((item) => item.querySelector("strong")?.textContent === "product-demo");
      if (!button) throw new Error("product-demo composition button was not found.");
      button.click();
      return true;
    })()`);
    await waitForExpression(cdp, 'document.querySelector("#studioPreviewTitle")?.textContent === "product-demo"', { label: "composition switch back to video" });

    await cdp.send("Page.bringToFront");
    await evaluate(cdp, 'document.querySelector("#studioPlay").click(); true');
    await waitForExpression(cdp, 'document.querySelector("#studioPlay")?.textContent === "Ⅱ"', {
      timeoutMs: 2_000,
      label: "Studio play state"
    });
    await evaluate(cdp, 'document.querySelector("#studioPlay").click(); true');
    await waitForExpression(cdp, 'document.querySelector("#studioPlay")?.textContent === "▶"', {
      timeoutMs: 2_000,
      label: "Studio pause state"
    });
    const pausedFrame = await evaluate(cdp, 'document.querySelector("#studioFrameBadge")?.textContent');
    await delay(250);
    const pausedFrameAfterDelay = await evaluate(cdp, 'document.querySelector("#studioFrameBadge")?.textContent');
    if (pausedFrame !== pausedFrameAfterDelay) throw new Error(`Studio did not remain paused: ${pausedFrame} -> ${pausedFrameAfterDelay}`);

    // Headless Chromium may suspend requestAnimationFrame despite an active Player state.
    // Browser acceptance therefore verifies the play/pause contract here, while the
    // Studio unit suite deterministically covers play + advanceByMilliseconds timing.
    await evaluate(cdp, 'document.querySelector("#studioStepForward").click(); true');
    const steppedFrame = await waitForExpression(cdp, 'document.querySelector("#studioFrameBadge")?.textContent === "Frame 1" && document.querySelector("#studioFrameBadge")?.textContent', {
      timeoutMs: 2_000,
      label: "Studio frame-step control"
    });

    await evaluate(cdp, `(() => {
      const seek = document.querySelector("#studioSeek");
      seek.value = "50";
      seek.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await waitForExpression(cdp, 'document.querySelector("#studioFrameBadge")?.textContent === "Frame 50"', { label: "frame 50" });

    const draft = JSON.stringify({ background: "#16324f", fps: 60, storageAssetKey: "" }, null, 2);
    await evaluate(cdp, `(() => {
      const props = document.querySelector("#studioProps");
      props.value = ${JSON.stringify(draft)};
      props.dispatchEvent(new Event("input", { bubbles: true }));
      return props.value;
    })()`);

    const sourceText = await readFile(studioSource, "utf8");
    await writeFile(studioSource, sourceText, "utf8");
    await waitForExpression(cdp, 'Number(document.querySelector("#studioWatchState")?.dataset.revision || 0) > 0', {
      timeoutMs: 20_000,
      label: "source watch event"
    });
    await waitForExpression(cdp, 'document.querySelector("#studioStatus")?.textContent === "Bundle ready"', {
      timeoutMs: 30_000,
      label: "automatic hot reload"
    });

    const preserved = await evaluate(cdp, `(() => ({
      frame: document.querySelector("#studioFrameBadge")?.textContent,
      draft: document.querySelector("#studioProps")?.value,
      watch: document.querySelector("#studioWatchState")?.textContent.trim()
    }))()`);
    if (preserved.frame !== "Frame 50") throw new Error(`Hot reload did not preserve frame: ${preserved.frame}`);
    if (preserved.draft !== draft) throw new Error("Hot reload did not preserve dirty props draft.");

    await evaluate(cdp, `(() => {
      const props = document.querySelector("#studioProps");
      props.value = "{";
      props.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#studioApplyProps").click();
      return true;
    })()`);
    await waitForExpression(cdp, '!document.querySelector("#studioErrorOverlay")?.classList.contains("hidden")', {
      label: "Studio error overlay"
    });

    await evaluate(cdp, `(() => {
      const props = document.querySelector("#studioProps");
      props.value = ${JSON.stringify(draft)};
      props.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#studioApplyProps").click();
      return true;
    })()`);
    await waitForExpression(cdp, 'document.querySelector("#studioErrorOverlay")?.classList.contains("hidden")', {
      label: "Studio error recovery"
    });

    await evaluate(cdp, `(() => {
      const renderTarget = document.querySelector("#studioRenderTarget");
      renderTarget.value = "frame";
      renderTarget.dispatchEvent(new Event("change", { bubbles: true }));
      window.__vexaStudioAcceptanceProgress = [];
      const progressText = document.querySelector("#studioRenderProgressText");
      const record = () => window.__vexaStudioAcceptanceProgress.push(progressText?.textContent ?? "");
      record();
      new MutationObserver(record).observe(progressText, { childList: true, subtree: true, characterData: true });
      document.querySelector("#studioRenderButton").click();
      return true;
    })()`);
    const renderTerminal = await waitForStudioRenderTerminal(cdp);
    if (renderTerminal.outcome !== "complete") {
      throw new Error(`Studio current-frame render failed: ${JSON.stringify(renderTerminal)}`);
    }
    const renderSuccess = await evaluate(cdp, `(() => ({
      progress: Number(document.querySelector("#studioRenderProgress")?.value || 0),
      progressText: document.querySelector("#studioRenderProgressText")?.textContent,
      outputUrl: document.querySelector("#studioRenderOutput a")?.href ?? "",
      image: Boolean(document.querySelector("#studioRenderOutput img")),
      progressEvents: window.__vexaStudioAcceptanceProgress ?? []
    }))()`);
    if (renderSuccess.progress !== 100 || !renderSuccess.image || !renderSuccess.outputUrl) {
      throw new Error(`Studio render acceptance failed: ${JSON.stringify(renderSuccess)}`);
    }
    if (!renderSuccess.progressEvents.some((value) => /Starting|%|Complete/u.test(value))) {
      throw new Error(`Studio render did not expose progress state: ${JSON.stringify(renderSuccess.progressEvents)}`);
    }

    const failingProps = JSON.stringify({ background: "#16324f", fps: 60, storageAssetKey: "acceptance/missing-product-art.png" }, null, 2);
    await evaluate(cdp, `(() => {
      const props = document.querySelector("#studioProps");
      props.value = ${JSON.stringify(failingProps)};
      props.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#studioApplyProps").click();
      return true;
    })()`);
    await waitForExpression(cdp, 'document.querySelector("#studioPropsState")?.textContent === "resolved"', { label: "render-failure props evaluation" });
    await evaluate(cdp, 'document.querySelector("#studioRenderButton").click(); true');
    const failureTerminal = await waitForStudioRenderTerminal(cdp);
    if (failureTerminal.outcome !== "failed") {
      throw new Error(`Studio render failure did not reach the failure surface: ${JSON.stringify(failureTerminal)}`);
    }
    const renderFailure = await evaluate(cdp, `(() => ({
      visible: !document.querySelector("#studioErrorOverlay")?.classList.contains("hidden"),
      title: document.querySelector("#studioErrorTitle")?.textContent,
      message: document.querySelector("#studioErrorMessage")?.textContent ?? ""
    }))()`);
    if (!renderFailure.visible || renderFailure.title !== "Render failed" || !renderFailure.message.trim()) {
      throw new Error(`Studio render failure was not surfaced: ${JSON.stringify(renderFailure)}`);
    }

    await evaluate(cdp, `(() => {
      const props = document.querySelector("#studioProps");
      props.value = ${JSON.stringify(draft)};
      props.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#studioApplyProps").click();
      return true;
    })()`);
    await waitForExpression(cdp, 'document.querySelector("#studioErrorOverlay")?.classList.contains("hidden")', { label: "render failure recovery" });

    const summary = await evaluate(cdp, `(() => ({
      status: document.querySelector("#studioStatus")?.textContent,
      watch: document.querySelector("#studioWatchState")?.textContent.trim(),
      revision: Number(document.querySelector("#studioWatchState")?.dataset.revision || 0),
      compositionCount: Number(document.querySelector("#studioCompositionCount")?.textContent || 0),
      frame: document.querySelector("#studioFrameBadge")?.textContent,
      propsState: document.querySelector("#studioPropsState")?.textContent,
      renderStatus: document.querySelector("#studioRenderProgressText")?.textContent
    }))()`);

    console.log(JSON.stringify({
      acceptance: "v2-studio",
      browser,
      repositoryPathHasSpaces,
      compositionSwitch: true,
      playbackControl: { playPause: true, steppedFrame },
      frameRender: { progress: renderSuccess.progress, outputUrl: renderSuccess.outputUrl },
      renderFailureSurfaced: true,
      ...summary
    }, null, 2));
  } finally {
    cdp?.close();
    browserProcess.kill();
    playground.kill();
    await delay(200);
    if (execution.link) await unlink(execution.link).catch(() => {});
    await rm(acceptanceRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

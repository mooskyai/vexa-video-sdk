import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = resolve(root, "packages");
const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");
const playgroundEntry = resolve(root, "examples", "visual-playground", "server.mjs");

let shuttingDown = false;
let tscChild;
let testChild;
let playgroundChild;
let testDebounce;
let rerunTests = false;
let restartPlaygroundWhenStopped = false;

function stopTests() {
  if (!testChild) return;
  testChild.kill("SIGTERM");
  testChild = undefined;
}

function runTests() {
  if (shuttingDown) return;

  if (testChild) {
    rerunTests = true;
    return;
  }

  console.log("[dev] Running tests...");

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", "packages/**/*.test.ts"],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    }
  );

  testChild = child;

  child.once("exit", (code, signal) => {
    if (testChild === child) testChild = undefined;
    if (shuttingDown) return;

    if (signal) {
      console.log(`[dev] Test run stopped by ${signal}.`);
    } else if (code === 0) {
      console.log("[dev] Tests passed. Watching for changes...");
    } else {
      console.error(`[dev] Tests failed with code ${code ?? 1}. Watching for changes...`);
    }

    if (rerunTests) {
      rerunTests = false;
      scheduleTests();
    }
  });
}

function scheduleTests(delayMs = 100) {
  if (shuttingDown) return;
  clearTimeout(testDebounce);
  testDebounce = setTimeout(runTests, delayMs);
}

function startPlayground() {
  if (shuttingDown || playgroundChild) return;

  console.log("[dev] Starting visual playground...");
  const child = spawn(process.execPath, [playgroundEntry], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  });

  playgroundChild = child;
  child.once("exit", (code, signal) => {
    if (playgroundChild === child) playgroundChild = undefined;
    if (shuttingDown) return;

    if (restartPlaygroundWhenStopped) {
      restartPlaygroundWhenStopped = false;
      startPlayground();
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[dev] Visual playground exited with ${reason}.`);
  });
}

function stopPlayground(restart = false) {
  if (!playgroundChild) {
    if (restart) startPlayground();
    return;
  }

  restartPlaygroundWhenStopped = restart;
  playgroundChild.kill("SIGTERM");
}

function restartPlayground() {
  stopPlayground(true);
}

function handleTscLine(line) {
  if (line.includes("File change detected. Starting incremental compilation")) {
    clearTimeout(testDebounce);
    rerunTests = false;
    stopTests();
    return;
  }

  const result = line.match(/Found (\d+) errors?\. Watching for file changes\./);
  if (!result) return;

  const errorCount = Number(result[1]);
  if (errorCount === 0) {
    scheduleTests();
    restartPlayground();
  } else {
    clearTimeout(testDebounce);
    rerunTests = false;
    stopTests();
    stopPlayground(false);
    console.log("[dev] Tests and playground paused until TypeScript compiles without errors.");
  }
}

function startTypeScriptWatcher() {
  console.log("[dev] TypeScript build watcher starting...");

  const child = spawn(
    process.execPath,
    [tsc, "-b", "--watch", "--preserveWatchOutput"],
    {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );

  tscChild = child;
  let stdoutBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    stdoutBuffer += chunk;

    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleTscLine(line);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[dev] TypeScript watcher exited with ${reason}.`);
    shutdown(code ?? 1);
  });
}

const testFileWatcher = watch(packagesDir, { recursive: true }, (_eventType, filename) => {
  if (!filename) return;
  const normalized = String(filename).replaceAll("\\", "/");
  if (normalized.endsWith(".test.ts")) scheduleTests(150);
});

testFileWatcher.on("error", (error) => {
  console.error("[dev] Test-file watcher failed:", error);
});

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  clearTimeout(testDebounce);
  testFileWatcher.close();
  stopTests();
  restartPlaygroundWhenStopped = false;
  stopPlayground(false);
  tscChild?.kill("SIGTERM");

  setTimeout(() => process.exit(exitCode), 350).unref();
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

console.log("[dev] Tests run after each successful TypeScript compilation.");
console.log("[dev] The visual playground starts after a successful compilation.");
console.log("[dev] Test-file changes trigger a fresh one-shot test run.");
startTypeScriptWatcher();

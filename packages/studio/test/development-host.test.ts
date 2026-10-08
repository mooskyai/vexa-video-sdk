import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const hostPath = resolve(root, "examples/visual-playground/studio-dev-host.mjs");
const clientPath = resolve(root, "examples/visual-playground/public/studio-workspace.js");
const serverPath = resolve(root, "examples/visual-playground/server.mjs");
const acceptancePath = resolve(root, "scripts/verify-v2-studio.mjs");

test("Studio development host normalizes Windows paths and debounces source changes", () => {
  const windowsEntry = JSON.stringify("nested\\entry.tsx");
  const windowsScene = JSON.stringify("nested\\scene.ts");
  const probe = `
    import assert from "node:assert/strict";
    import { pathToFileURL } from "node:url";
    const host = await import(pathToFileURL(${JSON.stringify(hostPath)}).href);
    assert.equal(host.normalizeStudioChangePath(${windowsEntry}), "nested/entry.tsx");
    assert.equal(host.normalizeStudioChangePath("public/image.png"), "public/image.png");
    assert.equal(host.normalizeStudioChangePath("README.md"), null);
    assert.equal(host.normalizeStudioChangePath("../entry.tsx"), null);
    let callback = null;
    let errorHandler = null;
    let closed = false;
    const changes = [];
    const watcher = host.createStudioSourceWatcher({
      root: "C:/vexa/compositions",
      debounceMs: 5,
      onChange(change) { changes.push(change); },
      onError(error) { throw error; },
      watchImpl(_root, options, next) {
        assert.equal(options.recursive, true);
        callback = next;
        return {
          on(event, handler) {
            if (event === "error") errorHandler = handler;
            return this;
          },
          close() { closed = true; }
        };
      }
    });
    assert.equal(typeof callback, "function");
    assert.equal(typeof errorHandler, "function");
    callback("change", "entry.tsx");
    callback("rename", ${windowsScene});
    callback("change", "notes.md");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].paths, ["entry.tsx", "nested/scene.ts"]);
    assert.deepEqual(changes[0].eventTypes, ["change", "rename"]);
    watcher.close();
    assert.equal(closed, true);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Studio development host exposes SSE hot reload without moving Node work into the browser", async () => {
  const [client, server, host] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(serverPath, "utf8"),
    readFile(hostPath, "utf8")
  ]);

  assert.match(server, /\/api\/studio\/events/u);
  assert.match(server, /createStudioSourceWatcher/u);
  assert.match(server, /compositionSourceRoot/u);
  assert.match(host, /node:fs/u);
  assert.match(client, /new EventSource\("\/api\/studio\/events"\)/u);
  assert.match(client, /source-change/u);
  assert.match(client, /pendingHotReload/u);
  assert.match(client, /studioErrorOverlay/u);
  assert.doesNotMatch(client, /from\s+["']node:/u);
  assert.doesNotMatch(client, /@vexa-video\/(?:sdk|renderer|ffmpeg)/u);
});

test("Studio browser acceptance harness is syntactically valid", () => {
  const result = spawnSync(process.execPath, ["--check", acceptancePath], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

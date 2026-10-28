import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MediaWorkspace } from "../../src/storage.ts";

const run = promisify(execFile);
const [root, prefix] = process.argv.slice(2);
if (!root || !prefix || !process.send) {
  throw new Error("Workspace crash fixture requires an IPC parent, root and prefix.");
}

const workspace = await MediaWorkspace.create({ root, prefix });
const output = workspace.file("rendered.mp4");

// Exercise an actual FFmpeg-produced artifact, then leave the managed workspace
// open as a live render-worker process until the parent kills or cancels it.
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
  "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10",
  "-t", "0.5", "-c:v", "mpeg4", output
], { timeout: 10_000, windowsHide: true });

process.send({ kind: "ready", workspace: workspace.path, artifact: output });
process.on("message", async (message) => {
  if (message !== "cancel") return;
  try {
    await workspace.cleanup();
    process.send?.({ kind: "cancelled" });
    process.exitCode = 0;
    process.disconnect?.();
  } catch (error) {
    process.send?.({ kind: "cleanup-error", detail: String(error) });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
// No worker-heartbeat/filesystem mtime guarantee is inferred from this fixture.
const idle = setInterval(() => {}, 1_000);
idle.unref?.();

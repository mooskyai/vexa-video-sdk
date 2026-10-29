import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MediaWorkspace } from "../../src/storage.ts";
import { RedisWorkspaceQuiescence } from "../../src/workspace-quiescence.ts";
import { LiveRedisClient } from "../live-redis-client.ts";

const run = promisify(execFile);
const [root, prefix, namespace] = process.argv.slice(2);
if (!root || !prefix || !namespace || !process.send) {
  throw new Error("Instrumented workspace worker requires root, prefix, Redis namespace and IPC.");
}
const client = await LiveRedisClient.open();
const authority = new RedisWorkspaceQuiescence(client, { prefix: namespace });
const workspace = await MediaWorkspace.create({ root, prefix });
const token = await authority.acquire(workspace.path, 1_500);
const artifact = workspace.file("crash-artifact.mp4");
try {
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10",
    "-t", "0.5", "-c:v", "mpeg4", artifact
  ], { timeout: 10_000, windowsHide: true });
} catch (error) {
  await authority.release(workspace.path, token);
  client.close();
  throw error;
}
let failed = false;
const heartbeat = setInterval(async () => {
  try {
    if (!await authority.renew(workspace.path, token, 1_500)) throw new Error("Workspace lease lost.");
  } catch {
    failed = true;
    clearInterval(heartbeat);
    // This fixture has no long-running encoder after the initial file is produced.
    // A real worker must terminate active children and stop reads/writes here.
    process.exitCode = 2;
    process.disconnect?.();
  }
}, 250);
process.send({ kind: "ready", workspace: workspace.path, artifact });
process.on("message", async message => {
  if (message !== "cancel" || failed) return;
  clearInterval(heartbeat);
  try {
    await workspace.cleanup();
    await authority.release(workspace.path, token);
    process.exitCode = 0;
  } catch {
    process.exitCode = 1;
  } finally {
    client.close();
    process.disconnect?.();
  }
});

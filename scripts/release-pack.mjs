import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function npmInvocation(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return {
      command: process.execPath,
      args: [npmCli, ...args]
    };
  }

  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args]
    };
  }

  return {
    command: "npm",
    args
  };
}

function runNpm(args, failureMessage) {
  return new Promise((resolvePromise, reject) => {
    const invocation = npmInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${failureMessage} with code ${code}`));
      }
    });
  });
}

const workspaces = [
  ["@vexa-video/core", "packages/core"],
  ["@vexa-video/ffmpeg", "packages/ffmpeg"],
  ["@vexa-video/sdk", "packages/sdk"],
  ["@vexa-video/angular", "packages/angular"],
  ["@vexa-video/ai", "packages/ai"],
  ["@vexa-video/editor", "packages/editor"],
  ["@vexa-video/react", "packages/react"],
  ["@vexa-video/player", "packages/player"],
  ["@vexa-video/bundler", "packages/bundler"],
  ["@vexa-video/cli", "packages/cli"]
];

for (const [workspace, directory] of workspaces) {
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const rootExport = manifest.exports?.["."] ?? manifest.exports;
  const runtimePath = typeof rootExport === "string" ? rootExport : rootExport?.import;
  const typesPath = typeof rootExport === "object" ? rootExport?.types : undefined;
  if (!runtimePath || !typesPath) {
    throw new Error(`${workspace} must expose both import and types paths before packing.`);
  }
  await access(resolve(directory, runtimePath)).catch(() => {
    throw new Error(`${workspace} has not been built: ${directory}/${runtimePath} is missing.`);
  });
  await access(resolve(directory, typesPath)).catch(() => {
    throw new Error(`${workspace} has not emitted declarations: ${directory}/${typesPath} is missing.`);
  });
  console.log(`[release:pack] ${workspace}`);
  await runNpm(
    ["pack", "--dry-run", "--workspace", workspace],
    `npm pack failed for ${workspace}`
  );
}

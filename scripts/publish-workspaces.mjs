import { spawn } from "node:child_process";

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

if (process.env.VEXA_RELEASE_CONFIRM !== "PUBLISH") {
  throw new Error("Refusing to publish. Set VEXA_RELEASE_CONFIRM=PUBLISH from the protected release workflow/operator session.");
}

const workspaces = [
  "@vexa-video/core",
  "@vexa-video/ffmpeg",
  "@vexa-video/sdk",
  "@vexa-video/angular",
  "@vexa-video/ai",
  "@vexa-video/editor",
  "@vexa-video/react",
  "@vexa-video/player",
  "@vexa-video/bundler",
  "@vexa-video/cli"
];

for (const workspace of workspaces) {
  console.log(`[release:publish] ${workspace}`);
  await runNpm(
    ["publish", "--workspace", workspace, "--access", "public", "--provenance"],
    `npm publish failed for ${workspace}`
  );
}

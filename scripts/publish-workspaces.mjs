import { spawn } from "node:child_process";
import { releasePackages } from "./release-packages.mjs";

const canonicalRepository = "mooskyai/vexa-video-sdk";
const workflowFilename = "release.yml";
const environmentName = "npm-release";

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

function assertTrustedPublishingEnvironment() {
  const failures = [];
  if (process.env.GITHUB_ACTIONS !== "true") failures.push("publication must run inside GitHub Actions");
  if (process.env.GITHUB_REPOSITORY !== canonicalRepository) {
    failures.push(`GITHUB_REPOSITORY must be ${canonicalRepository}`);
  }
  const workflowPrefix = `${canonicalRepository}/.github/workflows/${workflowFilename}@`;
  if (!process.env.GITHUB_WORKFLOW_REF?.startsWith(workflowPrefix)) {
    failures.push(`GITHUB_WORKFLOW_REF must identify ${workflowFilename}`);
  }
  if (process.env.VEXA_RELEASE_ENVIRONMENT !== environmentName) {
    failures.push(`VEXA_RELEASE_ENVIRONMENT must be ${environmentName}`);
  }
  if (process.env.GITHUB_REF_TYPE !== "tag") failures.push("npm publication requires a tag ref");
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    failures.push("GitHub Actions OIDC request variables are unavailable");
  }
  if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
    failures.push("NPM_TOKEN and NODE_AUTH_TOKEN are forbidden for trusted publication");
  }
  if (failures.length) throw new Error(`Trusted publishing preflight failed: ${failures.join("; ")}.`);
}

if (process.env.VEXA_RELEASE_CONFIRM !== "PUBLISH") {
  throw new Error("Refusing to publish. VEXA_RELEASE_CONFIRM=PUBLISH is only accepted from the protected release workflow.");
}

assertTrustedPublishingEnvironment();

for (const { name: workspace } of releasePackages) {
  console.log(`[release:publish] ${workspace}`);
  await runNpm(
    ["publish", "--workspace", workspace, "--access", "public", "--provenance"],
    `npm publish failed for ${workspace}`
  );
}

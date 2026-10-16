import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const canonicalRepository = "mooskyai/vexa-video-sdk";
const canonicalRepositoryUrl = "https://github.com/mooskyai/vexa-video-sdk.git";
const workflowFilename = "release.yml";
const environmentName = "npm-release";
const minimumNpmVersion = [11, 15, 0];
const failures = [];

function npmVersion() {
  const npmCli = process.env.npm_execpath;
  const invocation = npmCli
    ? { command: process.execPath, args: [npmCli, "--version"] }
    : process.platform === "win32"
      ? { command: "npm.cmd", args: ["--version"] }
      : { command: "npm", args: ["--version"] };
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm --version failed with code ${result.status}.`);
  return result.stdout.trim();
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value);
  if (!match) throw new Error(`Unable to parse npm version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(actual, expected) {
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] > expected[index]) return true;
    if (actual[index] < expected[index]) return false;
  }
  return true;
}

function requireText(text, value, label) {
  if (!text.includes(value)) failures.push(`${label} is missing: ${value}`);
}

const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseWorkflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const publishScript = await readFile(new URL("./publish-workspaces.mjs", import.meta.url), "utf8");
const npmText = npmVersion();
const npmParts = parseVersion(npmText);

if (!versionAtLeast(npmParts, minimumNpmVersion)) {
  failures.push(`npm ${npmText} is below the release-operator minimum 11.15.0.`);
}
if (root.repository?.url !== canonicalRepositoryUrl) {
  failures.push(`root repository.url must be ${canonicalRepositoryUrl}`);
}

requireText(releaseWorkflow, "id-token: write", "release workflow OIDC permission");
requireText(releaseWorkflow, `environment: ${environmentName}`, "release workflow environment");
requireText(releaseWorkflow, `VEXA_RELEASE_ENVIRONMENT: ${environmentName}`, "release environment marker");
requireText(releaseWorkflow, "registry-url: https://registry.npmjs.org", "release npm registry");
requireText(releaseWorkflow, "VEXA_TRUSTED_PUBLISH_RUNTIME: \"1\"", "live trusted-publishing preflight");
requireText(releaseWorkflow, "npm run release:trusted-publish-check", "trusted-publishing preflight command");
requireText(releaseWorkflow, "runs-on: ubuntu-latest", "GitHub-hosted publish runner");

if (/^\s*(?:NPM_TOKEN|NODE_AUTH_TOKEN)\s*:/mu.test(releaseWorkflow)) {
  failures.push("release workflow must not configure NPM_TOKEN or NODE_AUTH_TOKEN for publication.");
}

requireText(publishScript, "ACTIONS_ID_TOKEN_REQUEST_URL", "publish OIDC validation");
requireText(publishScript, "GITHUB_WORKFLOW_REF", "publish workflow identity validation");
requireText(publishScript, "--provenance", "npm provenance publication");

const runtimeMode = process.env.VEXA_TRUSTED_PUBLISH_RUNTIME === "1";
if (runtimeMode) {
  if (process.env.GITHUB_ACTIONS !== "true") failures.push("runtime trusted-publishing validation must run inside GitHub Actions.");
  if (process.env.GITHUB_REPOSITORY !== canonicalRepository) {
    failures.push(`GITHUB_REPOSITORY must be ${canonicalRepository}.`);
  }
  const workflowPrefix = `${canonicalRepository}/.github/workflows/${workflowFilename}@`;
  if (!process.env.GITHUB_WORKFLOW_REF?.startsWith(workflowPrefix)) {
    failures.push(`GITHUB_WORKFLOW_REF must identify ${workflowFilename} in ${canonicalRepository}.`);
  }
  if (process.env.VEXA_RELEASE_ENVIRONMENT !== environmentName) {
    failures.push(`VEXA_RELEASE_ENVIRONMENT must be ${environmentName}.`);
  }
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    failures.push("GitHub Actions OIDC request variables are unavailable; id-token: write is required.");
  }
  if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
    failures.push("trusted publication must not use NPM_TOKEN or NODE_AUTH_TOKEN.");
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[release:trusted] ERROR ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[release:trusted] npm ${npmText}`);
  console.log(`[release:trusted] ${canonicalRepository} / ${workflowFilename} / ${environmentName}`);
  console.log(runtimeMode
    ? "[release:trusted] live GitHub OIDC publishing environment passed."
    : "[release:trusted] static trusted-publishing contract passed.");
}

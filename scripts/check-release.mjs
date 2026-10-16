import { readFile } from "node:fs/promises";
import { releasePackages } from "./release-packages.mjs";

const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const failures = [];

for (const { name: expectedName, directory } of releasePackages) {
  const manifest = JSON.parse(await readFile(new URL(`../${directory}/package.json`, import.meta.url), "utf8"));
  if (manifest.name !== expectedName) failures.push(`${directory}: package name ${manifest.name} must match release registry ${expectedName}`);
  if (manifest.private === true) failures.push(`${manifest.name}: private must be false for a release package`);
  if (manifest.version !== root.version) failures.push(`${manifest.name}: version ${manifest.version} must match root ${root.version}`);
  if (!manifest.exports) failures.push(`${manifest.name}: exports is required`);
  if (!Array.isArray(manifest.files) || !manifest.files.some((entry) => String(entry).startsWith("dist/"))) {
    failures.push(`${manifest.name}: files must explicitly include distributable dist patterns`);
  }
  if (manifest.files?.some((entry) => entry === "dist")) {
    failures.push(`${manifest.name}: files must not publish the entire dist directory because .tsbuildinfo is internal`);
  }
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      if (dependency.startsWith("@vexa-video/") && version !== root.version) {
        failures.push(`${manifest.name}: ${field}.${dependency} ${version} must match root ${root.version}`);
      }
    }
  }
  if (manifest.license !== "MIT") failures.push(`${manifest.name}: license must be MIT`);
  if (manifest.repository?.url !== "https://github.com/mooskyai/vexa-video-sdk.git") failures.push(`${manifest.name}: canonical repository metadata is missing`);
  if (manifest.publishConfig?.access !== "public") failures.push(`${manifest.name}: publishConfig.access must be public`);
  console.log(`[release:check] ${manifest.name}@${manifest.version}`);
}

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
if (/\bmilestone\b/iu.test(readme)) failures.push("README.md must remain product-focused and must not use the word Milestone");
if (!readme.includes("https://github.com/mooskyai/vexa-video-sdk")) failures.push("README.md must reference the canonical mooskyai repository");

if (failures.length) {
  for (const failure of failures) console.error(`[release:check] ERROR ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[release:check] ${releasePackages.length} packages are release-ready.`);
}

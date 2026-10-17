import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releasePackages } from "./release-packages.mjs";

const targetVersion = process.argv[2];
if (!targetVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(targetVersion)) {
  console.error("Usage: npm run release:version -- <semver>");
  process.exit(1);
}

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDir, "..");
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const publicPackageNames = new Set(releasePackages.map((entry) => entry.name));
const changed = [];

async function readManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeManifest(path, manifest) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  changed.push(path.slice(repositoryRoot.length + 1).replaceAll("\\", "/"));
}

function assertInternalVersions(manifest, expectedVersion, label) {
  for (const field of dependencyFields) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (publicPackageNames.has(name) && specifier !== expectedVersion) {
        throw new Error(`${label} ${field}.${name} must be exactly ${expectedVersion} before the release cut; found ${specifier}.`);
      }
    }
  }
}

function setInternalVersions(manifest) {
  for (const field of dependencyFields) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (publicPackageNames.has(name)) manifest[field][name] = targetVersion;
    }
  }
}

const rootPath = join(repositoryRoot, "package.json");
const root = await readManifest(rootPath);
const sourceVersion = root.version;
if (!sourceVersion || typeof sourceVersion !== "string") {
  throw new Error("Root package.json must contain a string version.");
}

for (const entry of releasePackages) {
  const manifestPath = join(repositoryRoot, entry.directory, "package.json");
  const manifest = await readManifest(manifestPath);
  if (manifest.name !== entry.name) {
    throw new Error(`${entry.directory}/package.json must be ${entry.name}; found ${manifest.name}.`);
  }
  if (manifest.version !== sourceVersion) {
    throw new Error(`${entry.name} must match root version ${sourceVersion} before the release cut; found ${manifest.version}.`);
  }
  assertInternalVersions(manifest, sourceVersion, entry.name);
}

const examplesRoot = join(repositoryRoot, "examples");
const exampleDirectories = await readdir(examplesRoot, { withFileTypes: true });
for (const directory of exampleDirectories) {
  if (!directory.isDirectory()) continue;
  const manifestPath = join(examplesRoot, directory.name, "package.json");
  let manifest;
  try {
    manifest = await readManifest(manifestPath);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  assertInternalVersions(manifest, sourceVersion, manifest.name ?? `examples/${directory.name}`);
}

root.version = targetVersion;
await writeManifest(rootPath, root);

for (const entry of releasePackages) {
  const manifestPath = join(repositoryRoot, entry.directory, "package.json");
  const manifest = await readManifest(manifestPath);
  manifest.version = targetVersion;
  setInternalVersions(manifest);
  await writeManifest(manifestPath, manifest);
}

for (const directory of exampleDirectories) {
  if (!directory.isDirectory()) continue;
  const manifestPath = join(examplesRoot, directory.name, "package.json");
  let manifest;
  try {
    manifest = await readManifest(manifestPath);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  const before = JSON.stringify(manifest);
  setInternalVersions(manifest);
  if (JSON.stringify(manifest) !== before) await writeManifest(manifestPath, manifest);
}

console.log(`[release:version] ${sourceVersion} -> ${targetVersion}`);
for (const path of changed) console.log(`[release:version] updated ${path}`);
console.log("[release:version] regenerate package-lock.json with npm install --package-lock-only --ignore-scripts --no-audit --no-fund");

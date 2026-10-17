import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  build,
  type BuildOptions,
  type Message,
  type Plugin
} from "esbuild";
import {
  VEXA_BUNDLE_DISCOVERY_EXPORT,
  defineBundleCompositions,
  type VexaBundledCompositionDescriptor
} from "./entry.js";
import { renameDirectoryWithRetry } from "./fs-retry.js";

export { VEXA_BUNDLE_DISCOVERY_EXPORT, defineBundleCompositions } from "./entry.js";
export type {
  VexaBundledCompositionDescriptor,
  VexaBundledCompositionKind
} from "./entry.js";

export const VEXA_BUNDLE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const VEXA_BUNDLE_MANIFEST_FILE = "vexa.bundle.json" as const;

export type VexaBundleMode = "development" | "production";
export type VexaBundleSourceMapMode = "none" | "external" | "inline";

export type VexaBundlerErrorCode =
  | "INVALID_BUNDLE_OPTIONS"
  | "BUNDLE_ENTRY_NOT_FOUND"
  | "BUNDLE_PATH_OUTSIDE_ROOT"
  | "BUNDLE_BUILD_FAILED"
  | "BUNDLE_DISCOVERY_FAILED"
  | "BUNDLE_DISCOVERY_EXPORT_INVALID"
  | "PUBLIC_ASSET_COLLISION";

export interface VexaBundlerDiagnostic {
  readonly text: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

export class VexaBundlerError extends Error {
  readonly code: VexaBundlerErrorCode;
  readonly diagnostics: readonly VexaBundlerDiagnostic[];

  constructor(
    message: string,
    code: VexaBundlerErrorCode,
    diagnostics: readonly VexaBundlerDiagnostic[] = []
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

export interface VexaBundleOptions {
  readonly entry: string;
  readonly outDir: string;
  readonly rootDir?: string;
  readonly publicDir?: string;
  readonly mode?: VexaBundleMode;
  readonly sourceMap?: VexaBundleSourceMapMode;
  readonly environmentAllowlist?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface VexaBundleManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface VexaBundleManifest {
  readonly schemaVersion: typeof VEXA_BUNDLE_MANIFEST_SCHEMA_VERSION;
  readonly mode: VexaBundleMode;
  readonly entry: string;
  readonly browserEntry: string;
  readonly cssEntry?: string;
  readonly sourceMap?: string;
  readonly environment: readonly string[];
  readonly compositions: readonly VexaBundledCompositionDescriptor[];
  readonly files: readonly VexaBundleManifestFile[];
}

export interface VexaBundleResult {
  readonly outDir: string;
  readonly manifestPath: string;
  readonly manifest: VexaBundleManifest;
}

interface NormalizedBundleOptions {
  readonly entry: string;
  readonly outDir: string;
  readonly rootDir: string;
  readonly publicDir?: string;
  readonly mode: VexaBundleMode;
  readonly sourceMap: VexaBundleSourceMapMode;
  readonly environment: Readonly<Record<string, string>>;
  readonly environmentKeys: readonly string[];
}

const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const fileLoaders: NonNullable<BuildOptions["loader"]> = {
  ".png": "file",
  ".jpg": "file",
  ".jpeg": "file",
  ".gif": "file",
  ".webp": "file",
  ".avif": "file",
  ".svg": "file",
  ".woff": "file",
  ".woff2": "file",
  ".ttf": "file",
  ".otf": "file",
  ".mp3": "file",
  ".m4a": "file",
  ".wav": "file",
  ".mp4": "file",
  ".webm": "file"
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function looksLikeWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
}

export function normalizePortablePath(value: string): string {
  const replaced = value.replaceAll("\\", "/");
  if (/^[a-z]:\//u.test(replaced)) {
    return `${replaced[0]?.toUpperCase() ?? ""}${replaced.slice(1)}`;
  }
  return replaced;
}

export function portableRelativePath(root: string, target: string): string {
  const windows = looksLikeWindowsAbsolutePath(root) || looksLikeWindowsAbsolutePath(target);
  const output = windows ? win32.relative(root, target) : relative(root, target);
  return normalizePortablePath(output || ".");
}

function assertInsideRoot(root: string, target: string, label: string): void {
  const rel = portableRelativePath(root, target);
  if (rel === ".") return;
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new VexaBundlerError(
      `${label} must stay inside rootDir. Received ${normalizePortablePath(target)}.`,
      "BUNDLE_PATH_OUTSIDE_ROOT"
    );
  }
}

function normalizeEnvironment(
  allowlist: readonly string[] | undefined,
  source: Readonly<Record<string, string | undefined>>
): { readonly values: Readonly<Record<string, string>>; readonly keys: readonly string[] } {
  const names = [...new Set(allowlist ?? [])].sort(compareText);
  const values: Record<string, string> = {};
  for (const name of names) {
    if (!environmentNamePattern.test(name)) {
      throw new VexaBundlerError(
        `Environment allowlist entry "${name}" is not a valid environment-variable name.`,
        "INVALID_BUNDLE_OPTIONS"
      );
    }
    const value = source[name];
    if (value !== undefined) values[name] = value;
  }
  return Object.freeze({ values: Object.freeze(values), keys: Object.freeze(names) });
}

async function normalizeOptions(options: VexaBundleOptions): Promise<NormalizedBundleOptions> {
  if (!options || typeof options !== "object") {
    throw new VexaBundlerError("Bundle options are required.", "INVALID_BUNDLE_OPTIONS");
  }
  if (typeof options.entry !== "string" || options.entry.trim() === "") {
    throw new VexaBundlerError("entry must be a non-empty path.", "INVALID_BUNDLE_OPTIONS");
  }
  if (typeof options.outDir !== "string" || options.outDir.trim() === "") {
    throw new VexaBundlerError("outDir must be a non-empty path.", "INVALID_BUNDLE_OPTIONS");
  }

  const rootDir = resolve(options.rootDir ?? process.cwd());
  const entry = resolve(rootDir, options.entry);
  const outDir = resolve(rootDir, options.outDir);
  const publicDir = options.publicDir ? resolve(rootDir, options.publicDir) : undefined;
  assertInsideRoot(rootDir, entry, "entry");
  if (publicDir) assertInsideRoot(rootDir, publicDir, "publicDir");

  await access(entry).catch(() => {
    throw new VexaBundlerError(
      `Composition entry was not found: ${normalizePortablePath(entry)}.`,
      "BUNDLE_ENTRY_NOT_FOUND"
    );
  });
  if (publicDir) {
    await access(publicDir).catch(() => {
      throw new VexaBundlerError(
        `publicDir was not found: ${normalizePortablePath(publicDir)}.`,
        "INVALID_BUNDLE_OPTIONS"
      );
    });
  }

  const mode = options.mode ?? "development";
  if (mode !== "development" && mode !== "production") {
    throw new VexaBundlerError(`Unsupported bundle mode: ${String(mode)}.`, "INVALID_BUNDLE_OPTIONS");
  }
  const sourceMap = options.sourceMap ?? "external";
  if (sourceMap !== "none" && sourceMap !== "external" && sourceMap !== "inline") {
    throw new VexaBundlerError(
      `Unsupported sourceMap mode: ${String(sourceMap)}.`,
      "INVALID_BUNDLE_OPTIONS"
    );
  }

  const environment = normalizeEnvironment(
    options.environmentAllowlist,
    options.environment ?? process.env
  );
  return Object.freeze({
    entry,
    outDir,
    rootDir,
    ...(publicDir ? { publicDir } : {}),
    mode,
    sourceMap,
    environment: environment.values,
    environmentKeys: environment.keys
  });
}

function environmentDefines(environment: Readonly<Record<string, string>>): Record<string, string> {
  const json = JSON.stringify(environment);
  return {
    "process.env": json,
    "import.meta.env": json
  };
}

function sourceMapSetting(mode: VexaBundleSourceMapMode): false | "external" | "inline" {
  if (mode === "none") return false;
  return mode;
}

function diagnosticsFromMessages(
  rootDir: string,
  messages: readonly Message[] | undefined
): readonly VexaBundlerDiagnostic[] {
  return Object.freeze(
    (messages ?? []).map((message) => {
      const location = message.location;
      if (!location) return Object.freeze({ text: message.text });
      const absoluteFile = isAbsolute(location.file) ? location.file : resolve(rootDir, location.file);
      return Object.freeze({
        text: message.text,
        file: portableRelativePath(rootDir, absoluteFile),
        line: location.line,
        column: location.column
      });
    })
  );
}

function wrapEsbuildFailure(
  error: unknown,
  rootDir: string,
  code: "BUNDLE_BUILD_FAILED" | "BUNDLE_DISCOVERY_FAILED"
): VexaBundlerError {
  if (error && typeof error === "object" && "errors" in error) {
    const errors = (error as { errors?: readonly Message[] }).errors;
    const diagnostics = diagnosticsFromMessages(rootDir, errors);
    const first = diagnostics[0];
    return new VexaBundlerError(
      first ? `Composition build failed: ${first.text}` : "Composition build failed.",
      code,
      diagnostics
    );
  }
  return new VexaBundlerError(
    error instanceof Error ? error.message : "Composition build failed.",
    code
  );
}

const bundlerEntryModulePath = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./entry.ts" : "./entry.js", import.meta.url)
);

function bundlerEntryAliasPlugin(): Plugin {
  return {
    name: "vexa-bundler-entry-alias",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^@vexa-video\/bundler\/entry$/ }, () => ({
        path: bundlerEntryModulePath
      }));
    }
  };
}

function discoveryGuardPlugin(): Plugin {
  return {
    name: "vexa-discovery-css-assets",
    setup(esbuild) {
      esbuild.onLoad({ filter: /\.(css|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|mp3|m4a|wav|mp4|webm)$/ }, (args) => ({
        contents: `export default ${JSON.stringify(normalizePortablePath(args.path))};`,
        loader: "js"
      }));
    }
  };
}

export async function discoverBundleCompositions(
  options: Pick<VexaBundleOptions, "entry" | "rootDir" | "environmentAllowlist" | "environment">
): Promise<readonly VexaBundledCompositionDescriptor[]> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const entry = resolve(rootDir, options.entry);
  assertInsideRoot(rootDir, entry, "entry");
  await access(entry).catch(() => {
    throw new VexaBundlerError(
      `Composition entry was not found: ${normalizePortablePath(entry)}.`,
      "BUNDLE_ENTRY_NOT_FOUND"
    );
  });
  const environment = normalizeEnvironment(
    options.environmentAllowlist,
    options.environment ?? process.env
  );
  const tempDir = await mkdtemp(join(dirname(entry), ".vexa-discovery-"));
  const outputPath = join(tempDir, "entry.mjs");

  try {
    let result;
    try {
      result = await build({
        absWorkingDir: rootDir,
        entryPoints: [entry],
        outfile: outputPath,
        bundle: true,
        write: true,
        platform: "node",
        format: "esm",
        target: "node24",
        packages: "external",
        sourcemap: false,
        logLevel: "silent",
        define: environmentDefines(environment.values),
        plugins: [bundlerEntryAliasPlugin(), discoveryGuardPlugin()]
      });
    } catch (error) {
      throw wrapEsbuildFailure(error, rootDir, "BUNDLE_DISCOVERY_FAILED");
    }
    void result;

    let moduleNamespace: Record<string, unknown>;
    try {
      moduleNamespace = (await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`)) as Record<
        string,
        unknown
      >;
    } catch (error) {
      throw new VexaBundlerError(
        `Composition discovery module failed to evaluate: ${error instanceof Error ? error.message : String(error)}.`,
        "BUNDLE_DISCOVERY_FAILED"
      );
    }

    const discovered = moduleNamespace[VEXA_BUNDLE_DISCOVERY_EXPORT];
    if (!Array.isArray(discovered)) {
      throw new VexaBundlerError(
        `Composition entry must export a ${VEXA_BUNDLE_DISCOVERY_EXPORT} array.`,
        "BUNDLE_DISCOVERY_EXPORT_INVALID"
      );
    }
    try {
      return defineBundleCompositions(discovered as readonly VexaBundledCompositionDescriptor[]);
    } catch (error) {
      throw new VexaBundlerError(
        error instanceof Error ? error.message : "Composition discovery export is invalid.",
        "BUNDLE_DISCOVERY_EXPORT_INVALID"
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

async function copyPublicDirectory(sourceRoot: string, targetRoot: string, current = ""): Promise<void> {
  const sourceDir = join(sourceRoot, current);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    const sourcePath = join(sourceRoot, relativePath);
    const targetPath = join(targetRoot, relativePath);
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyPublicDirectory(sourceRoot, targetRoot, relativePath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (await pathExists(targetPath)) {
      throw new VexaBundlerError(
        `Public asset collides with generated bundle output: ${normalizePortablePath(relativePath)}.`,
        "PUBLIC_ASSET_COLLISION"
      );
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function collectFiles(root: string, current = ""): Promise<readonly VexaBundleManifestFile[]> {
  const directory = join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  const files: VexaBundleManifestFile[] = [];
  for (const entry of entries) {
    const relativePath = current ? join(current, entry.name) : entry.name;
    if (normalizePortablePath(relativePath) === VEXA_BUNDLE_MANIFEST_FILE) continue;
    const absolutePath = join(root, relativePath);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, relativePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const contents = await readFile(absolutePath);
    files.push(
      Object.freeze({
        path: normalizePortablePath(relativePath),
        bytes: contents.byteLength,
        sha256: createHash("sha256").update(contents).digest("hex")
      })
    );
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return Object.freeze(files);
}

function stableManifestJson(manifest: VexaBundleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function bundleCompositions(options: VexaBundleOptions): Promise<VexaBundleResult> {
  const normalized = await normalizeOptions(options);
  const compositions = await discoverBundleCompositions({
    entry: normalized.entry,
    rootDir: normalized.rootDir,
    environmentAllowlist: normalized.environmentKeys,
    environment: normalized.environment
  });

  const parent = dirname(normalized.outDir);
  await mkdir(parent, { recursive: true });
  const stageDir = await mkdtemp(join(parent, `.${basename(normalized.outDir)}-vexa-`));

  try {
    try {
      await build({
        absWorkingDir: normalized.rootDir,
        entryPoints: [normalized.entry],
        outdir: stageDir,
        entryNames: "index",
        chunkNames: "chunks/[name]-[hash]",
        assetNames: "assets/[name]-[hash]",
        bundle: true,
        splitting: true,
        platform: "browser",
        format: "esm",
        target: ["es2022"],
        jsx: "automatic",
        sourcemap: sourceMapSetting(normalized.sourceMap),
        sourceRoot: "vexa:///",
        minify: normalized.mode === "production",
        treeShaking: true,
        metafile: true,
        logLevel: "silent",
        loader: fileLoaders,
        define: environmentDefines(normalized.environment),
        plugins: [bundlerEntryAliasPlugin()]
      });
    } catch (error) {
      throw wrapEsbuildFailure(error, normalized.rootDir, "BUNDLE_BUILD_FAILED");
    }

    if (normalized.publicDir) {
      await copyPublicDirectory(normalized.publicDir, stageDir);
    }

    const browserEntry = "index.js";
    if (!(await pathExists(join(stageDir, browserEntry)))) {
      throw new VexaBundlerError(
        "Browser bundle did not emit index.js.",
        "BUNDLE_BUILD_FAILED"
      );
    }
    const cssEntry = (await pathExists(join(stageDir, "index.css"))) ? "index.css" : undefined;
    const sourceMap =
      normalized.sourceMap === "external" && (await pathExists(join(stageDir, "index.js.map")))
        ? "index.js.map"
        : undefined;
    const files = await collectFiles(stageDir);
    const manifest: VexaBundleManifest = Object.freeze({
      schemaVersion: VEXA_BUNDLE_MANIFEST_SCHEMA_VERSION,
      mode: normalized.mode,
      entry: portableRelativePath(normalized.rootDir, normalized.entry),
      browserEntry,
      ...(cssEntry ? { cssEntry } : {}),
      ...(sourceMap ? { sourceMap } : {}),
      environment: normalized.environmentKeys,
      compositions,
      files
    });
    await writeFile(join(stageDir, VEXA_BUNDLE_MANIFEST_FILE), stableManifestJson(manifest), "utf8");

    await rm(normalized.outDir, { recursive: true, force: true });
    await renameDirectoryWithRetry(stageDir, normalized.outDir);

    return Object.freeze({
      outDir: normalized.outDir,
      manifestPath: join(normalized.outDir, VEXA_BUNDLE_MANIFEST_FILE),
      manifest
    });
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

export async function readBundleManifest(path: string): Promise<VexaBundleManifest> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<VexaBundleManifest>;
  if (raw.schemaVersion !== VEXA_BUNDLE_MANIFEST_SCHEMA_VERSION) {
    throw new VexaBundlerError(
      `Unsupported Vexa bundle manifest schemaVersion: ${String(raw.schemaVersion)}.`,
      "INVALID_BUNDLE_OPTIONS"
    );
  }
  return raw as VexaBundleManifest;
}

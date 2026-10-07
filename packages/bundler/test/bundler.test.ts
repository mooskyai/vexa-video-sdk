import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  VEXA_BUNDLE_MANIFEST_FILE,
  VexaBundlerError,
  bundleCompositions,
  discoverBundleCompositions,
  normalizePortablePath,
  portableRelativePath,
  readBundleManifest
} from "../src/index.js";
import { defineBundleCompositions } from "../src/entry.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtures = join(testDirectory, "fixtures");

async function tempRoot(label: string): Promise<string> {
  return mkdtemp(join(testDirectory, `.tmp-${label}-`));
}

test("bundle entry descriptors normalize and sort deterministically", () => {
  const result = defineBundleCompositions([
    { id: "zeta", kind: "still", width: 640, height: 360 },
    { id: "alpha", kind: "video", width: 1280, height: 720, fps: 30, durationInFrames: 90 }
  ]);
  assert.deepEqual(result.map((entry) => entry.id), ["alpha", "zeta"]);
  assert.throws(
    () => defineBundleCompositions([
      { id: "dup", kind: "still", width: 10, height: 10 },
      { id: "dup", kind: "still", width: 10, height: 10 }
    ]),
    /duplicated/u
  );
});

test("TypeScript bundle emits deterministic discovery metadata and manifest", async () => {
  const root = join(fixtures, "basic");
  const outDir = await tempRoot("ts");
  await rm(outDir, { recursive: true, force: true });
  try {
    const result = await bundleCompositions({
      rootDir: root,
      entry: "entry.ts",
      outDir,
      publicDir: "public",
      environmentAllowlist: ["VEXA_PUBLIC_API_URL"],
      environment: { VEXA_PUBLIC_API_URL: "https://api.example.test", VEXA_PRIVATE_SECRET: "never-bundle-me" }
    });
    assert.equal(result.manifest.schemaVersion, 1);
    assert.deepEqual(result.manifest.compositions.map((entry) => entry.id), ["a-intro", "z-outro"]);
    assert.equal(result.manifest.entry, "entry.ts");
    assert.equal(result.manifest.browserEntry, "index.js");
    assert.equal(result.manifest.sourceMap, "index.js.map");
    assert.ok(result.manifest.files.some((file) => file.path === "robots.txt"));
    const persisted = await readBundleManifest(join(outDir, VEXA_BUNDLE_MANIFEST_FILE));
    assert.deepEqual(persisted, result.manifest);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("TSX entry bundles in browser mode", async () => {
  const root = join(fixtures, "tsx");
  const outDir = await tempRoot("tsx");
  await rm(outDir, { recursive: true, force: true });
  try {
    const result = await bundleCompositions({ rootDir: root, entry: "entry.tsx", outDir });
    assert.deepEqual(result.manifest.compositions.map((entry) => entry.id), ["tsx-card"]);
    const browser = await readFile(join(outDir, "index.js"), "utf8");
    assert.match(browser, /Vexa TSX/u);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("CSS and local assets are emitted and fingerprinted", async () => {
  const root = join(fixtures, "basic");
  const outDir = await tempRoot("assets");
  await rm(outDir, { recursive: true, force: true });
  try {
    const result = await bundleCompositions({ rootDir: root, entry: "entry.ts", outDir });
    assert.equal(result.manifest.cssEntry, "index.css");
    assert.ok(result.manifest.files.some((file) => /^assets\/logo-[A-Z0-9]+\.svg$/u.test(file.path)));
    assert.ok(result.manifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("dynamic imports emit deterministic chunks", async () => {
  const root = join(fixtures, "basic");
  const outDir = await tempRoot("chunks");
  await rm(outDir, { recursive: true, force: true });
  try {
    const result = await bundleCompositions({ rootDir: root, entry: "entry.ts", outDir, mode: "production" });
    assert.ok(result.manifest.files.some((file) => /^chunks\/lazy-[A-Z0-9]+\.js$/u.test(file.path)));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("source map modes are explicit", async () => {
  const root = join(fixtures, "basic");
  const externalDir = await tempRoot("map-external");
  const inlineDir = await tempRoot("map-inline");
  await Promise.all([
    rm(externalDir, { recursive: true, force: true }),
    rm(inlineDir, { recursive: true, force: true })
  ]);
  try {
    const external = await bundleCompositions({ rootDir: root, entry: "entry.ts", outDir: externalDir, sourceMap: "external" });
    assert.equal(external.manifest.sourceMap, "index.js.map");
    const inline = await bundleCompositions({ rootDir: root, entry: "entry.ts", outDir: inlineDir, sourceMap: "inline" });
    assert.equal(inline.manifest.sourceMap, undefined);
    assert.match(await readFile(join(inlineDir, "index.js"), "utf8"), /sourceMappingURL=data:application\/json/u);
  } finally {
    await Promise.all([
      rm(externalDir, { recursive: true, force: true }),
      rm(inlineDir, { recursive: true, force: true })
    ]);
  }
});

test("environment allowlist exposes only explicitly permitted values", async () => {
  const root = join(fixtures, "env");
  const outDir = await tempRoot("env");
  await rm(outDir, { recursive: true, force: true });
  try {
    const result = await bundleCompositions({
      rootDir: root,
      entry: "entry.ts",
      outDir,
      environmentAllowlist: ["VEXA_ALLOWED"],
      environment: { VEXA_ALLOWED: "public-value", VEXA_BLOCKED: "super-secret-value" }
    });
    assert.deepEqual(result.manifest.environment, ["VEXA_ALLOWED"]);
    const browser = await readFile(join(outDir, "index.js"), "utf8");
    assert.match(browser, /public-value/u);
    assert.doesNotMatch(browser, /super-secret-value/u);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("production manifests are stable for unchanged input", async () => {
  const root = join(fixtures, "basic");
  const firstDir = await tempRoot("det-a");
  const secondDir = await tempRoot("det-b");
  await Promise.all([
    rm(firstDir, { recursive: true, force: true }),
    rm(secondDir, { recursive: true, force: true })
  ]);
  try {
    const options = {
      rootDir: root,
      entry: "entry.ts",
      publicDir: "public",
      mode: "production" as const,
      environmentAllowlist: ["VEXA_PUBLIC_API_URL"],
      environment: { VEXA_PUBLIC_API_URL: "https://api.example.test" }
    };
    const first = await bundleCompositions({ ...options, outDir: firstDir });
    const second = await bundleCompositions({ ...options, outDir: secondDir });
    assert.deepEqual(first.manifest, second.manifest);
  } finally {
    await Promise.all([
      rm(firstDir, { recursive: true, force: true }),
      rm(secondDir, { recursive: true, force: true })
    ]);
  }
});

test("standalone composition discovery is sorted and repeatable", async () => {
  const root = join(fixtures, "basic");
  const first = await discoverBundleCompositions({ entry: "entry.ts", rootDir: root });
  const second = await discoverBundleCompositions({ entry: "entry.ts", rootDir: root });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.id), ["a-intro", "z-outro"]);
});


test("public assets cannot overwrite generated bundle outputs", async () => {
  const root = await tempRoot("collision-root");
  const outDir = join(root, "dist");
  try {
    await mkdir(join(root, "public"), { recursive: true });
    await writeFile(
      join(root, "entry.ts"),
      'export const vexaCompositions = [{ id: "collision", kind: "still", width: 10, height: 10 }];\n',
      "utf8"
    );
    await writeFile(join(root, "public", "index.js"), "public collision\n", "utf8");
    await assert.rejects(
      bundleCompositions({ rootDir: root, entry: "entry.ts", outDir, publicDir: "public" }),
      (error: unknown) => {
        assert.ok(error instanceof VexaBundlerError);
        assert.equal(error.code, "PUBLIC_ASSET_COLLISION");
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-safe entry helper has no Node execution imports", async () => {
  const source = await readFile(join(testDirectory, "../src/entry.ts"), "utf8");
  assert.doesNotMatch(source, /node:|child_process|@vexa-video\/sdk|@vexa-video\/ffmpeg|redis|from ["'](?:fs|path|os)["']/iu);
});

test("malformed source returns typed sanitized build diagnostics", async () => {
  const root = join(fixtures, "malformed");
  const outDir = await tempRoot("malformed");
  await rm(outDir, { recursive: true, force: true });
  try {
    await assert.rejects(
      bundleCompositions({ rootDir: root, entry: "entry.ts", outDir }),
      (error: unknown) => {
        assert.ok(error instanceof VexaBundlerError);
        assert.ok(error.code === "BUNDLE_DISCOVERY_FAILED" || error.code === "BUNDLE_BUILD_FAILED");
        assert.ok(error.diagnostics.length > 0);
        assert.equal(error.diagnostics[0]?.file, "entry.ts");
        assert.doesNotMatch(error.message, /\\Users\\|\/home\//u);
        return true;
      }
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("portable path normalization handles Windows drives, backslashes, and spaces", () => {
  assert.equal(
    normalizePortablePath("c:\\working\\Projects\\Video App\\src\\entry.tsx"),
    "C:/working/Projects/Video App/src/entry.tsx"
  );
  assert.equal(
    portableRelativePath(
      "C:\\working\\Projects\\Video App",
      "C:\\working\\Projects\\Video App\\src\\nested\\entry.tsx"
    ),
    "src/nested/entry.tsx"
  );
});

test("portable path normalization remains stable for long nested paths", () => {
  const nested = Array.from({ length: 24 }, (_, index) => `segment-${String(index).padStart(2, "0")}`).join("\\");
  const target = `D:\\Vexa Workspace\\${nested}\\entry.ts`;
  const relative = portableRelativePath("D:\\Vexa Workspace", target);
  assert.ok(relative.endsWith("/entry.ts"));
  assert.doesNotMatch(relative, /\\/u);
  assert.ok(relative.length > 200);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseCliArgs, runCli } from "../src/cli.js";

test("CLI parser handles command options and boolean negation", () => {
  const value = parseCliArgs([
    "render",
    "input.mp4",
    "output.mp4",
    "--width", "1280",
    "--height", "720",
    "--hardware", "nvidia",
    "--no-hardware-fallback"
  ]);
  assert.equal(value.command, "render");
  assert.deepEqual(value.positionals, ["input.mp4", "output.mp4"]);
  assert.equal(value.options.width, "1280");
  assert.equal(value.options.hardware, "nvidia");
  assert.equal(value.options["hardware-fallback"], false);
});

test("CLI help runs without media dependencies", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(["--help"], {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value)
  });
  assert.equal(code, 0);
  assert.match(stdout.join("\n"), /Vexa Video CLI/u);
  assert.deepEqual(stderr, []);
});


test("CLI discovers programmable compositions with JSON output", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-cli-compositions-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "video.tsx"),
      `export const vexaCompositions = [
  { id: "Poster", kind: "still", width: 1080, height: 1080 },
  { id: "ProductDemo", kind: "video", width: 1920, height: 1080, fps: 30, durationInFrames: 60 }
];\n`
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(["compositions", "--root-dir", root, "--json"], {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    });

    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout[0]!), [
      { id: "Poster", kind: "still", width: 1080, height: 1080 },
      {
        id: "ProductDemo",
        kind: "video",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 60
      }
    ]);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI bundles a programmable composition entry with machine-readable output", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-cli-bundle-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "video.tsx"),
      `export const vexaCompositions = [
  { id: "ProductDemo", kind: "video", width: 1280, height: 720, fps: 30, durationInFrames: 30 }
];\n`
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      [
        "bundle",
        "src/video.tsx",
        "--root-dir",
        root,
        "--out-dir",
        "dist/compositions",
        "--mode",
        "production",
        "--source-map",
        "none",
        "--json"
      ],
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }
    );

    assert.equal(code, 0);
    const result = JSON.parse(stdout[0]!) as {
      manifestPath: string;
      manifest: { compositions: Array<{ id: string }> };
    };
    assert.equal(result.manifest.compositions[0]?.id, "ProductDemo");
    const persisted = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      compositions: Array<{ id: string }>;
    };
    assert.equal(persisted.compositions[0]?.id, "ProductDemo");
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

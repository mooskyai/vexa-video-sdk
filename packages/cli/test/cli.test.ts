import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseCliArgs, runCli } from "../src/cli.js";
import { tryRenderCompositionVideo } from "../src/composition.js";

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

test("composition render detection preserves existing media source shapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-cli-media-detection-"));
  try {
    const extensionlessInput = join(root, "media-source");
    await writeFile(extensionlessInput, "fixture", "utf8");
    assert.equal(
      await tryRenderCompositionVideo({
        compositionId: extensionlessInput,
        output: join(root, "output.mp4")
      }),
      null
    );
    assert.equal(
      await tryRenderCompositionVideo({
        compositionId: "missing-input.mp4",
        output: join(root, "output.mp4")
      }),
      null
    );
    assert.equal(
      await tryRenderCompositionVideo({
        compositionId: "https://example.com/input",
        output: join(root, "output.mp4")
      }),
      null
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createExecutableCliBundle(root: string): Promise<string> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(
    [
      "bundle",
      "packages/renderer/test/fixtures/acceptance/entry.tsx",
      "--out-dir",
      join(root, "bundle"),
      "--source-map",
      "none",
      "--json"
    ],
    {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    }
  );
  assert.equal(code, 0, stderr.join("\n"));
  assert.deepEqual(stderr, []);
  return (JSON.parse(stdout[0]!) as { manifestPath: string }).manifestPath;
}

test("CLI renders a bundled video composition through the existing renderer", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-cli-composition-video-"));
  try {
    const manifestPath = await createExecutableCliBundle(root);
    const output = join(root, "product-demo.mp4");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      [
        "render",
        "product-demo",
        output,
        "--manifest",
        manifestPath,
        "--start-frame",
        "0",
        "--end-frame",
        "2",
        "--props",
        '{"background":"#223344"}',
        "--json"
      ],
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }
    );

    assert.equal(code, 0, stderr.join("\n"));
    const result = JSON.parse(stdout[0]!) as {
      target: string;
      output: string;
      plan: { frames: { startFrame: number; endFrameExclusive: number } };
    };
    assert.equal(result.target, "video");
    assert.equal(result.output, output);
    assert.deepEqual(result.plan.frames, { startFrame: 0, endFrameExclusive: 2, frameCount: 2 });
    assert.ok((await readFile(output)).byteLength > 0);
    assert.ok(stderr.some((line) => line.includes("progress 100.0%")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI still renders true stills and selected video frames", async () => {
  const root = await mkdtemp(join(tmpdir(), "vexa-cli-composition-still-"));
  try {
    const manifestPath = await createExecutableCliBundle(root);
    const stillOutput = join(root, "social-square.png");
    const frameOutput = join(root, "product-demo-frame.webp");

    const stillStdout: string[] = [];
    const stillStderr: string[] = [];
    const stillCode = await runCli(
      [
        "still",
        "social-square",
        stillOutput,
        "--manifest",
        manifestPath,
        "--props",
        '{"background":"#334455"}',
        "--json"
      ],
      {
        stdout: (value) => stillStdout.push(value),
        stderr: (value) => stillStderr.push(value)
      }
    );
    assert.equal(stillCode, 0, stillStderr.join("\n"));
    assert.equal((JSON.parse(stillStdout[0]!) as { target: string }).target, "still");
    assert.ok((await readFile(stillOutput)).byteLength > 0);

    const frameStdout: string[] = [];
    const frameStderr: string[] = [];
    const frameCode = await runCli(
      [
        "still",
        "product-demo",
        frameOutput,
        "--manifest",
        manifestPath,
        "--frame",
        "1",
        "--props",
        '{"background":"#445566"}',
        "--json"
      ],
      {
        stdout: (value) => frameStdout.push(value),
        stderr: (value) => frameStderr.push(value)
      }
    );
    assert.equal(frameCode, 0, frameStderr.join("\n"));
    const frameResult = JSON.parse(frameStdout[0]!) as { target: string; frame: number };
    assert.equal(frameResult.target, "frame");
    assert.equal(frameResult.frame, 1);
    assert.ok((await readFile(frameOutput)).byteLength > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

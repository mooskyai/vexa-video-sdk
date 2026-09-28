import assert from "node:assert/strict";
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

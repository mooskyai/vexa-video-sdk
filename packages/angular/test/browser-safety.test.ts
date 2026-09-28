import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.name.endsWith(".ts")) result.push(path);
  }
  return result;
}

test("Angular package contains no Node runtime or SDK imports", async () => {
  const files = await sourceFiles(resolve(process.cwd(), "packages/angular/src"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /from\s+["']node:/u, file);
    assert.doesNotMatch(source, /["']@vexa-video\/sdk["']/u, file);
    assert.doesNotMatch(source, /child_process/u, file);
  }
});

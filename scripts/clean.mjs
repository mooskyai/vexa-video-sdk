import { rm } from "node:fs/promises";
import { glob } from "node:fs/promises";

for await (const path of glob(["packages/*/dist", "examples/*/dist", "packages/*/*.tsbuildinfo", "examples/*/*.tsbuildinfo", ".tmp/visual-playground"])) {
  await rm(path, { recursive: true, force: true });
}

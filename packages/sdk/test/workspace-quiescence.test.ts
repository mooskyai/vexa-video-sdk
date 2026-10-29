import assert from "node:assert/strict";
import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InvalidStorageError } from "@vexa-video/core";
import { MediaWorkspace, type WorkspaceQuiescence } from "../src/storage.js";

async function withOldWorkspace(run: (root: string, path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "vexa-v31t-"));
  try {
    const workspace = await MediaWorkspace.create({ root, prefix: "vexa-owned-" });
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(workspace.path, old, old);
    await run(root, workspace.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function gate(events: string[], allowed = true): WorkspaceQuiescence {
  return {
    inspect: async () => { events.push("inspect"); return allowed; },
    withExclusiveReclaim: async (_path, action) => {
      events.push("seal");
      if (!allowed) return false;
      return await action(async () => true);
    }
  };
}

test("V3.1t requires external authority alongside distributed coordination", async () => {
  await withOldWorkspace(async (root) => {
    await assert.rejects(() => MediaWorkspace.reclaimAbandoned({
      root, prefix: "vexa-owned-", minAgeMs: 60_000, dryRun: false,
      quiescence: gate([])
    }), InvalidStorageError);
  });
});

test("V3.1t dry-run is read-only and live registration blocks an aged workspace", async () => {
  await withOldWorkspace(async (root, path) => {
    const events: string[] = [];
    const options = { root, prefix: "vexa-owned-", minAgeMs: 60_000,
      confirmAbandoned: async () => true, quiescence: gate(events, false) };
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned(options)).eligiblePaths, []);
    assert.deepEqual((await MediaWorkspace.reclaimAbandoned({ ...options, dryRun: false })).removedPaths, []);
    assert.deepEqual(events, ["inspect", "inspect"]);
    assert.ok((await stat(path)).isDirectory());
  });
});

test("V3.1t changing external authority after seal prevents deletion", async () => {
  await withOldWorkspace(async (root, path) => {
    let checks = 0;
    const events: string[] = [];
    const options = { root, prefix: "vexa-owned-", minAgeMs: 60_000, dryRun: false,
      confirmAbandoned: async () => ++checks === 1,
      quiescence: gate(events) };
    const outcome = await MediaWorkspace.reclaimAbandoned(options);
    assert.deepEqual(outcome.removedPaths, []);
    assert.deepEqual(events, ["inspect", "seal"]);
    assert.equal(checks, 2);
    assert.ok((await stat(path)).isDirectory());
  });
});

test("V3.1t authority outage after exclusive reservation fails closed", async () => {
  await withOldWorkspace(async (root, path) => {
    let checks = 0;
    const options = { root, prefix: "vexa-owned-", minAgeMs: 60_000, dryRun: false,
      confirmAbandoned: async () => { if (++checks === 2) throw new Error("reference store offline"); return true; },
      quiescence: gate([]) };
    await assert.rejects(() => MediaWorkspace.reclaimAbandoned(options), /reference store offline/);
    assert.ok((await stat(path)).isDirectory());
  });
});

test("V3.1t destructive action runs only inside exclusive reservation", async () => {
  await withOldWorkspace(async (root, path) => {
    let sealed = false;
    const quiescence: WorkspaceQuiescence = {
      inspect: async () => true,
      withExclusiveReclaim: async (_path, action) => {
        sealed = true;
        try { return await action(async () => true); } finally { sealed = false; }
      }
    };
    let checked = 0;
    const outcome = await MediaWorkspace.reclaimAbandoned({
      root, prefix: "vexa-owned-", minAgeMs: 60_000, dryRun: false, quiescence,
      confirmAbandoned: async () => { checked += 1; if (checked === 2) assert.ok(sealed); return true; }
    });
    assert.deepEqual(outcome.removedPaths, [path]);
    assert.equal(checked, 2);
    await assert.rejects(() => stat(path), { code: "ENOENT" });
  });
});

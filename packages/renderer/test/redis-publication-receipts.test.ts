import assert from "node:assert/strict";
import test from "node:test";
import { createHostedCompositionRenderRequest } from "@vexa-video/core";
import { fingerprintHostedCompositionPublication } from "../src/publication-recovery.js";
import { RedisHostedCompositionReceiptStore } from "../src/redis-publication-receipts.js";

class MemoryRedis {
  readonly entries = new Map<string, string>();
  async sendCommand(args: readonly string[]): Promise<unknown> {
    if (args[0] === "GET") return this.entries.get(args[1]!) ?? null;
    if (args[0] === "EVAL" && args[1]?.includes("VEXA_PUBLICATION_RECEIPT_CAS")) {
      const old = this.entries.get(args[3]!);
      if (old !== undefined) return old === args[5] ? "unchanged" : "conflict";
      this.entries.set(args[3]!, args[5]!);
      this.entries.set(args[4]!, String(Date.now()));
      return "created";
    }
    if (args[0] === "EVAL" && args[1]?.includes("VEXA_PUBLICATION_RECEIPT_RETIRE")) {
      const old = this.entries.get(args[3]!);
      if (old === undefined) return "missing";
      if (old !== args[5]) return "changed";
      const stamp = this.entries.get(args[4]!);
      if (!stamp || !/^\d+$/u.test(stamp)) return "untracked";
      if (Date.now() - Number(stamp) < Number(args[6])) return "too-new";
      if (args[7] === "1") return "eligible";
      this.entries.delete(args[3]!);
      this.entries.delete(args[4]!);
      return "removed";
    }
    throw new Error("Unexpected Redis command.");
  }
}

function request(count = 2) {
  return createHostedCompositionRenderRequest({
    schemaVersion: 1,
    bundle: { id: "bundle", manifest: "provider://bundle/manifest.json" },
    compositionId: "Main",
    target: { kind: "video", container: "mp4" },
    inputProps: { count },
    output: { artifactId: "tenant/film", destination: "s3://renders/tenant/film.mp4" }
  }).payload;
}

function context(payload: ReturnType<typeof request>, signal = new AbortController().signal) {
  return { jobId: "job-1", attempt: 1, signal, fingerprint: fingerprintHostedCompositionPublication(payload) };
}

function receipt(payload: ReturnType<typeof request>) {
  return { fingerprint: fingerprintHostedCompositionPublication(payload), artifact: {
    url: "s3://renders/tenant/film.mp4", name: "tenant/film", contentType: "video/mp4"
  } };
}

function store(redis: MemoryRedis, verifyArtifact: () => boolean | Promise<boolean> = () => true) {
  return new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", verifyArtifact
  });
}

test("Redis hosted receipts persist across store instances and duplicate records are repeat-safe", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  const first = store(redis);
  await first.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  await store(redis).recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  assert.deepEqual(await store(redis).lookupPublishedArtifact(payload.output, payload, context(payload)), receipt(payload));
  assert.equal(redis.entries.size, 2);
});

test("Redis hosted receipt CAS rejects changed inputs for the same remote destination", async () => {
  const redis = new MemoryRedis();
  const first = request();
  const changed = request(9);
  const a = store(redis);
  const b = store(redis);
  const writes = await Promise.allSettled([
    a.recordPublishedArtifact(receipt(first), first.output, first, context(first)),
    b.recordPublishedArtifact(receipt(changed), changed.output, changed, context(changed))
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.filter((result) => result.status === "rejected").length, 1);
  const saved = await a.lookupPublishedArtifact(first.output, first, context(first));
  assert.deepEqual(saved, receipt(first));
  await assert.rejects(() => b.lookupPublishedArtifact(changed.output, changed, context(changed)), /identity/);
});

test("Redis hosted receipts fail closed when an external artifact is missing or unverified", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  await assert.rejects(() => store(redis, () => false).recordPublishedArtifact(
    receipt(payload), payload.output, payload, context(payload)
  ), /unverified/);
  assert.equal(redis.entries.size, 0);
  await store(redis).recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  await assert.rejects(() => store(redis, () => false).lookupPublishedArtifact(
    payload.output, payload, context(payload)
  ), /unverified/);
  await assert.rejects(() => store(redis, () => { throw new Error("provider unavailable"); })
    .lookupPublishedArtifact(payload.output, payload, context(payload)), /provider unavailable/);
});

test("Redis hosted receipts refuse cancellation, unsafe namespaces and malformed state", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => store(redis).recordPublishedArtifact(
    receipt(payload), payload.output, payload, context(payload, controller.signal)
  ), /aborted/);
  assert.equal(redis.entries.size, 0);
  assert.throws(() => new RedisHostedCompositionReceiptStore(redis, {
    prefix: "", verifyArtifact: () => true
  }), /tenant-scoped/);
  await store(redis).recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  const key = [...redis.entries.keys()][0]!;
  redis.entries.set(key, "garbled");
  await assert.rejects(() => store(redis).lookupPublishedArtifact(payload.output, payload, context(payload)), /invalid JSON/);
});


test("V3.1k reconstructs a missing receipt from authoritative remote metadata", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  let inspected = 0;
  let verified = 0;
  const adapter = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a",
    inspectArtifact: () => { inspected += 1; return receipt(payload); },
    verifyArtifact: () => { verified += 1; return true; }
  });
  assert.deepEqual(await adapter.reconcileUnrecordedArtifact(payload.output, payload, context(payload)), receipt(payload));
  assert.deepEqual(await adapter.reconcileUnrecordedArtifact(payload.output, payload, context(payload)), receipt(payload));
  assert.equal(inspected, 1);
  assert.ok(verified >= 3);
  assert.equal(redis.entries.size, 2);
});

test("V3.1k refuses to adopt a remote artifact for different inputs or destination", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  const wrong = request(99);
  const badIdentity = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", inspectArtifact: () => receipt(wrong), verifyArtifact: () => true
  });
  await assert.rejects(() => badIdentity.reconcileUnrecordedArtifact(
    payload.output, payload, context(payload)
  ), /identity/);
  const wrongDestination = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", inspectArtifact: () => ({ ...receipt(payload), artifact: {
      ...receipt(payload).artifact, url: "s3://renders/tenant/other.mp4"
    } }), verifyArtifact: () => true
  });
  await assert.rejects(() => wrongDestination.reconcileUnrecordedArtifact(
    payload.output, payload, context(payload)
  ), /different remote destination/);
  assert.equal(redis.entries.size, 0);
});

test("V3.1k refuses unverifiable and unavailable remote artifacts", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  const missing = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", inspectArtifact: () => null, verifyArtifact: () => true
  });
  assert.equal(await missing.reconcileUnrecordedArtifact(payload.output, payload, context(payload)), null);
  const unverified = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", inspectArtifact: () => receipt(payload), verifyArtifact: () => false
  });
  await assert.rejects(() => unverified.reconcileUnrecordedArtifact(
    payload.output, payload, context(payload)
  ), /unverified/);
  const offline = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", inspectArtifact: () => { throw new Error("provider unavailable"); },
    verifyArtifact: () => true
  });
  await assert.rejects(() => offline.reconcileUnrecordedArtifact(
    payload.output, payload, context(payload)
  ), /provider unavailable/);
  assert.equal(redis.entries.size, 0);
});

test("V3.1k requires opt-in remote inspection and refuses cancellation", async () => {
  const redis = new MemoryRedis();
  const payload = request();
  await assert.rejects(() => store(redis).reconcileUnrecordedArtifact(
    payload.output, payload, context(payload)
  ), /inspectArtifact/);
  let inspected = 0;
  const adapter = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", inspectArtifact: () => { inspected += 1; return receipt(payload); },
    verifyArtifact: () => true
  });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => adapter.reconcileUnrecordedArtifact(
    payload.output, payload, context(payload, controller.signal)
  ), /aborted/);
  assert.equal(inspected, 0);
  assert.equal(redis.entries.size, 0);
});


test("V3.1l dry-run is safe and only explicitly retires an aged missing receipt", async () => {
  const redis = new MemoryRedis(); const payload = request();
  const adapter = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", verifyArtifact: () => true,
    inspectArtifact: () => null, isReceiptUnreferenced: () => true
  });
  await adapter.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  const stamp = [...redis.entries.keys()].find(k => k.endsWith(":recordedAt"))!;
  redis.entries.set(stamp, String(Date.now() - 3 * 86_400_000));
  const age = { minAgeMs: 86_400_000 };
  assert.deepEqual(await adapter.retireMissingReceipt(payload.output, payload, context(payload), age),
    { status: "eligible", dryRun: true });
  assert.equal(redis.entries.size, 2);
  assert.deepEqual(await adapter.retireMissingReceipt(payload.output, payload, context(payload),
    { ...age, dryRun: false }), { status: "removed", dryRun: false });
  assert.equal(redis.entries.size, 0);
});

test("V3.1l refuses live, referenced, young and legacy receipts", async () => {
  const redis = new MemoryRedis(); const payload = request();
  let remotePresent = true, unreferenced = true;
  const adapter = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", verifyArtifact: () => true,
    inspectArtifact: () => remotePresent ? receipt(payload) : null,
    isReceiptUnreferenced: () => unreferenced
  });
  await adapter.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  const run = () => adapter.retireMissingReceipt(payload.output, payload, context(payload),
    { minAgeMs: 86_400_000, dryRun: false });
  assert.equal((await run()).status, "present"); remotePresent = false;
  unreferenced = false; assert.equal((await run()).status, "referenced");
  unreferenced = true; assert.equal((await run()).status, "too-new");
  const stamp = [...redis.entries.keys()].find(k => k.endsWith(":recordedAt"))!;
  redis.entries.delete(stamp);
  assert.equal((await run()).status, "untracked");
  assert.equal(redis.entries.size, 1);
});

test("V3.1l refuses invalid policies, missing authority, and cancellation", async () => {
  const redis = new MemoryRedis(); const payload = request();
  await assert.rejects(() => store(redis).retireMissingReceipt(payload.output, payload, context(payload),
    { minAgeMs: 86_400_000 }), /inspectArtifact/);
  const adapter = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", verifyArtifact: () => true,
    inspectArtifact: () => null, isReceiptUnreferenced: () => true
  });
  await assert.rejects(() => adapter.retireMissingReceipt(payload.output, payload, context(payload),
    { minAgeMs: 5000 }), /one day/);
  await assert.rejects(() => adapter.retireMissingReceipt(payload.output, payload, context(payload),
    { minAgeMs: 86_400_000, dryRun: "false" as unknown as boolean }), /boolean dryRun/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => adapter.retireMissingReceipt(payload.output, payload,
    context(payload, controller.signal), { minAgeMs: 86_400_000 }), /aborted/);
  assert.equal(redis.entries.size, 0);
});

test("V3.1l atomic retire fences a replaced receipt", async () => {
  const redis = new MemoryRedis(); const payload = request();
  const adapter = new RedisHostedCompositionReceiptStore(redis, {
    prefix: "vexa:test:tenant-a", verifyArtifact: () => true,
    inspectArtifact: () => null, isReceiptUnreferenced: () => true
  });
  await adapter.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
  const stamp = [...redis.entries.keys()].find(k => k.endsWith(":recordedAt"))!;
  redis.entries.set(stamp, String(Date.now() - 4 * 86_400_000));
  const key = [...redis.entries.keys()].find(k => !k.endsWith(":recordedAt"))!;
  const original = redis.entries.get(key)!;
  const oldSend = redis.sendCommand.bind(redis);
  redis.sendCommand = async (args: readonly string[]): Promise<unknown> => {
    if (args[0] === "EVAL" && args[1]?.includes("VEXA_PUBLICATION_RECEIPT_RETIRE")) {
      redis.entries.set(key, `${original} `);
    }
    return oldSend(args);
  };
  assert.equal((await adapter.retireMissingReceipt(payload.output, payload, context(payload),
    { minAgeMs: 86_400_000, dryRun: false })).status, "changed");
  assert.equal(redis.entries.size, 2);
});

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
      if (old !== undefined) return old === args[4] ? "unchanged" : "conflict";
      this.entries.set(args[3]!, args[4]!);
      return "created";
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
  assert.equal(redis.entries.size, 1);
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

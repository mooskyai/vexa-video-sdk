import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createHostedCompositionRenderRequest } from "@vexa-video/core";
import { LiveRedisClient, liveRedisAddress, removeTestKeys } from "../../sdk/test/live-redis-client.js";
import { fingerprintHostedCompositionPublication } from "../src/publication-recovery.js";
import { RedisHostedCompositionReceiptStore } from "../src/redis-publication-receipts.js";

liveRedisAddress();
const prefix = `vexa:receipt:acceptance:${randomUUID().replaceAll("-", "")}`;
const root = await mkdtemp(join(tmpdir(), "vexa-receipt-acceptance-"));
const target = join(root, "movie.mp4");

function request(version = 1, destination = pathToFileURL(target).href) {
  return createHostedCompositionRenderRequest({
    schemaVersion: 1,
    bundle: { id: "bundle", manifest: "provider://bundle/manifest.json" },
    compositionId: "Main",
    target: { kind: "video", container: "mp4" },
    inputProps: { version },
    output: { artifactId: "customer/movie", destination }
  }).payload;
}
function context(payload: ReturnType<typeof request>) {
  return { jobId: "job", attempt: 1, signal: new AbortController().signal,
    fingerprint: fingerprintHostedCompositionPublication(payload) };
}
function receipt(payload: ReturnType<typeof request>) {
  return { fingerprint: fingerprintHostedCompositionPublication(payload),
    artifact: { url: payload.output.destination!, name: payload.output.artifactId, contentType: "video/mp4" } };
}
function store(client: LiveRedisClient, file = target) {
  return new RedisHostedCompositionReceiptStore(client, {
    prefix,
    verifyArtifact: async () => {
      try { return (await stat(file)).size === 5; } catch { return false; }
    }
  });
}

test("live Redis: publication receipt survives client restart and missing artifact fails closed", { timeout: 15_000 }, async () => {
  const payload = request();
  await writeFile(target, "video");
  const writer = await LiveRedisClient.open();
  try { await store(writer).recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload)); }
  finally { writer.close(); }
  const reader = await LiveRedisClient.open();
  try {
    assert.deepEqual(await store(reader).lookupPublishedArtifact(payload.output, payload, context(payload)), receipt(payload));
    await rm(target);
    await assert.rejects(() => store(reader).lookupPublishedArtifact(payload.output, payload, context(payload)), /unverified/);
  } finally { reader.close(); }
});

test("live Redis: competing publication receipts cannot replace a committed destination", { timeout: 15_000 }, async () => {
  const secondFile = join(root, "movie2.mp4");
  await writeFile(secondFile, "video");
  const destination = pathToFileURL(secondFile).href;
  const first = request(2, destination), changed = request(3, destination);
  const a = await LiveRedisClient.open(), b = await LiveRedisClient.open();
  try {
    const attempts = await Promise.allSettled([
      store(a, secondFile).recordPublishedArtifact(receipt(first), first.output, first, context(first)),
      store(b, secondFile).recordPublishedArtifact(receipt(changed), changed.output, changed, context(changed))
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const winnerIndex = attempts.findIndex((result) => result.status === "fulfilled");
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = winnerIndex === 0 ? first : changed;
    const loser = loserIndex === 0 ? first : changed;
    assert.match(String((attempts[loserIndex] as PromiseRejectedResult).reason), /conflicts with a previous publication/);
    assert.deepEqual(
      await store(a, secondFile).lookupPublishedArtifact(winner.output, winner, context(winner)),
      receipt(winner)
    );
    await assert.rejects(() => store(b, secondFile).lookupPublishedArtifact(
      loser.output, loser, context(loser)
    ), /identity/);
  } finally { a.close(); b.close(); }
});



test("live Redis: missing receipt is recovered from provider evidence across clients", { timeout: 15_000 }, async () => {
  const recoveryFile = join(root, "orphan-upload.mp4");
  await writeFile(recoveryFile, "video");
  const payload = request(12, pathToFileURL(recoveryFile).href);
  const saved = receipt(payload);
  const writer = await LiveRedisClient.open();
  try {
    const adapter = new RedisHostedCompositionReceiptStore(writer, {
      prefix,
      inspectArtifact: async () => {
        assert.equal((await stat(recoveryFile)).size, 5);
        return saved;
      },
      verifyArtifact: async () => (await stat(recoveryFile)).size === 5
    });
    assert.deepEqual(await adapter.reconcileUnrecordedArtifact(
      payload.output, payload, context(payload)
    ), saved);
  } finally { writer.close(); }
  const reader = await LiveRedisClient.open();
  try {
    assert.deepEqual(await store(reader, recoveryFile).lookupPublishedArtifact(
      payload.output, payload, context(payload)
    ), saved);
    await rm(recoveryFile);
    await assert.rejects(() => store(reader, recoveryFile).lookupPublishedArtifact(
      payload.output, payload, context(payload)
    ), /unverified/);
  } finally { reader.close(); }
});

test("live Redis: conflicting recovery attempts cannot adopt another request's destination", { timeout: 15_000 }, async () => {
  const recoveryFile = join(root, "competing-orphan.mp4");
  await writeFile(recoveryFile, "video");
  const destination = pathToFileURL(recoveryFile).href;
  const owner = request(20, destination), stranger = request(21, destination);
  const a = await LiveRedisClient.open(), b = await LiveRedisClient.open();
  try {
    const config = {
      prefix,
      inspectArtifact: async () => receipt(owner),
      verifyArtifact: async () => (await stat(recoveryFile)).size === 5
    };
    const [accepted, denied] = await Promise.allSettled([
      new RedisHostedCompositionReceiptStore(a, config).reconcileUnrecordedArtifact(
        owner.output, owner, context(owner)
      ),
      new RedisHostedCompositionReceiptStore(b, config).reconcileUnrecordedArtifact(
        stranger.output, stranger, context(stranger)
      )
    ]);
    assert.equal(accepted.status, "fulfilled");
    assert.equal(denied.status, "rejected");
    assert.match(String((denied as PromiseRejectedResult).reason), /identity/);
    assert.deepEqual(await store(a, recoveryFile).lookupPublishedArtifact(
      owner.output, owner, context(owner)
    ), receipt(owner));
  } finally { a.close(); b.close(); }
});



test("live Redis: old missing receipt requires dry-run then explicit retirement", { timeout: 15_000 }, async () => {
  const file = join(root, "expired-receipt.mp4");
  await writeFile(file, "video");
  const payload = request(31, pathToFileURL(file).href);
  const client = await LiveRedisClient.open();
  try {
    const adapter = new RedisHostedCompositionReceiptStore(client, {
      prefix,
      verifyArtifact: async () => { try { return (await stat(file)).size === 5; } catch { return false; } },
      inspectArtifact: async () => { try { await stat(file); return receipt(payload); } catch { return null; } },
      isReceiptUnreferenced: () => true
    });
    await adapter.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
    const key = `${prefix}:publication:${createHash("sha256").update(payload.output.destination!).digest("hex")}`;
    await client.sendCommand(["SET", `${key}:recordedAt`, String(Date.now() - 5 * 86_400_000)]);
    await rm(file);
    const args = { minAgeMs: 2 * 86_400_000 };
    assert.equal((await adapter.retireMissingReceipt(payload.output, payload, context(payload), args)).status,
      "eligible");
    assert.equal(await client.sendCommand(["EXISTS", key]), 1);
    assert.equal((await adapter.retireMissingReceipt(payload.output, payload, context(payload),
      { ...args, dryRun: false })).status, "removed");
    assert.equal(await client.sendCommand(["EXISTS", key]), 0);
  } finally { client.close(); }
});

test("live Redis: referenced and recently recorded receipts cannot be retired", { timeout: 15_000 }, async () => {
  const file = join(root, "protected-receipt.mp4");
  await writeFile(file, "video");
  const payload = request(32, pathToFileURL(file).href);
  const client = await LiveRedisClient.open();
  try {
    let active = true;
    const adapter = new RedisHostedCompositionReceiptStore(client, {
      prefix,
      verifyArtifact: () => true,
      inspectArtifact: () => null,
      isReceiptUnreferenced: () => !active
    });
    await adapter.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
    const args = { minAgeMs: 86_400_000, dryRun: false };
    assert.equal((await adapter.retireMissingReceipt(payload.output, payload, context(payload), args)).status,
      "referenced");
    active = false;
    assert.equal((await adapter.retireMissingReceipt(payload.output, payload, context(payload), args)).status,
      "too-new");
    assert.deepEqual(await adapter.lookupPublishedArtifact(payload.output, payload, context(payload)),
      receipt(payload));
  } finally { client.close(); }
});


test("live Redis: bounded inspection is read-only for aged and missing receipts", { timeout: 15_000 }, async () => {
  const file = join(root, "inspection-old.mp4");
  await writeFile(file, "video");
  const payload = request(71, pathToFileURL(file).href);
  const missing = request(72, pathToFileURL(join(root, "inspection-absent.mp4")).href);
  const client = await LiveRedisClient.open();
  try {
    const adapter = new RedisHostedCompositionReceiptStore(client, {
      prefix,
      verifyArtifact: () => true,
      inspectArtifact: () => null,
      isReceiptUnreferenced: () => true
    });
    await adapter.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
    const key = `${prefix}:publication:${createHash("sha256").update(payload.output.destination!).digest("hex")}`;
    await client.sendCommand(["SET", `${key}:recordedAt`, String(Date.now() - 3 * 86_400_000)]);
    await rm(file);
    const report = await adapter.inspectKnownReceipts([
      { output: payload.output, payload, context: context(payload) },
      { output: missing.output, payload: missing, context: context(missing) }
    ], { minAgeMs: 86_400_000 });
    assert.deepEqual(report.entries.map(entry => entry.status), ["eligible", "missing"]);
    assert.equal(await client.sendCommand(["EXISTS", key]), 1);
    assert.equal(await client.sendCommand(["EXISTS", `${key}:recordedAt`]), 1);
  } finally { client.close(); }
});

test("live Redis: inspection reports referenced receipts and isolates provider errors", { timeout: 15_000 }, async () => {
  const file = join(root, "inspection-referenced.mp4");
  await writeFile(file, "video");
  const payload = request(73, pathToFileURL(file).href);
  const client = await LiveRedisClient.open();
  try {
    const present = new RedisHostedCompositionReceiptStore(client, {
      prefix, verifyArtifact: () => true, inspectArtifact: () => null,
      isReceiptUnreferenced: () => false
    });
    await present.recordPublishedArtifact(receipt(payload), payload.output, payload, context(payload));
    const good = await present.inspectKnownReceipts([
      { output: payload.output, payload, context: context(payload) }
    ], { minAgeMs: 86_400_000 });
    assert.equal(good.entries[0]?.status, "referenced");
    const broken = new RedisHostedCompositionReceiptStore(client, {
      prefix, verifyArtifact: () => true, inspectArtifact: () => { throw new Error("provider offline"); },
      isReceiptUnreferenced: () => true
    });
    const report = await broken.inspectKnownReceipts([
      { output: payload.output, payload, context: context(payload) }
    ], { minAgeMs: 86_400_000 });
    assert.equal(report.entries[0]?.status, "error");
    assert.equal(JSON.stringify(report).includes("provider offline"), false);
    assert.deepEqual(await present.lookupPublishedArtifact(payload.output, payload, context(payload)), receipt(payload));
  } finally { client.close(); }
});

test.after(async () => {
  const client = await LiveRedisClient.open();
  try { await removeTestKeys(client, prefix); } finally { client.close(); }
  await rm(root, { recursive: true, force: true });
});

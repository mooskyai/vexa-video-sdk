import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

test.after(async () => {
  const client = await LiveRedisClient.open();
  try { await removeTestKeys(client, prefix); } finally { client.close(); }
  await rm(root, { recursive: true, force: true });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createHostedCompositionRenderRequest } from "@vexa-video/core";
import { LiveRedisClient, liveRedisAddress, removeTestKeys } from "../../sdk/test/live-redis-client.js";
import { RedisHostedCompositionReceiptStore } from "../src/redis-publication-receipts.js";
import { fingerprintHostedCompositionPublication } from "../src/publication-recovery.js";
import { LoopbackS3 } from "./object-storage-s3-helper.mjs";

// NOT included in npm run verify/test:redis. Requires a dedicated local S3 server + Redis.
liveRedisAddress();
const s3 = new LoopbackS3();
const bucket = `vexa-acceptance-${randomUUID().replaceAll("-", "")}`;
const prefix = `vexa:object:acceptance:${randomUUID().replaceAll("-", "")}`;
const keys = new Set();

function makeCase(version, key) {
  if (!/^case-[a-z0-9-]+\.mp4$/.test(key)) throw new Error("Invalid isolated test key.");
  keys.add(key);
  const payload = createHostedCompositionRenderRequest({
    schemaVersion: 1,
    bundle: { id: "bundle", manifest: "provider://bundle/manifest.json" },
    compositionId: "Main",
    target: { kind: "video", container: "mp4" },
    inputProps: { version },
    output: { artifactId: "customer/movie", destination: `s3://${bucket}/${key}` }
  }).payload;
  const bytes = Buffer.from(`vexa-v31o-verified-media-bytes-${version}`);
  const fingerprint = fingerprintHostedCompositionPublication(payload);
  const receipt = { fingerprint, artifact: {
    url: payload.output.destination, name: payload.output.artifactId, contentType: "video/mp4"
  } };
  const context = { jobId: `object-${version}`, attempt: 1, fingerprint,
    signal: new AbortController().signal };
  return { key, payload, bytes, fingerprint, receipt, context };
}

function adapter(client, example) {
  return new RedisHostedCompositionReceiptStore(client, {
    prefix,
    verifyArtifact: async (receipt, output) => {
      const remote = await s3.head(bucket, example.key);
      return !!remote && remote.fingerprint === receipt.fingerprint
        && remote.artifactId === output.artifactId && remote.sizeBytes === example.bytes.length;
    },
    inspectArtifact: async (output) => {
      const remote = await s3.head(bucket, example.key);
      if (!remote) return null;
      // Trust ONLY persisted provider metadata; never substitute caller's expected fingerprint.
      if (!remote.fingerprint || !/^[a-f0-9]{64}$/.test(remote.fingerprint)
        || !remote.artifactId) throw new Error("S3 object lacks authoritative request identity.");
      return { fingerprint: remote.fingerprint, artifact: {
        url: output.destination, name: remote.artifactId, contentType: "video/mp4"
      } };
    }
  });
}

async function publish(example) {
  return s3.upload(bucket, example.key, example.bytes, example.fingerprint, example.payload.output.artifactId);
}

async function runCrashedWorker(mode, example) {
  const fixture = fileURLToPath(new URL("./fixtures/object-storage-crash-worker.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", fixture], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, VEXA_TEST_CRASH_POINT: mode, VEXA_TEST_CRASH_CASE: JSON.stringify({
      bucket, key: example.key, prefix, payload: example.payload, bytes: example.bytes.toString("base64")
    }) }
  });
  let diagnostic = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => { diagnostic = (diagnostic + text).slice(-1_000); });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Crash worker timed out.")); }, 15_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (exitCode, signal) => { clearTimeout(timeout);
      if (signal) reject(new Error(`Crash worker terminated by ${signal}.`));
      else resolve(exitCode);
    });
  });
  assert.equal(code, mode === "before-upload" ? 72 : mode === "after-upload" ? 73 : 74, `Crash fixture failed: ${diagnostic}`);
}

before(async () => { await s3.createBucket(bucket); });
after(async () => {
  // Clean ONLY the randomized bucket and Redis prefix belonging to this test invocation.
  const errors = [];
  for (const key of keys) {
    try { await s3.remove(bucket, key); } catch (error) { errors.push(error); }
  }
  try { await s3.deleteBucket(bucket); } catch (error) { errors.push(error); }
  const redis = await LiveRedisClient.open();
  try { await removeTestKeys(redis, prefix); } finally { redis.close(); }
  if (errors.length) throw new AggregateError(errors, "Isolated S3 acceptance cleanup failed.");
});

test("S3 crash before upload leaves no object and no Redis receipt", { timeout: 20_000 }, async () => {
  const example = makeCase(101, "case-before-upload.mp4");
  await runCrashedWorker("before-upload", example);
  const client = await LiveRedisClient.open();
  try {
    assert.equal(await s3.head(bucket, example.key), null);
    assert.equal(await adapter(client, example).lookupPublishedArtifact(
      example.payload.output, example.payload, example.context
    ), null);
    assert.equal(await adapter(client, example).reconcileUnrecordedArtifact(
      example.payload.output, example.payload, example.context
    ), null);
  } finally { client.close(); }
});

test("S3 process exit after acknowledged PUT but before receipt is safely reconciled", { timeout: 25_000 }, async () => {
  const example = makeCase(102, "case-after-upload.mp4");
  await runCrashedWorker("after-upload", example);
  assert.equal((await s3.head(bucket, example.key))?.fingerprint, example.fingerprint);
  const writer = await LiveRedisClient.open();
  try {
    const recovery = adapter(writer, example);
    assert.equal(await recovery.lookupPublishedArtifact(
      example.payload.output, example.payload, example.context
    ), null);
    assert.deepEqual(await recovery.reconcileUnrecordedArtifact(
      example.payload.output, example.payload, example.context
    ), example.receipt);
  } finally { writer.close(); }
  const reader = await LiveRedisClient.open();
  try {
    assert.deepEqual(await adapter(reader, example).lookupPublishedArtifact(
      example.payload.output, example.payload, example.context
    ), example.receipt);
    assert.deepEqual(await s3.read(bucket, example.key), example.bytes);
    assert.ok([409, 412].includes((await publish(example)).status));
  } finally { reader.close(); }
});

test("S3 process exit after Redis receipt preserves idempotent reuse", { timeout: 25_000 }, async () => {
  const example = makeCase(103, "case-after-receipt.mp4");
  await runCrashedWorker("after-receipt", example);
  const reader = await LiveRedisClient.open();
  try {
    assert.deepEqual(await adapter(reader, example).lookupPublishedArtifact(
      example.payload.output, example.payload, example.context
    ), example.receipt);
    assert.ok([409, 412].includes((await publish(example)).status));
    assert.deepEqual(await s3.read(bucket, example.key), example.bytes);
  } finally { reader.close(); }
});

test("S3 conditional concurrent writers preserve one remote fingerprint and reject wrong adoption", { timeout: 20_000 }, async () => {
  const a = makeCase(104, "case-concurrent.mp4");
  const b = makeCase(105, "case-concurrent.mp4");
  const responses = await Promise.all([publish(a), publish(b)]);
  assert.equal(responses.filter((r) => [200, 201].includes(r.status)).length, 1);
  assert.equal(responses.filter((r) => [409, 412].includes(r.status)).length, 1);
  const remote = await s3.head(bucket, a.key);
  const winner = remote?.fingerprint === a.fingerprint ? a : b;
  const loser = winner === a ? b : a;
  assert.equal(remote?.fingerprint, winner.fingerprint);
  assert.deepEqual(await s3.read(bucket, winner.key), winner.bytes);
  const writer = await LiveRedisClient.open();
  try {
    assert.deepEqual(await adapter(writer, winner).reconcileUnrecordedArtifact(
      winner.payload.output, winner.payload, winner.context
    ), winner.receipt);
    await assert.rejects(() => adapter(writer, loser).reconcileUnrecordedArtifact(
      loser.payload.output, loser.payload, loser.context
    ), /identity|conflict|fingerprint/i);
    assert.deepEqual(await s3.read(bucket, winner.key), winner.bytes);
  } finally { writer.close(); }
});

test("S3 missing object invalidates recorded receipt and blocks replay", { timeout: 20_000 }, async () => {
  const example = makeCase(106, "case-removed.mp4");
  assert.ok([200, 201].includes((await publish(example)).status));
  const writer = await LiveRedisClient.open();
  try { await adapter(writer, example).recordPublishedArtifact(
    example.receipt, example.payload.output, example.payload, example.context
  ); } finally { writer.close(); }
  await s3.remove(bucket, example.key);
  const reader = await LiveRedisClient.open();
  try {
    await assert.rejects(() => adapter(reader, example).lookupPublishedArtifact(
      example.payload.output, example.payload, example.context
    ), /unverified/);
    await assert.rejects(() => adapter(reader, example).reconcileUnrecordedArtifact(
      example.payload.output, example.payload, example.context
    ), /unverified/);
  } finally { reader.close(); }
});

test("S3 incomplete object metadata fails closed without adopting a receipt", { timeout: 20_000 }, async () => {
  const example = makeCase(107, "case-untrusted.mp4");
  assert.equal((await s3.request("PUT", bucket, example.key, {
    body: example.bytes, conditional: true, metadata: { "content-type": "video/mp4" }
  })).status, 200);
  const redis = await LiveRedisClient.open();
  try {
    await assert.rejects(() => adapter(redis, example).reconcileUnrecordedArtifact(
      example.payload.output, example.payload, example.context
    ), /authoritative/);
    assert.equal(await adapter(redis, example).lookupPublishedArtifact(
      example.payload.output, example.payload, example.context
    ), null);
  } finally { redis.close(); }
});

test("S3 auth error is not treated as authoritative object absence", { timeout: 20_000 }, async () => {
  const example = makeCase(108, "case-auth-error.mp4");
  const invalid = new LoopbackS3({
    ...process.env, VEXA_TEST_S3_ACCESS_KEY: "invalid-acceptance-key"
  });
  await assert.rejects(() => invalid.head(bucket, example.key), /HTTP 403|HTTP 401/);
  // A failed provider inspection must not result in a synthetic adoption or a receipt.
  const redis = await LiveRedisClient.open();
  try { assert.equal(await adapter(redis, example).lookupPublishedArtifact(
    example.payload.output, example.payload, example.context
  ), null); } finally { redis.close(); }
});

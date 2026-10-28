import { LiveRedisClient } from "../../../sdk/test/live-redis-client.js";
import { RedisHostedCompositionReceiptStore } from "../../src/redis-publication-receipts.js";
import { fingerprintHostedCompositionPublication } from "../../src/publication-recovery.js";
import { LoopbackS3 } from "../object-storage-s3-helper.mjs";

// Separate OS process: deliberate exit after remote PUT acknowledgement and optionally
// after the Redis receipt write, without completing a job or running process cleanup.
const mode = process.env.VEXA_TEST_CRASH_POINT;
const { bucket, key, prefix, payload, bytes } = JSON.parse(process.env.VEXA_TEST_CRASH_CASE ?? "null");
const s3 = new LoopbackS3();
if (mode === "before-upload") process.exit(72);
const fingerprint = fingerprintHostedCompositionPublication(payload);
const created = await s3.upload(bucket, key, Buffer.from(bytes, "base64"), fingerprint, payload.output.artifactId);
if (created.status !== 200 && created.status !== 201) throw new Error(`Conditional publication failed: ${created.status}`);
if (mode === "after-upload") process.exit(73);
if (mode !== "after-receipt") throw new Error("Unknown crash-point selector.");
const client = await LiveRedisClient.open();
const adapter = new RedisHostedCompositionReceiptStore(client, {
  prefix,
  verifyArtifact: async (receipt, output) => {
    const head = await s3.head(bucket, key);
    return !!head && head.fingerprint === receipt.fingerprint
      && head.artifactId === output.artifactId && head.sizeBytes === Buffer.from(bytes, "base64").length;
  }
});
const receipt = { fingerprint, artifact: {
  url: payload.output.destination, name: payload.output.artifactId, contentType: "video/mp4"
} };
await adapter.recordPublishedArtifact(receipt, payload.output, payload, {
  jobId: "crashed-worker", attempt: 1, fingerprint, signal: new AbortController().signal
});
// Exit without gracefully closing Redis: simulate abrupt worker termination after receipt CAS.
process.exit(74);

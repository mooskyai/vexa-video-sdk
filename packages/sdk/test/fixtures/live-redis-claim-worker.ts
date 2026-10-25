import { RedisJobTransport } from "../../src/redis-jobs.js";
import { LiveRedisClient } from "../live-redis-client.js";

const [prefix, queue, expectedId] = process.argv.slice(2);
if (!prefix || !queue || !expectedId) throw new Error("Missing live Redis claim-worker arguments.");
const client = await LiveRedisClient.open();
const transport = new RedisJobTransport(client, { prefix, queue, recoveryIntervalMs: 1_000 });
const claimed = await transport.claim("crash-test-worker", 500, 350);
if (claimed?.descriptor.id !== expectedId || !claimed.lease) {
  client.close();
  throw new Error("Isolated worker could not claim the expected job.");
}
process.stdout.write(`${JSON.stringify({ id: claimed.descriptor.id, claimId: claimed.lease.claimId })}\n`);
// Deliberately neither heartbeat nor finish. The parent terminates this process.
setInterval(() => undefined, 1_000);

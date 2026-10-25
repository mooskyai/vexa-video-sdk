import { connect, type Socket } from "node:net";
import type { RedisCommandClient } from "../../src/redis-jobs.js";

type RedisValue = string | number | null | RedisValue[] | Error;
type RedisReply = { value: RedisValue; offset: number };

/** Test-only RESP2 client: no production Redis dependency or FLUSHDB commands. */
function parseReply(data: Buffer, offset = 0): RedisReply | null {
  if (offset >= data.length) return null;
  const kind = String.fromCharCode(data[offset]!);
  const end = data.indexOf("\r\n", offset + 1);
  if (end === -1) return null;
  const header = data.toString("utf8", offset + 1, end);
  const next = end + 2;
  if (kind === "+") return { value: header, offset: next };
  if (kind === "-") return { value: new Error(`Redis error: ${header}`), offset: next };
  if (kind === ":") return { value: Number(header), offset: next };
  if (kind === "$") {
    const length = Number(header);
    if (length === -1) return { value: null, offset: next };
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid Redis bulk length.");
    if (data.length < next + length + 2) return null;
    if (data[next + length] !== 13 || data[next + length + 1] !== 10) {
      throw new Error("Invalid Redis bulk terminator.");
    }
    return { value: data.toString("utf8", next, next + length), offset: next + length + 2 };
  }
  if (kind === "*") {
    const count = Number(header);
    if (count === -1) return { value: null, offset: next };
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid Redis array length.");
    const values: RedisValue[] = [];
    let position = next;
    for (let index = 0; index < count; index += 1) {
      const entry = parseReply(data, position);
      if (!entry) return null;
      values.push(entry.value);
      position = entry.offset;
    }
    return { value: values, offset: position };
  }
  throw new Error(`Unsupported Redis reply type: ${kind}`);
}

export interface LiveRedisAddress { host: string; port: number }

/** Restrict destructive test setup to a dedicated loopback Redis endpoint. */
export function liveRedisAddress(): LiveRedisAddress {
  const raw = process.env.VEXA_TEST_REDIS_URL;
  if (!raw) throw new Error("Set VEXA_TEST_REDIS_URL to a dedicated local Redis instance before running test:redis.");
  const url = new URL(raw);
  if (url.protocol !== "redis:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("VEXA_TEST_REDIS_URL must be redis://localhost:PORT (loopback, no credentials/database).");
  }
  const port = Number(url.port || 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Redis test port.");
  return { host: url.hostname === "[::1]" ? "::1" : url.hostname, port };
}

export class LiveRedisClient implements RedisCommandClient {
  private pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  private input = Buffer.alloc(0);
  private closed = false;

  private constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.input = Buffer.concat([this.input, chunk]);
      try {
        while (this.pending.length > 0) {
          const reply = parseReply(this.input);
          if (!reply) break;
          this.input = this.input.subarray(reply.offset);
          const item = this.pending.shift()!;
          if (reply.value instanceof Error) item.reject(reply.value);
          else item.resolve(reply.value);
        }
      } catch (error) {
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error: Error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("Redis test socket closed.")));
  }

  static async open(): Promise<LiveRedisClient> {
    const address = liveRedisAddress();
    const socket = connect(address);
    socket.setTimeout(5_000, () => socket.destroy(new Error("Redis test connection timed out.")));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => { socket.off("error", reject); resolve(); });
      socket.once("error", reject);
    });
    socket.setTimeout(0);
    const client = new LiveRedisClient(socket);
    if (await client.sendCommand(["PING"]) !== "PONG") {
      client.close();
      throw new Error("Redis test server did not reply to PING.");
    }
    return client;
  }

  sendCommand(args: readonly string[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Redis test client already closed."));
    const chunks = [`*${args.length}\r\n`, ...args.flatMap((value) => [`$${Buffer.byteLength(value)}\r\n`, value, "\r\n"])];
    return new Promise<unknown>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(chunks.join(""), (error) => { if (error) this.socket.destroy(error); });
    });
  }

  close(): void {
    this.closed = true;
    this.socket.destroy();
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.splice(0)) pending.reject(error);
  }
}

/** Delete only keys within a unique test-run prefix; never flush the Redis database. */
export async function removeTestKeys(client: LiveRedisClient, prefix: string): Promise<void> {
  let cursor = "0";
  do {
    const response = await client.sendCommand(["SCAN", cursor, "MATCH", `${prefix}:*`, "COUNT", "100"]);
    if (!Array.isArray(response) || response.length !== 2 || !Array.isArray(response[1])) {
      throw new Error("Unexpected Redis SCAN reply in test cleanup.");
    }
    cursor = String(response[0]);
    for (const key of response[1]) {
      const name = String(key);
      if (!name.startsWith(`${prefix}:`)) throw new Error("Redis test cleanup escaped its isolated prefix.");
      await client.sendCommand(["DEL", name]);
    }
  } while (cursor !== "0");
}

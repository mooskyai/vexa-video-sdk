import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { JobTransportError } from "@vexa-video/core";
import type { RedisCommandClient } from "./redis-jobs.js";
import type { WorkspaceQuiescence } from "./storage.js";

// All transitions use Redis server time and one key. No key expiry: a seal must
// survive worker death and must never silently reopen admission after cleanup.
const TIME = `local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;
const ACQUIRE = TIME + `
if redis.call('HEXISTS', KEYS[1], 'seal') == 1 then return 0 end
redis.call('HSET', KEYS[1], 'owner:' .. ARGV[1], now + tonumber(ARGV[2]))
return 1`;
const RENEW = TIME + `
local field = 'owner:' .. ARGV[1]
local expiry = redis.call('HGET', KEYS[1], field)
if redis.call('HEXISTS', KEYS[1], 'seal') == 1 or not expiry or tonumber(expiry) <= now then return 0 end
redis.call('HSET', KEYS[1], field, now + tonumber(ARGV[2]))
return 1`;
const RELEASE = `return redis.call('HDEL', KEYS[1], 'owner:' .. ARGV[1])`;
const INSPECT = TIME + `
if redis.call('HEXISTS', KEYS[1], 'seal') == 1 then return 0 end
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields, 2 do
  if string.sub(fields[i], 1, 6) == 'owner:' and tonumber(fields[i+1]) > now then return 0 end
end
return 1`;
const SEAL = TIME + `
if redis.call('HEXISTS', KEYS[1], 'seal') == 1 then return 0 end
local fields = redis.call('HGETALL', KEYS[1])
for i = 1, #fields, 2 do
  if string.sub(fields[i], 1, 6) == 'owner:' then
    if tonumber(fields[i+1]) > now then return 0 end
    redis.call('HDEL', KEYS[1], fields[i])
  end
end
redis.call('HSET', KEYS[1], 'seal', ARGV[1])
return 1`;
const CHECK_SEAL = `return redis.call('HGET', KEYS[1], 'seal') == ARGV[1] and 1 or 0`;
const ABORT_SEAL = `if redis.call('HGET', KEYS[1], 'seal') ~= ARGV[1] then return 0 end
return redis.call('HDEL', KEYS[1], 'seal')`;

export interface RedisWorkspaceQuiescenceOptions {
  /** Deployment-unique namespace; identical on every process sharing a managed root. */
  prefix: string;
}

/**
 * Opt-in workspace admission and one-way reclamation seal. Producers AND consumers
 * must register and renew ownership; expires do not prove process termination.
 * Destructive callers must separately verify external producer/consumer quiescence.
 */
export class RedisWorkspaceQuiescence implements WorkspaceQuiescence {
  private readonly prefix: string;

  constructor(private readonly client: RedisCommandClient, options: RedisWorkspaceQuiescenceOptions) {
    const prefix = options.prefix?.trim();
    if (!prefix || !/^[a-zA-Z0-9:_-]+$/u.test(prefix) || prefix.length < 8) {
      throw new JobTransportError("Workspace quiescence requires a dedicated Redis namespace of at least eight safe characters.");
    }
    this.prefix = prefix.replace(/:+$/u, "");
    if (!this.prefix) throw new JobTransportError("Workspace namespace cannot contain only separators.");
  }

  /** Register before producing/reading any files. Refresh while active. */
  async acquire(path: string, leaseMs: number): Promise<string> {
    this.validateLease(leaseMs);
    const token = randomUUID();
    if (await this.eval(ACQUIRE, path, token, String(leaseMs)) !== 1) {
      throw new JobTransportError("Workspace is sealed for reclamation; admission denied.");
    }
    return token;
  }

  /** A lost/expired owner cannot renew, even if another worker replaces it. */
  async renew(path: string, token: string, leaseMs: number): Promise<boolean> {
    this.validateLease(leaseMs);
    this.validateToken(token);
    return await this.eval(RENEW, path, token, String(leaseMs)) === 1;
  }

  async release(path: string, token: string): Promise<void> {
    this.validateToken(token);
    await this.eval(RELEASE, path, token);
  }

  /** Read-only preview. Expired leases also require external confirmation. */
  async inspect(path: string): Promise<boolean> {
    return await this.eval(INSPECT, path) === 1;
  }

  /**
   * Atomically close new admission before invoking the caller's final safety
   * checks and filesystem deletion. A successful deletion leaves a persistent
   * tombstone. Errors retain the seal (partial deletion may have occurred).
   * Only a definite `false` before deletion permits reopening admission.
   */
  async withExclusiveReclaim(
    path: string, action: (assertCurrent: () => Promise<boolean>) => Promise<boolean>
  ): Promise<boolean> {
    const token = randomUUID();
    if (await this.eval(SEAL, path, token) !== 1) return false;
    // Do not enter destructive code unless the durable seal is still present.
    if (await this.eval(CHECK_SEAL, path, token) !== 1) {
      throw new JobTransportError("Workspace reclamation seal changed before deletion.");
    }
    const completed = await action(async () => await this.eval(CHECK_SEAL, path, token) === 1);
    if (completed === true) return true;
    if (completed !== false) {
      throw new JobTransportError("Workspace reclaim action returned an invalid result; seal retained.");
    }
    // Action is required to return false only BEFORE starting filesystem removal.
    if (await this.eval(ABORT_SEAL, path, token) !== 1) {
      throw new JobTransportError("Workspace reclamation seal could not be released.");
    }
    return false;
  }

  private validateToken(token: string): void {
    if (!/^[0-9a-f-]{36}$/iu.test(token)) throw new JobTransportError("Invalid workspace ownership token.");
  }

  private validateLease(leaseMs: number): void {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 86_400_000) {
      throw new JobTransportError("Workspace ownership leaseMs must be between 1 second and 24 hours.");
    }
  }

  private key(path: string): string {
    if (typeof path !== "string" || !path.trim()) throw new JobTransportError("Workspace path cannot be empty.");
    const name = createHash("sha256").update(resolve(path)).digest("hex");
    return `${this.prefix}:workspace:${name}`;
  }

  private async eval(script: string, path: string, ...args: string[]): Promise<number> {
    try {
      const response = await this.client.sendCommand(["EVAL", script, "1", this.key(path), ...args]);
      if (response !== 0 && response !== 1) throw new Error("Unexpected Redis workspace authority reply.");
      return response;
    } catch (error) {
      throw new JobTransportError("Redis workspace ownership check failed closed.", { cause: error });
    }
  }
}

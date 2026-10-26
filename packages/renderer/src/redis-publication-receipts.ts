import { createHash } from "node:crypto";
import type {
  HostedCompositionOutputReference,
  HostedCompositionRenderPayload
} from "@vexa-video/core";
import type { RedisCommandClient } from "@vexa-video/sdk";
import { fingerprintHostedCompositionPublication, type HostedCompositionPublicationReceipt } from "./publication-recovery.js";
import type { HostedCompositionPublicationContext } from "./index.js";

export interface RedisHostedPublicationReceiptOptions {
  /** Explicit tenant-scoped namespace. Never share this prefix between tenants. */
  readonly prefix: string;
  /** Verify the remote object still exists and has the expected identity before write or reuse. */
  readonly verifyArtifact: (
    receipt: HostedCompositionPublicationReceipt,
    output: HostedCompositionOutputReference,
    context: HostedCompositionPublicationContext
  ) => boolean | Promise<boolean>;
  /**
   * Optional authoritative remote inspection used ONLY by reconcileUnrecordedArtifact().
   * Return null only if the destination does not exist. An existing object must supply its
   * independently verified request fingerprint; never infer it from the caller's request.
   */
  readonly inspectArtifact?: (
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext
  ) => HostedCompositionPublicationReceipt | null | Promise<HostedCompositionPublicationReceipt | null>;
  /** Required for explicit receipt retirement: check current jobs, leases and external references. */
  readonly isReceiptUnreferenced?: (
    receipt: HostedCompositionPublicationReceipt,
    output: HostedCompositionOutputReference,
    context: HostedCompositionPublicationContext
  ) => boolean | Promise<boolean>;
}

export interface HostedReceiptRetirementOptions {
  /** Safe integer, at least 24 hours; required for each explicit retirement. */
  readonly minAgeMs: number;
  /** Defaults to true; only false may delete a Redis receipt. Never deletes remote objects. */
  readonly dryRun?: boolean;
}

export interface HostedReceiptRetirementResult {
  readonly status: "missing" | "untracked" | "too-new" | "present" | "referenced" | "eligible" | "removed" | "changed";
  readonly dryRun: boolean;
}

/** An explicitly provided artifact candidate; no Redis keyspace enumeration is performed. */
export interface HostedReceiptInspectionCandidate {
  readonly output: HostedCompositionOutputReference;
  readonly payload: HostedCompositionRenderPayload;
  readonly context: HostedCompositionPublicationContext;
}

export type HostedReceiptInspectionStatus =
  | "missing" | "untracked" | "too-new" | "present" | "referenced" | "eligible" | "changed" | "error";

export interface HostedReceiptInspectionEntry {
  readonly artifactId: string;
  readonly destination: string;
  readonly status: HostedReceiptInspectionStatus;
  /** Deliberately omit provider error details from operator output. */
  readonly errorCode?: "INSPECTION_FAILED";
}

export interface HostedReceiptInspectionReport {
  readonly inspected: number;
  readonly counts: Readonly<Record<HostedReceiptInspectionStatus, number>>;
  readonly entries: readonly HostedReceiptInspectionEntry[];
}

export interface HostedReceiptInspectionOptions {
  /** Minimum eligible age, one day or greater. The method never mutates Redis. */
  readonly minAgeMs: number;
  /** Optional synchronous telemetry callback; failures must not stop inspection. */
  readonly onDiagnostic?: (entry: HostedReceiptInspectionEntry) => void;
}

interface StoredPublicationReceipt extends HostedCompositionPublicationReceipt {
  readonly schemaVersion: 1;
  readonly destination: string;
  readonly artifactId: string;
}

// Compare-and-set prevents a concurrent attempt from replacing an existing receipt.
const RECORD_RECEIPT_SCRIPT = `
-- VEXA_PUBLICATION_RECEIPT_CAS
local previous = redis.call('GET', KEYS[1])
if previous then
  if previous == ARGV[1] then return 'unchanged' end
  return 'conflict'
end
redis.call('SET', KEYS[1], ARGV[1])
local stamp = redis.call('TIME')
redis.call('SET', KEYS[2], tostring(stamp[1] * 1000 + math.floor(stamp[2] / 1000)))
return 'created'
`;

// Compare raw value and age again inside Redis before deleting both keys.
// Old receipts without a timestamp cannot be removed by this operation.
const RETIRE_RECEIPT_SCRIPT = `
-- VEXA_PUBLICATION_RECEIPT_RETIRE
local stored = redis.call('GET', KEYS[1])
if not stored then return 'missing' end
if stored ~= ARGV[1] then return 'changed' end
local stamp = redis.call('GET', KEYS[2])
if not stamp or not string.match(stamp, '^%d+$') then return 'untracked' end
local now = redis.call('TIME')
local elapsed = now[1] * 1000 + math.floor(now[2] / 1000) - tonumber(stamp)
if elapsed < tonumber(ARGV[2]) then return 'too-new' end
if ARGV[3] == '1' then return 'eligible' end
redis.call('DEL', KEYS[1], KEYS[2])
return 'removed'
`;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function validateReceipt(
  receipt: HostedCompositionPublicationReceipt,
  output: HostedCompositionOutputReference,
  context: HostedCompositionPublicationContext,
  payload: HostedCompositionRenderPayload
): void {
  if (!output.destination || !output.artifactId || receipt?.fingerprint !== context.fingerprint
    || context.fingerprint !== fingerprintHostedCompositionPublication(payload)
    || !receipt.artifact || typeof receipt.artifact.url !== "string"
    || !receipt.artifact.url.trim()
    || (receipt.artifact.name !== undefined && typeof receipt.artifact.name !== "string")
    || (receipt.artifact.contentType !== undefined && typeof receipt.artifact.contentType !== "string")
    || (receipt.artifact.sizeBytes !== undefined &&
      (!Number.isSafeInteger(receipt.artifact.sizeBytes) || receipt.artifact.sizeBytes < 0))) {
    throw new Error("Hosted publication receipt has an invalid request or artifact identity.");
  }
}

/** Opt-in Redis-backed hooks for registerHostedCompositionRenderWorker. */
export class RedisHostedCompositionReceiptStore {
  constructor(
    private readonly client: Pick<RedisCommandClient, "sendCommand">,
    private readonly options: RedisHostedPublicationReceiptOptions
  ) {
    if (!client || typeof client.sendCommand !== "function") {
      throw new TypeError("Hosted receipt store requires a Redis command client.");
    }
    if (!options || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{3,127}$/u.test(options.prefix)
      || typeof options.verifyArtifact !== "function") {
      throw new TypeError("Hosted receipt store requires a tenant-scoped prefix and verifyArtifact().");
    }
  }

  private key(output: HostedCompositionOutputReference): string {
    if (typeof output.destination !== "string" || output.destination.trim() === "") {
      throw new TypeError("Redis publication receipts require a non-empty remote destination.");
    }
    // Index by destination rather than fingerprint: changed requests cannot overwrite the same URL.
    const hash = createHash("sha256").update(output.destination).digest("hex");
    return `${this.options.prefix}:publication:${hash}`;
  }

  private timestampKey(output: HostedCompositionOutputReference): string {
    return `${this.key(output)}:recordedAt`;
  }

  readonly lookupPublishedArtifact = async (
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext
  ): Promise<HostedCompositionPublicationReceipt | null> => {
    if (context.signal.aborted) throw new Error("Hosted publication lookup aborted.");
    const raw = await this.client.sendCommand(["GET", this.key(output)]);
    if (context.signal.aborted) throw new Error("Hosted publication lookup aborted.");
    if (raw === null) return null;
    if (typeof raw !== "string" && !Buffer.isBuffer(raw)) {
      throw new Error("Redis hosted publication receipt has an invalid response.");
    }
    let record: StoredPublicationReceipt;
    try {
      record = JSON.parse(String(raw)) as StoredPublicationReceipt;
    } catch {
      throw new Error("Redis hosted publication receipt contains invalid JSON.");
    }
    if (!record || record.schemaVersion !== 1 || record.destination !== output.destination
      || record.artifactId !== output.artifactId) {
      throw new Error("Redis hosted publication receipt conflicts with the requested destination.");
    }
    validateReceipt(record, output, context, payload);
    if ((await this.options.verifyArtifact(record, output, context)) !== true) {
      throw new Error("Redis hosted publication receipt refers to an unverified remote artifact.");
    }
    if (context.signal.aborted) throw new Error("Hosted publication lookup aborted.");
    return { fingerprint: record.fingerprint, artifact: record.artifact };
  };

  /**
   * Explicit crash-window repair: remote upload succeeded but no Redis receipt was saved.
   * Read existing Redis state first, then demand provider evidence of remote ownership.
   * Atomic receipt CAS rejects a conflicting concurrent repair; no remote object is modified.
   */
  readonly reconcileUnrecordedArtifact = async (
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext
  ): Promise<HostedCompositionPublicationReceipt | null> => {
    if (!this.options.inspectArtifact) {
      throw new Error("Hosted publication reconciliation requires an authoritative inspectArtifact provider.");
    }
    if (context.signal.aborted) throw new Error("Hosted publication reconciliation aborted.");
    const recorded = await this.lookupPublishedArtifact(output, payload, context);
    if (recorded) return recorded;
    if (context.signal.aborted) throw new Error("Hosted publication reconciliation aborted.");
    const remote = await this.options.inspectArtifact(output, payload, context);
    if (context.signal.aborted) throw new Error("Hosted publication reconciliation aborted.");
    if (remote === null) return null;
    validateReceipt(remote, output, context, payload);
    // Reconciliation may only adopt the exact remote destination, never an alias or sibling object.
    if (remote.artifact.url !== output.destination) {
      throw new Error("Hosted publication reconciliation found a different remote destination.");
    }
    await this.recordPublishedArtifact(remote, output, payload, context);
    // Fail closed if the remote vanished after the CAS or a concurrent writer changed ownership.
    return await this.lookupPublishedArtifact(output, payload, context);
  };

  /**
   * Explicit dry-run-first retirement of ONE Redis receipt whose remote artifact is gone.
   * Never deletes media or sweeps keys. Caller must coordinate with active producers and
   * provide an authoritative unreferenced check; neither callback is a global lock.
   */
  readonly retireMissingReceipt = async (
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext,
    options: HostedReceiptRetirementOptions
  ): Promise<HostedReceiptRetirementResult> => {
    if (!options || !Number.isSafeInteger(options.minAgeMs) || options.minAgeMs < 86_400_000
      || (options.dryRun !== undefined && typeof options.dryRun !== "boolean")) {
      throw new TypeError("Hosted receipt retirement requires minAgeMs >= one day and boolean dryRun.");
    }
    if (!this.options.inspectArtifact || !this.options.isReceiptUnreferenced) {
      throw new Error("Hosted receipt retirement requires inspectArtifact and isReceiptUnreferenced providers.");
    }
    const dryRun = options.dryRun ?? true;
    const checkCancellation = () => {
      if (context.signal.aborted) throw new Error("Hosted receipt retirement aborted.");
    };
    checkCancellation();
    const raw = await this.client.sendCommand(["GET", this.key(output)]);
    checkCancellation();
    if (raw === null) return { status: "missing", dryRun };
    if (typeof raw !== "string" && !Buffer.isBuffer(raw)) {
      throw new Error("Redis hosted publication receipt has an invalid response.");
    }
    let stored: StoredPublicationReceipt;
    try { stored = JSON.parse(String(raw)) as StoredPublicationReceipt; }
    catch { throw new Error("Redis hosted publication receipt contains invalid JSON."); }
    if (!stored || stored.schemaVersion !== 1 || stored.destination !== output.destination
      || stored.artifactId !== output.artifactId || stored.artifact?.url !== output.destination) {
      throw new Error("Redis hosted publication receipt conflicts with the requested destination.");
    }
    validateReceipt(stored, output, context, payload);
    const remote = await this.options.inspectArtifact(output, payload, context);
    checkCancellation();
    if (remote !== null) return { status: "present", dryRun };
    const safe = await this.options.isReceiptUnreferenced(stored, output, context);
    checkCancellation();
    if (safe !== true) return { status: "referenced", dryRun };
    const result = await this.client.sendCommand([
      "EVAL", RETIRE_RECEIPT_SCRIPT, "2", this.key(output), this.timestampKey(output),
      String(raw), String(options.minAgeMs), dryRun ? "1" : "0"
    ]);
    checkCancellation();
    if (!["missing", "changed", "untracked", "too-new", "eligible", "removed"].includes(String(result))) {
      throw new Error("Redis hosted receipt retirement returned an unexpected result.");
    }
    return { status: result as HostedReceiptRetirementResult["status"], dryRun };
  };

  /**
   * Bounded read-only operator diagnostics for explicitly supplied destinations.
   * Uses the existing dry-run Redis retirement checks. Does not discover keys,
   * mutate receipts, delete remote objects or implicitly authorize retirement.
   */
  readonly inspectKnownReceipts = async (
    candidates: readonly HostedReceiptInspectionCandidate[],
    options: HostedReceiptInspectionOptions
  ): Promise<HostedReceiptInspectionReport> => {
    if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 100) {
      throw new TypeError("Hosted receipt inspection requires 1 to 100 known candidates.");
    }
    if (!options || !Number.isSafeInteger(options.minAgeMs) || options.minAgeMs < 86_400_000
      || (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== "function")) {
      throw new TypeError("Hosted receipt inspection requires minAgeMs >= one day and an optional onDiagnostic function.");
    }
    if (!this.options.inspectArtifact || !this.options.isReceiptUnreferenced) {
      throw new Error("Hosted receipt inspection requires inspectArtifact and isReceiptUnreferenced providers.");
    }
    // Preflight the full batch to avoid partial diagnostics from malformed caller input.
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || !candidate.output || !candidate.payload || !candidate.context
        || !candidate.output.destination || candidate.output.destination !== candidate.payload.output.destination
        || candidate.output.artifactId !== candidate.payload.output.artifactId
        || candidate.context.fingerprint !== fingerprintHostedCompositionPublication(candidate.payload)) {
        throw new TypeError("Hosted receipt inspection requires matching request and destination identities.");
      }
      if (candidate.context.signal.aborted) throw new Error("Hosted receipt inspection aborted.");
      const key = this.key(candidate.output);
      if (seen.has(key)) throw new TypeError("Hosted receipt inspection cannot repeat a destination.");
      seen.add(key);
    }
    const counts: Record<HostedReceiptInspectionStatus, number> = {
      missing: 0, untracked: 0, "too-new": 0, present: 0,
      referenced: 0, eligible: 0, changed: 0, error: 0
    };
    const entries: HostedReceiptInspectionEntry[] = [];
    for (const candidate of candidates) {
      const { output, payload, context } = candidate;
      if (context.signal.aborted) throw new Error("Hosted receipt inspection aborted.");
      let entry: HostedReceiptInspectionEntry;
      try {
        const result = await this.retireMissingReceipt(output, payload, context, {
          minAgeMs: options.minAgeMs, dryRun: true
        });
        // A dry run never returns "removed"; reject unexpected protocol results.
        if (result.status === "removed") throw new Error("Unexpected destructive receipt inspection result.");
        entry = Object.freeze({ artifactId: output.artifactId, destination: output.destination!,
          status: result.status });
      } catch {
        if (context.signal.aborted) throw new Error("Hosted receipt inspection aborted.");
        entry = Object.freeze({ artifactId: output.artifactId, destination: output.destination!,
          status: "error", errorCode: "INSPECTION_FAILED" });
      }
      counts[entry.status] += 1;
      entries.push(entry);
      try { options.onDiagnostic?.(entry); } catch { /* Observer failures are isolated. */ }
    }
    return Object.freeze({ inspected: entries.length, counts: Object.freeze(counts),
      entries: Object.freeze(entries) });
  };

  readonly recordPublishedArtifact = async (
    receipt: HostedCompositionPublicationReceipt,
    output: HostedCompositionOutputReference,
    payload: HostedCompositionRenderPayload,
    context: HostedCompositionPublicationContext
  ): Promise<void> => {
    if (context.signal.aborted) throw new Error("Hosted publication recording aborted.");
    validateReceipt(receipt, output, context, payload);
    if ((await this.options.verifyArtifact(receipt, output, context)) !== true) {
      throw new Error("Cannot record an unverified remote publication.");
    }
    if (context.signal.aborted) throw new Error("Hosted publication recording aborted.");
    const record: StoredPublicationReceipt = {
      schemaVersion: 1,
      destination: output.destination!,
      artifactId: output.artifactId,
      fingerprint: receipt.fingerprint,
      artifact: receipt.artifact
    };
    const encoded = JSON.stringify(canonicalize(record));
    const result = await this.client.sendCommand([
      "EVAL", RECORD_RECEIPT_SCRIPT, "2", this.key(output), this.timestampKey(output), encoded
    ]);
    if (result !== "created" && result !== "unchanged") {
      if (result === "conflict") throw new Error("Redis hosted publication receipt conflicts with a previous publication.");
      throw new Error("Redis hosted publication receipt returned an unexpected result.");
    }
    if (context.signal.aborted) throw new Error("Hosted publication recording aborted.");
  };
}

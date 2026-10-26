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
return 'created'
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
      "EVAL", RECORD_RECEIPT_SCRIPT, "1", this.key(output), encoded
    ]);
    if (result !== "created" && result !== "unchanged") {
      if (result === "conflict") throw new Error("Redis hosted publication receipt conflicts with a previous publication.");
      throw new Error("Redis hosted publication receipt returned an unexpected result.");
    }
    if (context.signal.aborted) throw new Error("Hosted publication recording aborted.");
  };
}

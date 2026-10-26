import { createHash } from "node:crypto";
import type { HostedCompositionRenderPayload, HostedRenderArtifact } from "@vexa-video/core";

/** A provider-backed receipt for an artifact already durably published. */
export interface HostedCompositionPublicationReceipt {
  /** SHA-256 fingerprint supplied to the provider by the worker. */
  readonly fingerprint: string;
  readonly artifact: HostedRenderArtifact;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalJson(child)])
    );
  }
  return value;
}

/** Retry-stable request identity; includes bundle, composition, props, target and destination. */
export function fingerprintHostedCompositionPublication(payload: HostedCompositionRenderPayload): string {
  return createHash("sha256").update(JSON.stringify(canonicalJson(payload))).digest("hex");
}

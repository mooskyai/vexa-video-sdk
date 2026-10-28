/** Read-only, bounded operator review. Never authorizes or executes deletion. */
export type ArtifactLifecycleKind =
  | "job-snapshot"
  | "dead-letter"
  | "publication-receipt"
  | "workspace"
  | "remote-artifact";

export type ArtifactReferenceState = "referenced" | "unreferenced" | "unknown";
export type ArtifactRemoteState = "present" | "absent" | "unknown";
export type ArtifactLifecycleReason =
  | "protected-resource"
  | "provider-finalization-deferred"
  | "below-minimum-age"
  | "referenced"
  | "reference-unknown"
  | "authority-unverified"
  | "archive-not-exported"
  | "remote-absence-unverified"
  | "operator-review-required";

/**
 * An application-supplied snapshot; timestamps and evidence are NOT verified by this planner.
 * `timestampMs` is the workspace mtime, dead-letter index score, or receipt creation marker.
 */
export interface ArtifactLifecycleCandidate {
  readonly kind: ArtifactLifecycleKind;
  readonly tenantId: string;
  readonly id: string;
  readonly timestampMs: number;
  readonly references: ArtifactReferenceState;
  /** Application-verified, current absence of active ownership/consumers. */
  readonly authorityConfirmed: boolean;
  /** Dead-letter: operator verified a durable export/backup exists. */
  readonly archiveExported?: boolean;
  /** Receipt: independently inspected provider object state. */
  readonly remoteState?: ArtifactRemoteState;
}

export interface ArtifactLifecycleRetentionPolicy {
  /** Workspace must be at least 60 seconds old; one day or more is recommended. */
  readonly workspaceMinAgeMs: number;
  /** Dead-letter Redis archive index is retained at least one day. */
  readonly deadLetterMinAgeMs: number;
  /** Missing-receipt Redis age marker is retained at least one day. */
  readonly publicationReceiptMinAgeMs: number;
}

export interface ArtifactLifecycleReviewOptions {
  readonly tenantId: string;
  /** Fixed evaluation time makes results repeatable for an identical snapshot. */
  readonly nowMs: number;
  readonly policy: ArtifactLifecycleRetentionPolicy;
  /** One explicit tenant-scoped batch; no Redis scans or object-store listing. */
  readonly candidates: readonly ArtifactLifecycleCandidate[];
}

export interface ArtifactLifecycleReviewEntry {
  readonly kind: ArtifactLifecycleKind;
  readonly id: string;
  readonly status: "hold" | "review";
  readonly reason: ArtifactLifecycleReason;
}

export interface ArtifactLifecycleReview {
  readonly tenantId: string;
  readonly evaluatedAtMs: number;
  readonly entries: readonly ArtifactLifecycleReviewEntry[];
  readonly counts: Readonly<{ total: number; hold: number; review: number }>;
}

const kinds: readonly ArtifactLifecycleKind[] = [
  "job-snapshot", "dead-letter", "publication-receipt", "workspace", "remote-artifact"
];

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function minAge(value: number, floor: number, label: string): number {
  if (!validTimestamp(value) || value < floor) {
    throw new RangeError(`${label} must be a safe integer >= ${floor}.`);
  }
  return value;
}

/**
 * Classify at most 100 explicitly supplied records for human review. Always read-only.
 * `review` means a candidate can be assessed using its existing resource-specific API;
 * it is NEVER permission to delete. Evidence is caller-supplied and may be stale.
 */
export function planArtifactLifecycleReview(options: ArtifactLifecycleReviewOptions): ArtifactLifecycleReview {
  if (!options || typeof options !== "object") throw new TypeError("Lifecycle options are required.");
  const { tenantId, nowMs, policy, candidates } = options;
  if (typeof tenantId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(tenantId)) {
    throw new TypeError("Lifecycle tenantId must be a bounded explicit tenant identifier.");
  }
  if (!validTimestamp(nowMs)) throw new RangeError("Lifecycle nowMs must be a nonnegative safe integer.");
  if (!policy || typeof policy !== "object") throw new TypeError("Lifecycle retention policy is required.");
  const agePolicy = {
    workspace: minAge(policy.workspaceMinAgeMs, 60_000, "workspaceMinAgeMs"),
    "dead-letter": minAge(policy.deadLetterMinAgeMs, 86_400_000, "deadLetterMinAgeMs"),
    "publication-receipt": minAge(policy.publicationReceiptMinAgeMs, 86_400_000, "publicationReceiptMinAgeMs")
  };
  if (!Array.isArray(candidates) || candidates.length > 100) {
    throw new RangeError("Lifecycle candidates must be an explicit array of at most 100 entries.");
  }

  const validatedCandidates: readonly ArtifactLifecycleCandidate[] = candidates;
  const seen = new Set<string>();
  const entries: ArtifactLifecycleReviewEntry[] = [];
  for (const candidate of validatedCandidates) {
    if (!candidate || typeof candidate !== "object" || !kinds.includes(candidate.kind)
      || candidate.tenantId !== tenantId || typeof candidate.id !== "string"
      || !candidate.id.trim() || candidate.id.length > 512 || /[\u0000-\u001f\u007f]/u.test(candidate.id)
      || !validTimestamp(candidate.timestampMs) || candidate.timestampMs > nowMs
      || !["referenced", "unreferenced", "unknown"].includes(candidate.references)
      || typeof candidate.authorityConfirmed !== "boolean"
      || (candidate.archiveExported !== undefined && typeof candidate.archiveExported !== "boolean")
      || (candidate.remoteState !== undefined && !["present", "absent", "unknown"].includes(candidate.remoteState))) {
      throw new TypeError("Invalid lifecycle candidate or tenant/timestamp mismatch.");
    }
    const key = `${candidate.kind}\u0000${candidate.id}`;
    if (seen.has(key)) throw new TypeError("Duplicate lifecycle kind and resource identity.");
    seen.add(key);

    let reason: ArtifactLifecycleReason;
    if (candidate.kind === "job-snapshot") reason = "protected-resource";
    else if (candidate.kind === "remote-artifact") reason = "provider-finalization-deferred";
    else if (nowMs - candidate.timestampMs < agePolicy[candidate.kind]) reason = "below-minimum-age";
    else if (candidate.references === "referenced") reason = "referenced";
    else if (candidate.references !== "unreferenced") reason = "reference-unknown";
    else if (!candidate.authorityConfirmed) reason = "authority-unverified";
    else if (candidate.kind === "dead-letter" && candidate.archiveExported !== true) reason = "archive-not-exported";
    else if (candidate.kind === "publication-receipt" && candidate.remoteState !== "absent") reason = "remote-absence-unverified";
    else reason = "operator-review-required";
    entries.push(Object.freeze({
      kind: candidate.kind, id: candidate.id,
      status: reason === "operator-review-required" ? "review" : "hold", reason
    }));
  }
  entries.sort((left, right) => kinds.indexOf(left.kind) - kinds.indexOf(right.kind)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const hold = entries.filter((item) => item.status === "hold").length;
  return Object.freeze({
    tenantId, evaluatedAtMs: nowMs, entries: Object.freeze(entries),
    counts: Object.freeze({ total: entries.length, hold, review: entries.length - hold })
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  planArtifactLifecycleReview, type ArtifactLifecycleCandidate, type ArtifactLifecycleReviewOptions
} from "../src/artifact-lifecycle.js";

const DAY = 86_400_000;
const NOW = 10 * DAY;
const policy = {
  workspaceMinAgeMs: DAY,
  deadLetterMinAgeMs: 7 * DAY,
  publicationReceiptMinAgeMs: DAY
};

function item(kind: ArtifactLifecycleCandidate["kind"], overrides: Partial<ArtifactLifecycleCandidate> = {}): ArtifactLifecycleCandidate {
  return {
    kind, tenantId: "tenant-a", id: `case-${kind}`, timestampMs: 0,
    references: "unreferenced", authorityConfirmed: true, ...overrides
  };
}

function review(candidates: readonly ArtifactLifecycleCandidate[], overrides: Partial<ArtifactLifecycleReviewOptions> = {}) {
  return planArtifactLifecycleReview({ tenantId: "tenant-a", nowMs: NOW, policy, candidates, ...overrides });
}

test("V3.1r lifecycle matrix never proposes deleting job snapshots or remote artifacts", () => {
  const result = review([item("remote-artifact"), item("job-snapshot")]);
  assert.deepEqual(result.entries.map((x) => [x.kind, x.reason, x.status]), [
    ["job-snapshot", "protected-resource", "hold"],
    ["remote-artifact", "provider-finalization-deferred", "hold"]
  ]);
});

test("V3.1r lifecycle review requires evidence and export before manual dead-letter review", () => {
  assert.equal(review([item("dead-letter")]).entries[0]?.reason, "archive-not-exported");
  assert.deepEqual(review([item("dead-letter", { archiveExported: true })]).counts, {
    total: 1, hold: 0, review: 1
  });
});

test("V3.1r lifecycle receipt review requires independently confirmed remote absence", () => {
  assert.equal(review([item("publication-receipt", { remoteState: "unknown" })]).entries[0]?.reason,
    "remote-absence-unverified");
  assert.equal(review([item("publication-receipt", { remoteState: "present" })]).entries[0]?.status, "hold");
  assert.equal(review([item("publication-receipt", { remoteState: "absent" })]).entries[0]?.status, "review");
});

test("V3.1r lifecycle workspace review rejects uncertain or active ownership", () => {
  assert.equal(review([item("workspace", { references: "referenced" })]).entries[0]?.reason, "referenced");
  assert.equal(review([item("workspace", { references: "unknown" })]).entries[0]?.reason, "reference-unknown");
  assert.equal(review([item("workspace", { authorityConfirmed: false })]).entries[0]?.reason, "authority-unverified");
  assert.equal(review([item("workspace")]).entries[0]?.status, "review");
});

test("V3.1r lifecycle retention ages are explicit and never below resource minimum", () => {
  assert.equal(review([item("workspace", { timestampMs: NOW - DAY + 1 })]).entries[0]?.reason,
    "below-minimum-age");
  assert.throws(() => review([], { policy: { ...policy, workspaceMinAgeMs: 59_999 } }), RangeError);
  assert.throws(() => review([], { policy: { ...policy, deadLetterMinAgeMs: DAY - 1 } }), RangeError);
  assert.throws(() => review([], { policy: { ...policy, publicationReceiptMinAgeMs: DAY - 1 } }), RangeError);
});

test("V3.1r lifecycle validation rejects cross-tenant input, duplicates and oversized batches", () => {
  assert.throws(() => review([item("workspace", { tenantId: "tenant-b" })]), /tenant\/timestamp/);
  assert.throws(() => review([item("workspace"), item("workspace")]), /Duplicate/);
  assert.throws(() => review(Array.from({ length: 101 }, (_, i) => item("workspace", { id: `ws-${i}` }))), RangeError);
});

test("V3.1r lifecycle validation rejects stale snapshots encoded as future or invalid times", () => {
  assert.throws(() => review([item("workspace", { timestampMs: NOW + 1 })]), /tenant\/timestamp/);
  assert.throws(() => review([], { nowMs: Number.POSITIVE_INFINITY }), RangeError);
  assert.throws(() => review([item("workspace", { id: "x\nother" })]), TypeError);
  assert.throws(() => review([item("workspace", { authorityConfirmed: undefined as unknown as boolean })]), TypeError);
});

test("V3.1r lifecycle output is deterministic, immutable and does not mutate caller records", () => {
  const source = [item("workspace", { id: "z" }), item("workspace", { id: "a" })];
  const before = JSON.stringify(source);
  const first = review(source);
  const second = review([...source].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first.entries.map((x) => x.id), ["a", "z"]);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.entries));
  assert.ok(Object.isFrozen(first.counts));
  assert.equal(JSON.stringify(source), before);
});

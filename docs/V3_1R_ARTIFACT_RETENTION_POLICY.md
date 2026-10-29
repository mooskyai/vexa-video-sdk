# V3.1r — Artifact lifecycle and retention review policy

**V3.1t clarification:** opt-in Redis quiescence seals do not remove the need for a named retention owner, legal-hold/backup authorization and fresh host reference checks before workspace deletion. This retention planner remains read-only. See [V3.1t contract](./V3_1T_DISTRIBUTED_WORKSPACE_OWNERSHIP.md).

Status: **unreleased, review-only implementation; NOT production cloud finalization**. Source baseline: `83b54959bfcf9ce8120c6c55c75207492f272ecc` on `feature/v3-worker-lease-heartbeat`. The V3.1q Linux hardening workflow succeeded for this commit ([run 40653898073](https://github.com/mooskyai/vexa-video-sdk/actions/runs/40653898073)); that result does not certify V3.1r until the new commit has its own green run.

## Resource ownership and retention matrix

| Resource | Authority/age evidence | V3.1 permitted operator action | Policy and production boundary |
| --- | --- | --- | --- |
| Durable Redis job snapshots, retry and idempotency state | Job and queue records with live claims/references | **Hold; never plan deletion** | No job snapshot TTL, sweeper or automatic purge in V3.1. Retain while references/retries exist; future deletion contract requires dedicated design and tests. |
| Redis dead-letter envelope and index | Failure-time sorted-index score, successful backup/export, known nonreferenced state | `RedisJobTransport.pruneDeadLetters` on a bounded batch | Minimum API age **one day**, dry-run default. Plan uses explicit chosen policy (example seven days) and requires `archiveExported: true`; operator must still run the existing dry-run and coordinate retention before opting into deletion. Job snapshots unaffected. |
| Publication receipt and age marker | Redis receipt marker, provider-authoritative missing-object inspection, job/consumer reference check | `RedisHostedCompositionReceiptStore.retireMissingReceipt` on **one exact destination** | Minimum API age **one day**, dry-run default; no deleting live receipts, untracked legacy receipts, or remote media. Exact provider absence, job/reference guard and CAS required at execution time. |
| Managed workspace directory | Filesystem mtime, current authoritative job/lease/consumer proof | `MediaWorkspace.reclaimAbandoned` with `confirmAbandoned(path)` | Minimum library age **60 seconds** (a *safety floor, not a production target*); recommend **one day or more** and a unique service-specific prefix. Dry-run default, bounded, host-provided guard, and deliberate producer quiescence before deletion. |
| External object store media and multipart remnants | Provider object metadata, versioning/IAM/tenant references and retention contract | **Hold; no V3.1 media delete API** | Production finalization is deferred to V3.9 cloud adapters/V3.13 hosted platform. Do not treat Redis receipt absence as permission to delete remote media. |

No default retention timer or background scheduler is installed. Deployments own explicit age policies, backups, reference state, tenant isolation, operator approval, observability and any legal hold.

## Read-only planner

`planArtifactLifecycleReview()` is exported from `@vexa-video/sdk` on the V3 development branch. It receives one explicit tenant-scoped candidate list (at most **100**), a fixed observation timestamp, and policy-specific ages. It performs **no Redis access, filesystem scanning, object-store request or mutation**. There is deliberately no `execute`, `delete`, or `commit` function.

```ts
import { planArtifactLifecycleReview } from "@vexa-video/sdk";

const DAY = 86_400_000;
const report = planArtifactLifecycleReview({
  tenantId: "tenant-a",
  nowMs: Date.now(),
  policy: {
    workspaceMinAgeMs: DAY,
    deadLetterMinAgeMs: 7 * DAY,
    publicationReceiptMinAgeMs: DAY
  },
  candidates: [{
    kind: "workspace", tenantId: "tenant-a", id: "/managed/vexa-media-serviceA-xyz",
    timestampMs: oldWorkspaceDirectoryMtime,
    references: "unreferenced",
    authorityConfirmed: true // independently verify CURRENT lease and consumer ownership
  }]
});
// report.entries[].status is 'hold' or 'review', never permission to delete.
```

- `hold` means the record is protected, young, still referenced, missing authoritative proof, or not in the implemented cleanup scope.
- `review` means the supplied snapshot meets conservative *pre-screening* requirements; an operator must **recheck all live authority**, review backup and compliance holds, and call the exact resource-specific dry-run API again. It is **not** a deletion token.
- The planner requires an explicit single tenant, rejects cross-tenant entries and duplicate resource identities, validates timestamps and retention floors, and reports immutable, deterministic output.
- For dead letters, operator-verified archive export is required before `review`. For publication receipts, independently authoritative remote `absent` is required. For workspaces, the host must supply current `authorityConfirmed: true`. Evidence supplied by the caller is not cryptographically attested or revalidated by the planner.
- **Never** automatically call a destructive API based only on this report. Evidence can become stale between review and execution; coordinate running workers and use the real method's CAS/guard behavior.

## Manual acceptance and gates

Run `npm run verify` (expected **476** regular tests: 468 existing + 8 lifecycle review tests), plus the separately opt-in suites `npm run test:workspace-crash` (4), `npm run test:redis` (12), and `npm run test:object-storage` (7) in their isolated environments. V3.1r does not change existing live acceptance semantics. All V3 hardening workflow steps must pass against the **new V3.1r SHA** before marking this slice CI-accepted.

The V3.1 production decision remains **NO-GO** for broad hosted deployment. Remaining requirements include real provider conditional-write/versioning tests, interrupting multipart uploads, network partitions, backup/restore, deployed tenant/IAM checks, distributed producer quiescence and cross-platform release qualification. This policy does not silently defer or waive those gates.

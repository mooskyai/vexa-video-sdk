# V3.1s — Production acceptance and release-gate review

**V3.1t follow-up (unreleased):** opt-in Redis workspace admission and reclamation seals address a narrow part of the distributed ownership gap, but are not a deployment-wide producer/consumer/FFmpeg crash proof. `workspace_producer_quiescence` remains BLOCKED in the unchanged evidence register; all other blockers and overall NO-GO remain unchanged. See [V3.1t](./V3_1T_DISTRIBUTED_WORKSPACE_OWNERSHIP.md).

**Decision: NO-GO for general V3.1 production deployment or npm V3 release.** This is a *review milestone*, not a deployment-specific provider adapter, an automatic artifact finalizer, or an authorization to publish. Stable packages remain `2.0.0`. V3.2 remains a separate capability-aware scheduling milestone.

## Audited baseline and evidence

- Feature branch: `feature/v3-worker-lease-heartbeat`, audited source commit `b8bdb867aca70259adf12740003bfc68208e17aa` (V3.1r).
- GitHub Actions: [V3 hardening live acceptance run 40668676497](https://github.com/mooskyai/vexa-video-sdk/actions/runs/40668676497), `completed/success` on that exact SHA, October 28, 2026. The Ubuntu 24.04 / Node 24.21.0 job completed repository `verify`, FFmpeg setup, workspace crash acceptance, isolated Redis 7 and S3-compatible SILO crash tests, and cleanup. This is **not** evidence about unrun later commits.
- User-run Windows V3.1r verification: 476 regular tests, TypeScript check/build and 4 separate FFmpeg workspace crash tests passed. Live Redis (12) and S3-compatible (7) suites are separately represented by the Linux CI job, not claimed as locally rerun on V3.1r.
- Existing V3.1r [lifecycle review matrix](./V3_1R_ARTIFACT_RETENTION_POLICY.md) makes no provider deletion or snapshot purge claims. The implementation only plans bounded tenant-scoped records; it cannot establish current authority or execute retention.
- V3.1s has its **own** commit and acceptance requirement. A green V3.1r run cannot be relabeled a V3.1s CI result. `docs/V3_1S_RELEASE_EVIDENCE.json` keeps the historical run and explicitly blocks `current_commit_ci` until separately reviewed.

## Production gate decision register

| Gate | Current status | Required acceptance to change status |
| --- | --- | --- |
| Audited V3.1r isolated hardening CI | **PASS** | Exact GitHub run and SHA verified above; only the targeted test scope passed. |
| CI on final candidate SHA | **BLOCKED** | Re-run exact-commit CI; require the expected unit, workspace, real Redis/S3 fixture and FFmpeg steps, plus follow-up release matrix. |
| Distributed workspace producer/consumer quiescence | **BLOCKED** | Demonstrate live lease/reference coordination, worker shutdown, concurrent producer race and process-tree cancellation on the deployed topology. |
| Retention policy and operator approval | **BLOCKED** | Named operator, tenant-scoped asset policy, export/backup checkpoints, legal holds, deletion limits, review/canary/rollback runbook. |
| Production provider conditional writes and verification | **BLOCKED** | Deploy the target AWS/GCS/Azure adapter and verify real conditional write, fingerprint/metadata, versioning and integrity guarantees. SILO is not enough. |
| Provider network interruption/multipart cleanup | **BLOCKED** | Test partitions, timeout/retry after acknowledged object PUT, partial and multipart uploads, provider-side cleanup and restart on target provider. |
| Tenant and IAM isolation | **BLOCKED** | Deployed credentials and namespace boundaries, cross-tenant denial tests, secrets scope and key rotation review. |
| Backup/restore and legal hold | **BLOCKED** | Run recoverable backup/restore drills for job, dead-letter, receipt and media evidence; verify retention holds before any destructive operator command. |
| Cross-platform release artifacts | **BLOCKED** | Same candidate SHA passes Windows/macOS/Ubuntu tests and real packed-install/consumer validation (plus browsers if affected). Existing V2 matrix does not qualify V3. |
| Upgrade/rollback and mixed-worker compatibility | **BLOCKED** | Document and test stop-old-workers migration, snapshot/receipt compatibility, rollback, stale-claim fencing and safe restart with actual production topology. |

No broad automatic delete/sweep, global distributed lock, production provider certification, or general V3 hosted feature was introduced by V3.1s. A production deployment may establish its own *narrower* guarded acceptance matrix only through separately reviewed scope and explicit human authorization; this document does not grant such a waiver.

## Machine-readable evidence inventory

The read-only `scripts/v3-release-gate.mjs` checks a bounded, exact list of gate IDs from [V3.1s evidence JSON](./V3_1S_RELEASE_EVIDENCE.json), rejects duplicates, unsupported states, unaudited/mismatched CI baseline and missing evidence references. It does **not** call GitHub, verify provider state or execute changes, and it never returns a publish authorization. Because evidence URLs and manual findings are supplied by operators, their contents and signatures require independent human verification.

```powershell
npm run test:v3-release-gate
node scripts/v3-release-gate.mjs --json

# Supply the actual commit SHA for a new review candidate, once committed:
node scripts/v3-release-gate.mjs --candidate-sha $(git rev-parse HEAD) --json

# STRICT mode is intentionally expected to exit 2 while the register is NO-GO:
node scripts/v3-release-gate.mjs --candidate-sha $(git rev-parse HEAD) --require-ready
```

Normal reporting exits 0 on a **valid inventory even if status is NO_GO** so feature CI can test the checker without suggesting approval. Invalid or malformed evidence exits 1. `--require-ready` exits 2 when any gate is blocked/deferred or the candidate CI SHA does not match. An all-passed inventory with matching candidate CI is reported only as `READY_FOR_HUMAN_REVIEW`; `releaseAuthorized` remains false, and publishing remains a distinct protected, approved process. Deferrals with named owner and destination milestone are recorded but **do not** satisfy the strict gate.

### Independent sign-off sequence

1. Verify the exact proposed V3 release SHA, change set, artifact provenance, and which externally deployed provider is actually in scope.
2. Independently follow each evidence link and confirm commit SHA, dates, test results, provider isolation, ownership, legal and migration records; do not trust JSON status text alone.
3. Update each reviewed gate with evidence URL and completed owner sign-off or document an accountable deferral. A deferral stays blocked for the strict release gate unless reviewed release policy is changed explicitly.
4. Run the full candidate-specific cross-platform/release package/browser matrix, then update the candidate CI gate only after a real green exact-SHA run.
5. Ask designated release owners for explicit human approval and publish only using existing protected versioning, trusted publication and rollback procedures. Never use this reporting script as an alternate publish mechanism.

## Recommended follow-on implementation

V3.1t (or a dedicated deployment-specific workstream) should prioritize the most consequential remaining *code/evidence* gaps: a real deployment-owned quiescence/fencing protocol, provider-targeted fault tests, and recovery/retention operator tooling that does not trust old planning snapshots. Do not conflate this with V3.2 capability-aware scheduling. This review records **NO-GO**, not a promise that the remaining work can be waived.

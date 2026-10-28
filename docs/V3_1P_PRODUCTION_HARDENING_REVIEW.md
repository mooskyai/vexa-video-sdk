# V3.1p — Production-hardening acceptance review

Status: **REVIEWED; NOT APPROVED FOR PRODUCTION RELEASE**. This review adds an opt-in CI fault-injection gate and records evidence. It makes no change to the released 2.0.0 package or the runtime worker/receipt protocols.

## Audited source and evidence

- GitHub source baseline: `d89fcda38a6451fff2d0edeca6f52e750c65c29d` on `feature/v3-worker-lease-heartbeat` (V3.1o).
- User-run Windows checkout: `npm run verify` completed 466 tests, typecheck and build; `npm run test:redis` completed 12 tests; `npm run test:object-storage` completed 7 tests; all without failures. These are terminal records from the same implementation sequence, not independent hosted CI evidence.
- Code and suite references: `packages/sdk/src/jobs.ts`, `packages/sdk/src/redis-jobs.ts`, `packages/renderer/src/redis-publication-receipts.ts`, `packages/sdk/test/redis-live.acceptance.ts`, `packages/renderer/test/redis-publication-live.acceptance.ts`, `packages/renderer/test/object-storage-live.acceptance.mjs`, and `docs/V3_1O_OBJECT_STORAGE_ACCEPTANCE.md`.
- Existing `.github/workflows/release-acceptance.yml` runs the cross-platform typecheck/build/test/packed-install and Studio browser matrix, but does **not** execute the opt-in Redis or S3 suites. `.github/workflows/ci.yml` is triggered on `main` pushes and pull requests; pushing to this feature branch by itself does not demonstrate those workflows passed.
- V3.1p adds `.github/workflows/v3-hardening-acceptance.yml` for dedicated Linux/Node 24 regular + Redis + S3-compatible acceptance on the V3 feature branch, pull requests to main, or manual dispatch. **A defined workflow is not evidence of a completed workflow run.** Record its green URL and commit SHA before sign-off. This job is not automatically a required branch-protection check.

## Acceptance matrix

| Scope | Assessment at baseline | Evidence, limitations, next action |
| --- | --- | --- |
| Lease ownership, fencing and worker-death recovery | Evidence passed | Unit suite and real Redis child-worker kill/recovery cases; ensure protected CI also passes. |
| Atomic cancellation and due-retry reconciliation | Evidence passed | Real Redis races and transport assertions; **does not** imply every external handler side effect executes exactly once. |
| Durable terminal dead letters | Evidence passed | Unit cases cover terminal failures/retention; back up archived failures operationally before pruning. |
| Hosted receipt CAS, verified reuse, single-destination reconciliation | Evidence passed in tested boundaries | Redis CAS, file-backed fixture, then real SILO object metadata and conditional uploads. Provider conditional-write support is mandatory. |
| External crash-window recovery | Evidence passed for isolated S3-compatible fixture | Seven SILO + Redis cases including exit before PUT, exit after PUT, exit after receipt, conflicts, missing metadata, deleted object and permission denial. Not production AWS/GCS/Azure certification. |
| Worker metric/span callbacks | Evidence passed | Opt-in exporter-neutral, payload-free callback contract; durability, sampling and backpressure belong to the consuming app. |
| Structured operational context | Partial | Existing typed diagnostics and job/claim spans exist; a complete application logging/export pipeline is not bundled. |
| Workspace lifecycle after process death | **OPEN — V3.1 sign-off gate** | Dry-run-first `MediaWorkspace.reclaimAbandoned` is tested, but comprehensive cleanup of crashed live renderer workspaces and cancellation/restart scenarios has not been evidenced as an end-to-end matrix. |
| Artifact-retention and finalization policy | **OPEN — scope/ownership decision** | Aged dead-letter and missing-receipt cleanup are deliberately narrow. No general external media deletion/sweeping, cross-provider lifecycle or autonomous finalizer exists. Decide what contract belongs to V3.1 versus V3.9/V3.13; document production operator ownership. |
| Isolated live tests in CI | **OPEN until V3.1p workflow is green** | CI configuration added; run and inspect the job, logs, exit results and SHA. Enforce as required status if V3.1 release policy demands it. |
| Production cloud, network interruption and restore | **OPEN before actual hosted deployment** | SILO does not prove AWS S3, GCS, Azure Blob, multipart interruption, partition, object versioning, IAM scope, backup/restore, or tenant isolation in a deployed adapter. |
| Cross-platform/release artifacts | **NOT REVERIFIED FOR THIS FEATURE BRANCH** | The existing protected matrix covers Windows/Ubuntu/macOS and browser tests, but the supplied evidence was Windows local. Require branch/PR-specific CI results and packed-install/release validation before publishing. |

## Go/no-go decision

**NO-GO for claiming the whole V3.1 stage production-complete or publishing a V3 release.** V3.1a–V3.1o slices are implemented and their local tests have passed, but the explicitly documented V3.1 workspace cleanup acceptance still lacks a full end-to-end crash/cancellation/restart proof. The new V3.1p hosted CI must pass, and the artifact lifecycle scope/ownership and actual deployment provider guarantees must be addressed or explicitly gated to their later stages.

This decision does **not** invalidate V3.1o or prohibit starting separate V3.2 design work. Do not silently reinterpret operator-only, opt-in cleanup as automatic production finalization; do not equate Redis receipt CAS with a distributed transaction; do not mark cloud-provider qualification as passed because the SILO acceptance is green.

## Next implementation and review sequence

1. **Verify V3.1p CI**: run the added workflow against the committed patch; record the commit, run URL, job results, and image versions. Keep Linux real-service tests separate from `npm run verify` so developers can run the regular suite without Docker.
2. **V3.1q candidate — deterministic workspace crash lifecycle**: build an opt-in real child-renderer process kill/cancel/restart fixture using actual managed-workspace files; assert no active worker workspace is reclaimed, and deterministic dry-run/explicit cleanup of verifiably abandoned workspaces. Keep destructive cleanup operator-controlled. Update workspaces/architecture/tests/docs in the same patch.
3. **Clarify retention policy**: enumerate retained resource classes (job snapshots, dead-letter envelopes, receipt markers, workspace directories, external objects), default retention, authority, backup/export and deletion limits. Delegate true cloud artifact finalization to the explicit provider milestone if not within V3.1.
4. **Production adapter qualification**: test exact provider conditional PUT/object metadata/versioning, IAM isolation, network interruption, partial/multipart upload cleanup and backup/restore before launching a hosted deployment. This is a deployment gate, not a claim that V3.1o already covers it.
5. **Final review**: collect full CI evidence, operator runbook, compatibility/migration notes, then update this decision and ROADMAP only when each declared gate has a named pass or accepted deferral.

## Commands and safety

```powershell
# Confirm the baseline or the new V3.1p commit; never apply to an unknown HEAD.
git status -sb
git rev-parse HEAD

# Regular test gate (does not start Redis/S3 containers).
npm run verify

# Optional live gates require the isolated Docker setup and test-only environment.
# See docs/V3_1O_OBJECT_STORAGE_ACCEPTANCE.md.
npm run test:redis
npm run test:object-storage
```

The V3.1p GitHub workflow is separate from the published Version 2 release workflow; adding it does not change package versions or release permissions. Tests must use isolated loopback endpoints, disposable unique resource namespaces, and no production secrets.

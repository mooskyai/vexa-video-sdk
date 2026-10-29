# V3.1t — Distributed workspace admission and quiescence (unreleased)

**Scope:** Opt-in, deployment-coordinated Redis workspace ownership. **Production status remains NO-GO.** V3.2 capability-aware scheduling is out of scope. This design does not automatically integrate the Vexa worker loop with managed workspaces, does not certify a production process tree, and does not add remote deletion or a global sweeper.

## Contract

`RedisWorkspaceQuiescence` uses the existing `RedisCommandClient` interface (no new Redis dependency). A dedicated prefix and a SHA-256 key of the canonical absolute workspace path identify each directory; the entire deployment **must share the same Redis namespace and canonical path identity**. Different mount paths across containers are **not supported by this adapter** without an additional shared path-identity layer (not provided here). Do not instantiate independent per-worker namespaces or try to reclaim across mismatched paths.

- **Admission:** every producer and consumer must call `acquire(path, leaseMs)` *before touching the workspace*, renew on time while active and call `release(path, token)` when finished. Both kinds of access use the same owner registration; application-level external references must also be checked. A renewal returning false or a Redis error means the owner must stop producing/consuming and terminate child processes; a stale token must never be reused. Set the lease interval longer than expected service pauses, and terminate work if heartbeat renewal fails.
- **Dry-run:** `MediaWorkspace.reclaimAbandoned({ ... , quiescence, confirmAbandoned })` checks the Redis admission records but changes no Redis ownership/seal state. Expired leases are only *candidates*, not proof of process exit. The host callback must independently verify current job claim, retry, replacement-worker, process-tree and external-consumer state for that exact path.
- **Deletion:** a destructive call requires the host callback **and** a coordinator. The initial callback and read-only inspection happen before the candidate is reported. A Redis Lua transition atomically refuses active owners and creates a *persistent seal* preventing new admission. Inside that seal, the filesystem, authoritative host callback, and current Redis seal token are checked again immediately before `rm`. Another concurrent cleanup operation cannot acquire the same seal.
- **Failure:** no Redis response, an unexpected reply, an external authority failure or a changed seal prevents deletion. If the external callback returns false before deletion, the seal is atomically released and new admission is allowed. If deletion begins and fails, or an exception occurs after the seal, the seal is retained; this requires explicit operator reconciliation rather than silently allowing worker reuse of a possibly half-deleted directory. A successful deletion also retains the tombstone, so the same path must not be reused.

This is **not** a complete global quiescence solution on its own: uninstrumented workers can still race, lease expiry does not kill processes, and lost Redis persistence may lose seals. Configure persistence, backups, strict ACLs and durable operator procedures; don't use this for production unless every participant is enrolled and process termination and external reference checks are independently proven. Treat Redis namespace deletion/FLUSHDB as an unsafe recovery action. The legacy `reclaimAbandoned` call without `quiescence` remains available for compatibility, but still carries the original age/TOCTOU risks and must not be used on concurrently active hosts.

## Minimal deployment example (not an approved production runbook)

```ts
import { MediaWorkspace, RedisWorkspaceQuiescence } from "@vexa-video/sdk";

const ownership = new RedisWorkspaceQuiescence(redisClient, {
  prefix: "vexa:production:tenant-a:service-a" // same on every cooperating process
});
const workspace = await MediaWorkspace.create({ root: managedRoot });
const token = await ownership.acquire(workspace.path, 30_000);
try {
  // Start heartbeat renewal before and throughout all producer/consumer activity.
  // Terminate all FFmpeg children and stop using the workspace if renewal fails.
  await runRenderWithRenewalAndLeaseLossCancellation(workspace, token, ownership);
} finally {
  await ownership.release(workspace.path, token); // report Redis failures; don't hide them
}

// Separate, explicitly approved, bounded operator action after workers are drained:
const preview = await MediaWorkspace.reclaimAbandoned({
  root: managedRoot, prefix: "vexa-media-", minAgeMs: 86_400_000,
  quiescence: ownership,
  confirmAbandoned: async path => await independentlyVerifyNoProducerOrConsumer(path)
});
// Review preview. Only then, after human approval and durable backup/hold review,
// repeat with dryRun: false and a fresh confirmAbandoned check.
```

The helper names in the example are application-supplied; the SDK does **not** include an automatic heartbeat or process supervisor. Callers must make renewal, loss-of-lease cancellation, and external reference checks real before enabling destructive actions.

## Validation and release boundary

- `npm run verify` includes isolated storage-boundary tests for dry run, changed authority, failure and successful exclusive deletion.
- `npm run test:workspace-quiescence-redis` runs seven opt-in real Redis 7 cases: live producer/consumer exclusion; expired token and replacement fencing; atomic admission seal; false authority before deletion; Redis outage before and during deletion; and an FFmpeg-produced artifact preserved after an enrolled child-worker crash. Requires `VEXA_TEST_REDIS_URL=redis://127.0.0.1:6389` and uses unique temporary filesystem and Redis namespaces, no FLUSHDB.
- `npm run test:workspace-crash` remains the independent FFmpeg process-kill/restart/cancellation test. The isolated crash fixture enrolls and renews a Redis owner while producing a real FFmpeg artifact, then proves reclamation only after that process dies and the lease expires. It does **not** prove cross-host process-tree termination, worker claim/retry integration, network partitions, or production-wide consumer enrollment; that release gate remains blocked.
- The V3.1s release evidence inventory is unchanged. In particular `workspace_producer_quiescence` stays **BLOCKED** until a deployed producer/consumer/process-tree integration and exact-SHA CI prove the full contract. The read-only release checker is not changed into a publisher.

Validate `npm run verify`, `npm run test:workspace-quiescence-redis`, `npm run test:workspace-crash`, `npm run test:v3-release-gate`, and existing opt-in Redis/object-storage tests on the exact V3.1t commit. Record CI success on that SHA, not on the previous V3.1s baseline.

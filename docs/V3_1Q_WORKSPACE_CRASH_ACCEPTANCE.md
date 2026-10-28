# V3.1q — Managed workspace process-crash acceptance

Status: **IMPLEMENTED IN FEATURE BRANCH WHEN PATCHED; ACCEPTANCE PENDING EXECUTION**. This is a dedicated optional fault-injection suite, not a claim that mtime alone proves workspace abandonment. It does not change the released Vexa Video SDK 2.0.0 contract or automatically delete cloud objects.

## Scope and safety

V3.1q extends `MediaWorkspace.reclaimAbandoned()` with an optional `confirmAbandoned(path)` callback. The caller must consult authoritative current job/lease/reference ownership when using it; return `true` only after verifying the workspace has no active producer or consumer. Returning `false` skips the directory; a thrown error aborts reclamation without treating the error as permission to delete. The same callback is checked again immediately before destructive removal. This is **not** a lock: deployment owners must stop/coordinate conflicting producers and handle races or ownership changes between checks. Existing calls without the optional callback retain their prior age-based behavior for backward compatibility and remain operator-risky.

The opt-in suite starts independent Node worker processes, uses the actual `MediaWorkspace` class, and produces real short MP4 files via FFmpeg. The parent exercises an abrupt process kill, restart with an actively held workspace, normal cancellation cleanup, and fail-closed ownership-check behavior. The suite verifies the workspace and artifact on disk, not just an in-memory mock. It does **not** render a full composition, test a remote cloud directory, prove producer quiescence globally, or safely reclaim workspaces while unknown workers are still modifying them.

## Local acceptance

From the repository root with Node.js >=24.21.0, FFmpeg and ffprobe installed:

```powershell
npm run verify
if ($LASTEXITCODE -ne 0) { throw "Regular verification failed" }

npm run test:workspace-crash
if ($LASTEXITCODE -ne 0) { throw "Workspace crash acceptance failed" }
```

Expected after V3.1q: **468 regular unit tests** (two new ownership-guard tests), **4 opt-in workspace child-process tests**; existing `npm run test:redis` and `npm run test:object-storage` remain **12** and **7** respectively. Workspace acceptance does not need Docker; CI runs it on Ubuntu/Node 24 after installing FFmpeg.

The fixture creates a unique root in the OS temporary directory and a random `vexa-workspace-...-` prefix per run. It never invokes `rm` on a configured production root, never deletes an object-store object, and removes its isolated test root after the suite. The operator API remains dry-run by default; only `{ dryRun: false }` removes eligible directories.

## Operator policy

Before running destructive reclamation, stop or coordinate active workers, choose an isolated managed-workspace root and sufficiently specific prefix, and query durable job/lease/consumer records for **each exact candidate**. Example (illustrative only):

```ts
await MediaWorkspace.reclaimAbandoned({
  root: managedWorkspaceRoot,
  prefix: "vexa-media-serviceA-",
  minAgeMs: 24 * 60 * 60 * 1000,
  confirmAbandoned: async (path) => authoritativeLeaseAndReferenceCheck(path),
}); // dry run
```

Do not set `dryRun: false` without reviewing the returned paths and coordinating publishers. Age, filesystem mtimes, PID files and a single Redis lookup are not sufficient proof of abandonment by themselves. A missing reference due to store outage is an error, **not** an affirmative authorization. The guard must account for retries, replacement workers, linked consumers, and any other host-specific owners. The 60-second library minimum is a validation floor, not a recommended production retention policy.

## Remaining release blockers

The four tests validate the targeted workspace lifecycle and guard behavior, but not a production distributed quiescence protocol, a full render killed during FFmpeg execution, restart with real queue ownership, cross-platform process-tree termination, or cloud artifact deletion/finalization. V3.1p CI and the appropriate release matrix must be green on this commit before sign-off; V3.1 remains **NO-GO** for general hosted deployment until explicit owner/retention policies and provider-specific acceptance are addressed or formally deferred.

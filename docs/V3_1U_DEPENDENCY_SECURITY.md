# V3.1u — Dependency security remediation candidate (unreleased)

**Status: both npm audits and the documented local acceptance suites passed in the November 3, 2026 Windows recovery worktree; exact-candidate CI and V3.1 production sign-off remain OPEN.** The stable published SDK remains `2.0.0`; the V3.1 production decision is **NO_GO**. V3.2 scheduling is separate.

## Historical baseline (not an allowance)

The V3.1t checkout at `7711681fb3e2b1ca504ca01308aed5011efc07d6` recorded the following Windows audit results on October 29, 2026:

| Scope | Critical | High | Moderate | Total |
| --- | ---: | ---: | ---: | ---: |
| `npm audit --omit=dev` | 0 | 3 | 5 | 8 |
| `npm audit` | 2 | 7 | 5 | 14 |

The November 2 preflight also saw a changed full-tree advisory report (29 findings) against the then-unchanged dependency lockfile. Advisory metadata may change independent of code changes. These historical counts are retained only for diagnosis; **neither scope can now pass with any reported vulnerability**.

## Remediation and verified evidence

- Update the root development dependencies `@angular/build` and `@angular/cli` from `21.2.24` to `21.2.29`. Angular framework packages remain `21.2.24`, and TypeScript remains `5.9.3`.
- Scope npm root overrides to `@angular/cli@21.2.29`, resolving `glob` to `14.0.3` and `minimatch` to `11.0.3` inside that subtree. This crosses transitive dependency major versions, so it requires compatibility evidence; it is not a blanket override or Angular 22 migration.
- Regenerate and commit the real `package-lock.json` using npm on the Windows worktree. Never fabricate lockfile checksums or use `npm audit fix --force`.
- `scripts/v3-security-audit.mjs` runs both audit scopes, rejects malformed/inconsistent output and any nonzero finding, and does not treat historical results as approved exceptions. `scripts/v3-security-audit.test.mjs` checks the zero-target and Windows shell-free npm invocation. The existing `security:audit:baseline` command name is kept for automation compatibility.

The **November 3, 2026** recovery worktree at detached `7711681fb3e2b1ca504ca01308aed5011efc07d6` produced:

| Check | Observed result |
| --- | --- |
| `npm install --package-lock-only --ignore-scripts` | Completed; 0 vulnerabilities reported |
| `npm ci` | Completed; 440 packages installed; 0 vulnerabilities reported |
| `npm ls glob minimatch --all` | `glob@14.0.3`, `minimatch@11.0.3` under Angular CLI 21.2.29 |
| `npm audit --omit=dev` | **0 vulnerabilities**, exit 0 |
| `npm audit` | **0 vulnerabilities**, exit 0 |
| `npm run security:audit:baseline` | **Both zero-target scopes passed**, exit 0 after hardening |
| `npm exec -- ng version` | Angular CLI 21.2.29; Angular framework 21.2.24; Node 24.21.0; npm 11.19.0 |
| `npm run verify` | Typecheck and build passed; **481/481 repository tests** passed |
| `npm run test:v3-security-audit` | **12/12 tests** passed after zero-target hardening |
| `npm run test:v3-release-gate` | **8/8 tests** passed; V3.1s still NO_GO |
| `git diff --check` | Passed |

`npm ci` also warned that four install scripts were not yet covered by `allowScripts` (`esbuild@0.28.1`, `@parcel/watcher@2.6.0`, `lmdb@3.5.1`, `msgpackr-extract@3.0.4`). Treat them as a separate installation-policy review; do not silently approve additional scripts.

These are the user's local Windows results. A GitHub Actions run for the **exact final candidate SHA** and a saved, independently reviewed full-lockfile patch are still outstanding. Passing an audit does not prove that the overridden major-version APIs behave correctly under Angular CLI file discovery or application builds.

## Additional local acceptance (November 3, 2026)

After zero-target hardening, the same recovered worktree passed the following, as shown in the Windows PowerShell logs:

| Check | Observed result |
| --- | --- |
| `npm run test:v3-security-audit` | **12/12 passed** |
| `npm run verify` | **481/481 passed**, typecheck and build passed |
| `npm run test:v3-release-gate` | **8/8 passed**; existing production decision **NO_GO** |
| `npm run test:workspace-crash` | **4/4 passed** |
| `npm run test:redis` | **12/12 passed** with loopback Redis 7 |
| `npm run test:workspace-quiescence-redis` | **7/7 passed** with loopback Redis 7 and FFmpeg |
| `npm run test:object-storage` | **7/7 passed** with loopback Redis and digest-pinned S3-compatible SILO |
| `npm run verify:studio` | Passed Chrome Studio acceptance, with five zero-difference visual checkpoints |
| Angular 21 app production build | Passed with the Vexa Angular example and restored root dependency tree |
| `npm run release:check`, `release:ffmpeg-check`, `release:pack`, `release:install-check` | Passed; 18 packages installed from tarballs and 22 packed export paths imported |
| `npm run format:check` | Exited successfully; no formatter is enforced, so this is not a formatting guarantee |
| Consolidated Git patch export | **46,148 bytes**, SHA-256 `E4D5E9F05CBE456DD200911451D846416A2E3C50C22C24A03FFACC9246731877` before this documentation update; reverse-apply check passed |

`npm install-scripts ls` reported four scripts not covered by `allowScripts`: `esbuild@0.28.1`, `@parcel/watcher@2.6.0`, `lmdb@3.5.1`, and `msgpackr-extract@3.0.4`. No blanket approval was granted. These warnings are distinct from npm audit findings; native behavior on other operating systems still requires appropriate CI acceptance.

The local Angular build used root-installed dependencies; packed-install acceptance separately tested a consumer compiled against all 18 packed packages. Neither test establishes every production deployment scenario.

## Remaining review and release boundaries

1. Review the **actual final consolidated patch and registry-generated `package-lock.json`** for unexpected changes. The previously exported 46,148-byte file was not independently inspected here; re-export after this documentation update. Keep baseline `7711681fb3e2b1ca504ca01308aed5011efc07d6`.
2. Run current-commit GitHub Actions on the exact final candidate, including the audit gate, Redis/S3 recovery and cross-platform release checks as applicable. A prior green V3.1t run is not evidence for V3.1u.
3. Keep additional native install scripts unapproved until individually reviewed; verify relevant install/build behavior on Ubuntu and macOS.
4. Preserve the existing primary checkout; integrate through a deliberate feature-branch review rather than committing blindly from the detached recovery worktree.
5. Retain the V3.1 **NO_GO** until deployment-wide process-tree, ownership, provider, rollback and other release gates have their own evidence.

A clean dependency audit is **not** V3.1 production approval. Separate deployment-wide worker quiescence, FFmpeg process-tree, storage, and release gates remain open. Published `2.0.0` does not change, and V3.2 capability-aware scheduling must not be combined into this milestone.

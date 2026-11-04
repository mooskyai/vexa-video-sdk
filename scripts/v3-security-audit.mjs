import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix, resolve, win32 } from "node:path";

// Baseline recorded from the October 29, 2026 Windows npm audit on V3.1t.
// This is an upper bound for regression detection, NOT an approved risk waiver.
const BASELINES = Object.freeze({
  production: Object.freeze({
    counts: Object.freeze({ critical: 0, high: 3, moderate: 5, low: 0, total: 8 }),
    packages: Object.freeze({
      "@hono/node-server": "moderate",
      "@modelcontextprotocol/sdk": "high",
      "body-parser": "high",
      "fast-uri": "moderate",
      "hono": "moderate",
      "ip-address": "moderate",
      "qs": "moderate",
      "zod": "high"
    })
  }),
  all: Object.freeze({
    counts: Object.freeze({ critical: 2, high: 7, moderate: 5, low: 0, total: 14 }),
    packages: Object.freeze({
      "@angular/build": "critical",
      "@angular/cli": "high",
      "@hono/node-server": "moderate",
      "@modelcontextprotocol/sdk": "high",
      "body-parser": "high",
      "fast-uri": "moderate",
      "hono": "moderate",
      "ip-address": "moderate",
      "piscina": "critical",
      "qs": "moderate",
      "source-map-js": "high",
      "undici": "high",
      "vite": "high",
      "zod": "high"
    })
  })
});

const ORDER = Object.freeze({ low: 1, moderate: 2, high: 3, critical: 4 });

/** Inspect an npm audit v2 JSON report without treating existing findings as approval. */
export function checkAuditReport(report, scope) {
  const baseline = BASELINES[scope];
  if (!baseline) throw new Error("Scope must be production or all.");
  if (!report || typeof report !== "object" || Array.isArray(report)
    || !report.metadata?.vulnerabilities || !report.vulnerabilities
    || typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities)) {
    throw new Error("npm audit did not return a valid v2 vulnerability report.");
  }
  const counts = report.metadata.vulnerabilities;
  const problems = [];
  for (const key of Object.keys(baseline.counts)) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) {
      throw new Error(`npm audit report has an invalid ${key} count.`);
    }
    if (counts[key] > baseline.counts[key]) {
      problems.push(`${key}: ${counts[key]} exceeds V3.1t baseline ${baseline.counts[key]}`);
    }
  }
  if (counts.info !== undefined && (!Number.isSafeInteger(counts.info) || counts.info < 0)) {
    throw new Error("npm audit report has an invalid info count.");
  }
  if (counts.total !== 0) {
    problems.push(`${scope} must be vulnerability-free (found ${counts.total}); the historical baseline is not an allowance`);
  }
  if (counts.total !== counts.critical + counts.high + counts.moderate + counts.low
    + (counts.info ?? 0)) {
    throw new Error("npm audit totals are inconsistent.");
  }
  if (counts.total === 0 && Object.keys(report.vulnerabilities).length !== 0) {
    throw new Error("npm audit reported zero findings alongside vulnerability records.");
  }
  for (const [name, record] of Object.entries(report.vulnerabilities)) {
    const allowed = baseline.packages[name];
    if (!allowed) {
      problems.push(`new affected dependency: ${name}`);
      continue;
    }
    if (!record || typeof record !== "object" || !ORDER[record.severity]) {
      throw new Error(`Invalid severity record for ${name}.`);
    }
    if (ORDER[record.severity] > ORDER[allowed]) {
      problems.push(`${name}: ${record.severity} exceeds baseline ${allowed}`);
    }
  }
  return {
    ok: problems.length === 0,
    scope,
    counts: { critical: counts.critical, high: counts.high, moderate: counts.moderate,
      low: counts.low, total: counts.total },
    problems
  };
}

/** Invoke npm without a shell, including when npm is a .cmd shim on Windows. */
export function npmAuditInvocation({ platform = process.platform, nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath, exists = existsSync } = {}) {
  const paths = platform === "win32" ? win32 : posix;
  const isCli = (candidate) => candidate && paths.isAbsolute(candidate)
    && paths.basename(candidate).toLowerCase() === "npm-cli.js" && exists(candidate);
  if (isCli(npmExecPath)) return { executable: nodePath, prefixArgs: [npmExecPath] };
  if (platform === "win32") {
    const installed = paths.join(paths.dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
    if (isCli(installed)) return { executable: nodePath, prefixArgs: [installed] };
    throw new Error("Cannot find npm-cli.js. Run through npm run security:audit:baseline.");
  }
  return { executable: "npm", prefixArgs: [] };
}

function main() {
  const scope = process.argv[2];
  if (!BASELINES[scope] || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/v3-security-audit.mjs production|all");
  }
  const args = ["audit", "--json", ...(scope === "production" ? ["--omit=dev"] : [])];
  const invocation = npmAuditInvocation();
  const result = spawnSync(invocation.executable, [...invocation.prefixArgs, ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit failed to run (exit ${result.status ?? "unknown"}).`);
  }
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error("npm audit returned invalid JSON."); }
  const verdict = checkAuditReport(report, scope);
  const counts = verdict.counts;
  console.log(`V3.1u ${scope}: ${counts.total} vulnerabilities; ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low.`);
  if (!verdict.ok) {
    for (const problem of verdict.problems) console.error(`REGRESSION: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(scope === "production"
    ? "CLEAN PRODUCTION AUDIT: no production vulnerabilities reported; release is NOT authorized."
    : "CLEAN FULL AUDIT: no vulnerabilities reported across the installed dependency tree; release is NOT authorized.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

import assert from "node:assert/strict";
import test from "node:test";
import { checkAuditReport, npmAuditInvocation } from "./v3-security-audit.mjs";

const full = {
  "@angular/build": "critical", "@angular/cli": "high", "@hono/node-server": "moderate",
  "@modelcontextprotocol/sdk": "high", "body-parser": "high", "fast-uri": "moderate",
  "hono": "moderate", "ip-address": "moderate", "piscina": "critical",
  "qs": "moderate", "source-map-js": "high", "undici": "high", "vite": "high", "zod": "high"
};
const prod = Object.fromEntries(Object.entries(full).filter(([name]) =>
  !["@angular/build", "@angular/cli", "piscina", "source-map-js", "undici", "vite"].includes(name)));
function fixture(packages, counts) {
  return { metadata: { vulnerabilities: { low: 0, ...counts } },
    vulnerabilities: Object.fromEntries(Object.entries(packages).map(([name, severity]) => [name, { severity }])) };
}
const fullCounts = { moderate: 5, high: 7, critical: 2, total: 14 };
const prodCounts = { moderate: 5, high: 3, critical: 0, total: 8 };

test("V3.1u rejects historical full-tree findings now that the target is zero", () => {
  const verdict = checkAuditReport(fixture(full, fullCounts), "all");
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join(" "), /all must be vulnerability-free/);
});

test("V3.1u rejects historical production findings now that the target is zero", () => {
  const verdict = checkAuditReport(fixture(prod, prodCounts), "production");
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join(" "), /production must be vulnerability-free/);
});

test("V3.1u passes a genuinely clean production audit", () => {
  const clean = fixture({}, { moderate: 0, high: 0, critical: 0, total: 0 });
  assert.equal(checkAuditReport(clean, "production").ok, true);
});

test("V3.1u permits a genuinely clean full-tree audit", () => {
  assert.equal(checkAuditReport(fixture({}, { moderate: 0, high: 0, critical: 0, total: 0 }), "all").ok, true);
});

test("V3.1u rejects new full-tree findings even below the historical baseline", () => {
  const report = fixture({ "@angular/cli": "moderate" }, { moderate: 1, high: 0, critical: 0, total: 1 });
  assert.match(checkAuditReport(report, "all").problems.join(" "), /all must be vulnerability-free/);
});

test("V3.1u fails on a new vulnerable dependency despite unchanged counts", () => {
  const report = fixture({ ...prod, "unreviewed-new-package": "moderate" }, prodCounts);
  assert.match(checkAuditReport(report, "production").problems.join(" "), /unreviewed-new-package/);
});

test("V3.1u fails on severity escalation for a known dependency", () => {
  const report = fixture({ ...prod, "fast-uri": "high" }, prodCounts);
  assert.match(checkAuditReport(report, "production").problems.join(" "), /fast-uri/);
});

test("V3.1u fails on increased audit totals", () => {
  const report = fixture(prod, { moderate: 5, high: 4, critical: 0, total: 9 });
  assert.equal(checkAuditReport(report, "production").ok, false);
});

test("V3.1u fails closed on malformed, incomplete and inconsistent audit output", () => {
  assert.throws(() => checkAuditReport({}, "production"), /valid v2/);
  assert.throws(() => checkAuditReport(fixture(prod, { ...prodCounts, total: 7 }), "production"), /inconsistent/);
  assert.throws(() => checkAuditReport(fixture(prod, { moderate: 0, high: 0, critical: 0, total: 0 }), "all"), /zero findings/);
  assert.throws(() => checkAuditReport(fixture({}, { moderate: 0, high: 0, critical: 0, total: 0 }), "unexpected"), /Scope/);
  for (const info of ["invalid", {}, -1, 0.5]) {
    const malformed = fixture({}, { moderate: 0, high: 0, critical: 0, total: 0, info });
    assert.throws(() => checkAuditReport(malformed, "all"), /invalid info count/);
  }
});

test("V3.1u Windows audit launches npm-cli.js with node, never a cmd shell", () => {
  const npmExecPath = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const plan = npmAuditInvocation({ platform: "win32", nodePath: "C:\\Program Files\\nodejs\\node.exe",
    npmExecPath, exists: path => path === npmExecPath });
  assert.deepEqual(plan, { executable: "C:\\Program Files\\nodejs\\node.exe", prefixArgs: [npmExecPath] });
});

test("V3.1u Windows audit can locate adjacent npm-cli.js and fails closed if missing", () => {
  const installed = "C:\\node\\node_modules\\npm\\bin\\npm-cli.js";
  const options = { platform: "win32", nodePath: "C:\\node\\node.exe", npmExecPath: undefined };
  assert.deepEqual(npmAuditInvocation({ ...options, exists: path => path === installed }),
    { executable: options.nodePath, prefixArgs: [installed] });
  assert.throws(() => npmAuditInvocation({ ...options, exists: () => false }), /Cannot find npm-cli/);
});

test("V3.1u non-Windows audit can execute npm directly without a shell", () => {
  assert.deepEqual(npmAuditInvocation({ platform: "linux", npmExecPath: undefined, exists: () => false }),
    { executable: "npm", prefixArgs: [] });
});

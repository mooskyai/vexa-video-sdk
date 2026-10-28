import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REQUIRED_GATES, evaluateV3ReleaseGate } from './v3-release-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const evidence = JSON.parse(readFileSync(resolve(here, '../docs/V3_1S_RELEASE_EVIDENCE.json'), 'utf8'));
const copy = () => structuredClone(evidence);
const invalid = (v, message) => assert.throws(() => evaluateV3ReleaseGate(v), message);

test('V3.1s checked-in evidence stays NO_GO despite successful historical CI', () => {
  const result = evaluateV3ReleaseGate(copy(), { candidateSha: 'f'.repeat(40) });
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.counts.passed, 1);
  assert.equal(result.counts.blocked, 9);
  assert.deepEqual(result.gates.map((g) => g.id), REQUIRED_GATES);
  assert.equal(Object.isFrozen(result), true);
});

test('V3.1s rejects duplicate and omitted gates', () => {
  const v = copy(); v.gates[2].id = v.gates[1].id;
  invalid(v, /duplicated/);
  const missing = copy(); missing.gates.pop();
  invalid(missing, /exactly once/);
});

test('V3.1s rejects ungrounded historical CI and incorrect source hashes', () => {
  const v = copy(); v.verifiedCi.commitSha = 'a'.repeat(40);
  invalid(v, /matching successful/);
  const w = copy(); w.verifiedCi.runUrl = 'http://example.com/ci';
  invalid(w, /directly linked/);
  const x = copy(); x.gates[0].evidenceUrls = ['https://example.com/other-run'];
  invalid(x, /cite the matched/);
});

test('V3.1s passed gates require linked evidence; deferrals require ownership', () => {
  const v = copy(); v.gates[2] = { id: v.gates[2].id, status: 'passed' };
  invalid(v, /concrete HTTPS/);
  const w = copy(); w.gates[2] = { id: w.gates[2].id, status: 'deferred', reason: 'Needs provider certification before use' };
  invalid(w, /accountable owner/);
});

test('V3.1s does not reuse the historical CI run for a new candidate', () => {
  const v = copy();
  v.gates = v.gates.map((g) => g.id === 'current_commit_ci'
    ? { id: g.id, status: 'passed', commitSha: v.auditBaselineSha, evidenceUrls: [v.verifiedCi.runUrl] }
    : g);
  invalid(v, /different candidate SHA/);
});

test('V3.1s never claims to authorize publication, even when eligible for review', () => {
  const v = copy(); const sha = 'f'.repeat(40);
  v.gates = v.gates.map((g) => ({
    id: g.id, status: 'passed', evidenceUrls: [g.id === 'current_commit_ci'
      ? 'https://github.com/mooskyai/vexa-video-sdk/actions/runs/40699999999'
      : v.verifiedCi.runUrl],
    ...(g.id === 'current_commit_ci' ? { commitSha: sha } : {})
  }));
  assert.equal(evaluateV3ReleaseGate(v, { candidateSha: sha }).status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(evaluateV3ReleaseGate(v, { candidateSha: 'e'.repeat(40) }).status, 'NO_GO');
  assert.equal(evaluateV3ReleaseGate(v, { candidateSha: sha }).releaseAuthorized, false);
});

test('V3.1s rejects malformed schema and unreasonable status records', () => {
  const v = copy(); v.schemaVersion = 2; invalid(v, /schemaVersion 1/);
  const w = copy(); w.gates[4].status = 'unknown'; invalid(w, /invalid V3.1s/);
  const x = copy(); x.gates[4].reason = ''; invalid(x, /explicit reason/);
});

test('V3.1s CLI reports NO_GO normally and fails closed with --require-ready', () => {
  const script = resolve(here, 'v3-release-gate.mjs');
  const manifest = resolve(here, '../docs/V3_1S_RELEASE_EVIDENCE.json');
  const ordinary = spawnSync(process.execPath, [script, manifest, '--json'], { encoding: 'utf8' });
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(JSON.parse(ordinary.stdout).status, 'NO_GO');
  const strict = spawnSync(process.execPath, [script, manifest, '--require-ready'], { encoding: 'utf8' });
  assert.equal(strict.status, 2);
  assert.match(strict.stdout, /NO_GO/);
});

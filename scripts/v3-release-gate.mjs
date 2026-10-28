#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** This is an evidence inventory validator, NOT a production release authorizer. */
export const REQUIRED_GATES = Object.freeze([
  'isolated_hardening_ci',
  'current_commit_ci',
  'workspace_producer_quiescence',
  'retention_operator_approval',
  'production_provider_conditional_writes',
  'provider_interruption_and_multipart',
  'tenant_iam_isolation',
  'backup_restore_and_legal_hold',
  'cross_platform_release_matrix',
  'migration_and_mixed_worker_compatibility'
]);

const SHA = /^[0-9a-f]{40}$/;
const GITHUB_RUN = /^https:\/\/github\.com\/mooskyai\/vexa-video-sdk\/actions\/runs\/[1-9][0-9]*$/;
const STATES = new Set(['passed', 'blocked', 'deferred']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function evaluateV3ReleaseGate(manifest, options = {}) {
  if (!object(manifest) || manifest.schemaVersion !== 1 || manifest.milestone !== 'V3.1s') {
    throw new Error('V3.1s release evidence must use schemaVersion 1 and milestone V3.1s.');
  }
  if (typeof manifest.auditBaselineSha !== 'string' || !SHA.test(manifest.auditBaselineSha)) {
    throw new Error('A full lowercase audited source SHA is required.');
  }
  if (!object(manifest.verifiedCi)
      || manifest.verifiedCi.commitSha !== manifest.auditBaselineSha
      || manifest.verifiedCi.conclusion !== 'success'
      || typeof manifest.verifiedCi.runUrl !== 'string'
      || !GITHUB_RUN.test(manifest.verifiedCi.runUrl)) {
    throw new Error('A matching successful, directly linked GitHub CI audit record is required.');
  }
  if (!Array.isArray(manifest.gates) || manifest.gates.length !== REQUIRED_GATES.length) {
    throw new Error('All V3.1s release gates must be recorded exactly once.');
  }
  const seen = new Set();
  const gates = manifest.gates.map((gate) => {
    if (!object(gate) || !REQUIRED_GATES.includes(gate.id) || seen.has(gate.id)
        || !STATES.has(gate.status)) {
      throw new Error('Unknown, duplicated or invalid V3.1s release gate.');
    }
    seen.add(gate.id);
    if (gate.status === 'passed') {
      if (!Array.isArray(gate.evidenceUrls) || gate.evidenceUrls.length === 0
          || !gate.evidenceUrls.every((url) => typeof url === 'string' && /^https:\/\//.test(url))) {
        throw new Error(`Passed gate ${gate.id} must include concrete HTTPS evidence links.`);
      }
    } else if (typeof gate.reason !== 'string' || gate.reason.trim().length < 12) {
      throw new Error(`Blocked/deferred gate ${gate.id} needs an explicit reason.`);
    }
    if (gate.status === 'deferred'
        && (typeof gate.owner !== 'string' || gate.owner.trim() === ''
          || typeof gate.targetMilestone !== 'string' || gate.targetMilestone.trim() === '')) {
      throw new Error(`Deferred gate ${gate.id} requires an accountable owner and milestone.`);
    }
    if (gate.id === 'isolated_hardening_ci'
        && (gate.status !== 'passed' || !gate.evidenceUrls.includes(manifest.verifiedCi.runUrl))) {
      throw new Error('The audited hardening CI gate must cite the matched workflow run.');
    }
    if (gate.id === 'current_commit_ci' && gate.status === 'passed') {
      // The historical V3.1r run must never qualify an unverified V3.1s commit.
      if (typeof gate.commitSha !== 'string' || !SHA.test(gate.commitSha)
          || gate.commitSha === manifest.auditBaselineSha
          || gate.evidenceUrls.includes(manifest.verifiedCi.runUrl)
          || !gate.evidenceUrls.every((url) => GITHUB_RUN.test(url))) {
        throw new Error('Current-commit CI needs a different candidate SHA and GitHub run URL.');
      }
    }
    return Object.freeze({ id: gate.id, status: gate.status });
  });
  if (seen.size !== REQUIRED_GATES.length || REQUIRED_GATES.some((id) => !seen.has(id))) {
    throw new Error('Missing required V3.1s release gate.');
  }
  const commitSha = options.candidateSha;
  if (commitSha !== undefined && (typeof commitSha !== 'string' || !SHA.test(commitSha))) {
    throw new Error('Candidate SHA must be a full lowercase git commit SHA.');
  }
  const candidateGate = manifest.gates.find((gate) => gate.id === 'current_commit_ci');
  const matchesCandidate = commitSha !== undefined
    && candidateGate.status === 'passed'
    && candidateGate.commitSha === commitSha;
  const status = gates.every((gate) => gate.status === 'passed') && matchesCandidate
    ? 'READY_FOR_HUMAN_REVIEW' : 'NO_GO';
  const counts = Object.freeze({
    passed: gates.filter((g) => g.status === 'passed').length,
    blocked: gates.filter((g) => g.status === 'blocked').length,
    deferred: gates.filter((g) => g.status === 'deferred').length
  });
  return Object.freeze({
    milestone: 'V3.1s', auditBaselineSha: manifest.auditBaselineSha,
    candidateSha: commitSha ?? null, status, counts, gates: Object.freeze(gates),
    releaseAuthorized: false // Human approval and the protected publication workflow remain separate.
  });
}

function main(argv) {
  const flags = new Set(argv);
  if ([...flags].some((flag) => flag.startsWith('--') && !['--json', '--require-ready', '--candidate-sha'].includes(flag))) {
    throw new Error('Unknown release-gate option.');
  }
  const index = argv.indexOf('--candidate-sha');
  if (index !== -1 && (index + 1 >= argv.length || argv[index + 1].startsWith('--'))) {
    throw new Error('--candidate-sha requires a full 40-character SHA.');
  }
  const positional = argv.filter((value, i) => !value.startsWith('--') && (index === -1 || i !== index + 1));
  if (positional.length > 1) throw new Error('Supply at most one evidence manifest path.');
  const filename = resolve(positional[0] ?? 'docs/V3_1S_RELEASE_EVIDENCE.json');
  const report = evaluateV3ReleaseGate(JSON.parse(readFileSync(filename, 'utf8')),
    { candidateSha: index === -1 ? undefined : argv[index + 1] });
  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`V3.1s ${report.status}; audit ${report.auditBaselineSha.slice(0, 7)}; `
      + `${report.counts.passed} passed, ${report.counts.blocked} blocked, ${report.counts.deferred} deferred.\n`
      + 'This report does not authorize a release.\n');
  }
  if (flags.has('--require-ready') && report.status !== 'READY_FOR_HUMAN_REVIEW') {
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`V3.1s evidence rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}

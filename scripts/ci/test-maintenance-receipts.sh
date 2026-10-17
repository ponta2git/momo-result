#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_tmp="$(mktemp -d)"
trap 'rm -rf "${task_tmp}"' EXIT
control="${repo_root}/_deps/momo-maintenance-control"
revision="$(tr -d '\r\n' < "${repo_root}/scripts/ci/maintenance-control-ref.txt")"
[[ "${revision}" =~ ^[a-f0-9]{40}$ && "$(git -C "${control}" rev-parse HEAD)" == "${revision}" ]] || exit 1
git -C "${control}" diff --quiet HEAD -- scripts/maintenance

# Exercise the pinned controller's real file binding and exact permit check.
# Only the provider/store ports are synthetic; this never calls GitHub or a DB.
node --input-type=module - "${control}" "${task_tmp}" <<'JS'
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [control, directory] = process.argv.slice(2);
const { main } = await import(pathToFileURL(`${control}/scripts/maintenance/run.mjs`));
const { validateControl, digest } = await import(pathToFileURL(`${control}/scripts/maintenance/control.mjs`));
const sha = '0123456789abcdef0123456789abcdef01234567';
const hash = 'a'.repeat(64);
const operations = [
  ['consumers', 'SUMMIT_STAGED', 'summitReady', 'deploy-maintenance.yml', null],
  ['analysis', 'CONSUMERS_STAGED', 'consumersReady', 'analysis-maintenance.yml',
    { operationId: 'analysis-release-operation-fixture', campaignId: 'analysis-campaign-fixture', planDigest: `sha256:${hash}` }],
  ['publish', 'RESUMED', 'stability', 'runtime-release.yml',
    { deploymentRunId: '400', deploymentRunAttempt: 3, provenanceArtifactId: '500', provenanceArtifactDigest: hash }],
];
for (const [operation, phase, previousStage, workflow, scope] of operations) {
  Object.assign(process.env, {
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'ponta2git/momo-result',
    GITHUB_WORKFLOW_REF: `ponta2git/momo-result/.github/workflows/${workflow}@refs/heads/cutover/fixture`,
    GITHUB_REF: 'refs/heads/cutover/fixture', GITHUB_SHA: sha, GITHUB_RUN_ID: '300', GITHUB_RUN_ATTEMPT: '2',
  });
  const record = validateControl({ formatVersion: 1, stateVersion: 10, operator: 'fixture',
    updatedAt: '2026-10-18T00:00:00.000Z', epoch: 4, completed: null,
    cutover: { id: 'fixture', stopEpoch: 4, phase, candidates: { db: sha, summit: sha, result: sha },
      evidence: { finalRehearsal: hash, [previousStage]: hash }, permits: [], invalidatedReason: null } });
  const input = { formatVersion: 1, operation, scope, cutoverId: 'fixture', stopEpoch: 4,
    candidates: record.cutover.candidates,
    evidence: Object.fromEntries(['sourceIdentity', 'baselineLedger', 'targetLedger', 'pendingTail', 'savedData',
      'baselineSchema', 'targetData', 'targetSchema', 'snapshot', 'finalRehearsal', 'previousStage'].map(key => [key, hash])),
    producer: { runId: '101', runAttempt: 2, artifacts: [{ id: '11', digest: hash }, { id: '22', digest: hash }],
      configDigest: hash, secretVersion: 'fixture-version' }, execution: { runId: 'untrusted-input' } };
  const request = async path => {
    const prefix = 'repos/ponta2git/momo-result/actions/';
    if (path === `${prefix}runs/101/attempts/2`) return {
      id: 101, run_attempt: 2, head_sha: sha, head_branch: 'master', event: 'push',
      path: '.github/workflows/deploy.yml', status: 'completed', conclusion: 'success',
    };
    const names = { 11: 'runtime-image-101-2', 22: 'analysis-candidate-metadata-101-2' };
    const id = path.slice(`${prefix}artifacts/`.length);
    assert.equal(path, `${prefix}artifacts/${id}`);
    assert.ok(names[id]);
    return { id: Number(id), name: names[id], expired: false, digest: `sha256:${hash}`,
      workflow_run: { id: 101, head_sha: sha, head_branch: 'master' } };
  };
  const store = { read: async () => ({ record, head: sha }) };
  const source = `${directory}/${operation}-input.json`, target = `${directory}/${operation}.json`;
  await writeFile(source, JSON.stringify(input));
  await main(['bind-receipt', operation, source, target], store, request);
  const receipt = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(receipt.execution.runId, '300');
  assert.equal(receipt.execution.runAttempt, 2);
  assert.equal(receipt.execution.workflow, `.github/workflows/${workflow}`);
  assert.deepEqual(receipt.scope, scope);
  record.cutover.permits = [{ operation, repository: 'ponta2git/momo-result', runId: '300', runAttempt: 2,
    receiptDigest: digest(receipt), deadline: '2099-01-01T00:00:00.000Z' }];
  await main(['maintenance-guard', operation, target], store, request);
  if (operation === 'analysis') {
    const changed = structuredClone(receipt);
    changed.scope.campaignId = 'unreviewed-campaign';
    await writeFile(`${directory}/changed.json`, JSON.stringify(changed));
    await assert.rejects(main(['maintenance-guard', operation, `${directory}/changed.json`], store, request),
      { message: 'EXACT_EXECUTION_NOT_PERMITTED' });
  }
  process.env.GITHUB_RUN_ATTEMPT = '3';
  await assert.rejects(main(['maintenance-guard', operation, target], store, request), { message: 'EXECUTION_TUPLE_CHANGED' });
}
JS
"${repo_root}/scripts/ci/ci-tool.sh" maintenance-operation-scope "${task_tmp}/analysis.json" analysis > "${task_tmp}/analysis-scope"
"${repo_root}/scripts/ci/ci-tool.sh" maintenance-operation-scope "${task_tmp}/publish.json" publish > "${task_tmp}/publish-scope"
grep -q '^campaign_id=analysis-campaign-fixture$' "${task_tmp}/analysis-scope"
grep -q '^deployment_run_id=400$' "${task_tmp}/publish-scope"
echo 'Pinned shared receipts bind to the actual run and Result operation scopes.'

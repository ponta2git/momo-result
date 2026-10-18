import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artifactName, command, execution, fileHash, imageTag, loadArtifact, manifestPath,
  readJson, sourceManifest, validateCandidate, validateSelection, validateSmoke, verifyArtifact, verifyProducerMetadata,
  workflowPath, writeJson } from './preparation-runtime-repair.mjs';
import { collectProviders, createObserver, observe, updateConfiguration, updateRuntime,
  verifyObserverStability } from './preparation-runtime-deploy.mjs';
import { requireSmokeEnvironment } from './preparation-runtime-smoke.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const controlDirectory = process.env.MOMO_PREPARATION_TEST_CONTROL_DIR ??
  resolve(directory, '../../_deps/momo-maintenance-control');
const shared = {};
for (const name of ['control', 'preparation-repair', 'freeze-contract']) {
  Object.assign(shared, await import(pathToFileURL(resolve(controlDirectory, 'scripts/maintenance/' + name + '.mjs'))));
}
const { value: manifest, sha256: manifestHash } = await sourceManifest();
const context = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'ponta2git/momo-result',
  GITHUB_WORKFLOW_REF: 'ponta2git/momo-result/' + workflowPath + '@refs/heads/cutover/fixture',
  GITHUB_REF: 'refs/heads/cutover/fixture', GITHUB_SHA: 'b'.repeat(40),
  GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2',
};
const candidate = () => ({
  formatVersion: 1, operation: 'preparation-runtime-repair',
  ...Object.fromEntries(['baseSha', 'patchSha', 'sourceSha', 'sourceTree'].map(key => [key, manifest[key]])),
  sourceManifestSha256: manifestHash, ...execution(context), archiveSha256: 'a'.repeat(64),
  configDigest: 'sha256:' + 'b'.repeat(64), rootfsDigest: 'c'.repeat(64),
});
const selection = () => ({ id: '200', digest: 'd'.repeat(64), ...execution(context) });
const database = { formatVersion: 1, targetFingerprint: 'a'.repeat(64), ledgerFingerprint: 'b'.repeat(64) };
const normal = () => ({ event: 'runtime_postdeploy_smoke', schemaVersion: 1, status: 'ok',
  checks: ['database', 'http', 'http2', 'processes', 'web'] });
const frozen = () => ({ event: 'runtime_maintenance_readiness', schemaVersion: 1, status: 'ok',
  checks: ['frozen_readiness', 'normal_routes_closed', 'database_contract', 'runtime_processes'], database: structuredClone(database) });

function rawProviders() {
  const consumers = { api: 'momo-result-api', worker: 'momo-processing-worker', summit: 'summit' };
  const writers = {
    api: { http_admission: 'admission', http_continuations_and_runtime: 'all' },
    worker: { scheduler_and_attempts: 'admission', runtime_and_notifications: 'all' },
    summit: { startup: 'admission', discord_interactions: 'admission', reconnect_recovery: 'admission',
      scheduler: 'admission', ask_sends: 'admission', notification_operations: 'admission', result_notifications: 'all' },
  };
  return Object.fromEntries(Object.entries(consumers).map(([role, consumer], index) => [role, {
    machines: [{ id: String(index + 1).repeat(14), instance: 'instance-' + role,
      image: 'registry.fixture.invalid/' + role + '@sha256:' + 'c'.repeat(64),
      bootId: '00000000-0000-0000-0000-000000000001', events: [{ type: 'start' }],
      config: { image: 'previous-tag', env: { MOMO_MAINTENANCE_MODE: 'normal', PRIVATE_VALUE: 'private-canary' },
        guest: { cpus: 2, memory_mb: 512 } } }],
    secrets: [{ name: 'SECRET_CANARY', digest: 'secret-metadata-canary', status: 'Deployed' }],
    status: { consumer, scope: 'process', mode: 'normal', processId: 12, phase: 'running',
      cutoverId: null, stopEpoch: null, stage: null,
      writers: Object.entries(writers[role]).map(([name, stage]) => ({ name, stage, status: 'active' })),
      inFlight: { requests: 1 } },
  }]));
}

test('fixed candidate separates workflow revision from the exact ten-file P0 repair', () => {
  assert.equal(manifestHash, shared.preparationRepairSourceSha256);
  assert.equal(manifest.files.length, 10);
  assert.equal(manifest.sourceSha, 'c94b5348be1231bb1621f5e8bd3422de301af7a8');
  assert.equal(manifest.pins['.momo-db-ref'], '5a8d8902cc75bdce5e15f416890c2a2ec1cb8e90');
  assert.deepEqual(validateCandidate(candidate(), manifest, manifestHash), candidate());
  assert.equal(imageTag(candidate()), 'registry.fly.io/momo-result:' + manifest.sourceSha + '-100-2');
  for (const change of [
    value => { value.sourceSha = 'e'.repeat(40); }, value => { value.sourceTree = 'e'.repeat(40); },
    value => { value.baseSha = 'e'.repeat(40); }, value => { value.patchSha = 'e'.repeat(40); },
    value => { value.workflowSha = value.sourceSha; }, value => { value.workflowSha = [value.workflowSha]; },
    value => { value.sourceManifestSha256 = 'f'.repeat(64); }, value => { value.runId = ['100']; },
    value => { value.runAttempt = '2'; }, value => { value.archiveSha256 = 'sha256:' + value.archiveSha256; },
    value => { value.databaseUrl = 'private-canary'; },
  ]) {
    const changed = candidate(); change(changed);
    assert.throws(() => validateCandidate(changed, manifest, manifestHash));
  }
});

test('workflow context rejects ordinary deploys, mutable refs, and rerun substitutions', () => {
  assert.deepEqual(execution(context), { workflowSha: 'b'.repeat(40), runId: '100', runAttempt: 2 });
  for (const [key, value] of [
    ['GITHUB_EVENT_NAME', 'push'], ['GITHUB_REF', 'refs/heads/master'], ['GITHUB_REPOSITORY', 'other/repository'],
    ['GITHUB_WORKFLOW_REF', 'ponta2git/momo-result/.github/workflows/deploy.yml@refs/heads/cutover/fixture'],
    ['GITHUB_SHA', 'master'], ['GITHUB_RUN_ID', '0'], ['GITHUB_RUN_ATTEMPT', '0'],
  ]) assert.throws(() => execution({ ...context, [key]: value }));
  assert.throws(() => validateCandidate(candidate(), manifest, manifestHash, { runAttempt: 3 }));
});

test('smoke evidence rejects omitted checks, missing database proof, and leaked fields', () => {
  validateSmoke(normal()); validateSmoke(frozen(), true);
  const publicNormal = normal(); publicNormal.checks.splice(4, 0, 'publicEdge');
  validateSmoke(publicNormal, false, true);
  for (const value of [normal(), frozen()]) {
    const isFrozen = value.event.includes('maintenance');
    assert.throws(() => validateSmoke({ ...value, private: 'private-canary' }, isFrozen));
    assert.throws(() => validateSmoke({ ...value, status: 'failed' }, isFrozen));
    assert.throws(() => validateSmoke({ ...value, checks: value.checks.slice(1) }, isFrozen));
  }
  const missing = frozen(); delete missing.database;
  assert.throws(() => validateSmoke(missing, true));
  assert.throws(() => validateSmoke({ ...frozen(), database: { ...database, url: 'private-canary' } }, true));
  assert.throws(() => validateSmoke(normal(), false, true));
});

test('producer requires one successful exact attempt, branch, archive digest, and artifact', () => {
  const selected = selection();
  const run = { id: 100, run_attempt: 2, head_sha: selected.workflowSha, event: 'workflow_dispatch',
    status: 'completed', conclusion: 'success', path: workflowPath, head_branch: 'cutover/fixture' };
  const artifact = { id: 200, name: artifactName(selected), expired: false, digest: 'sha256:' + selected.digest,
    workflow_run: { id: 100, head_sha: selected.workflowSha, head_branch: run.head_branch } };
  verifyProducerMetadata(selected, run, artifact);
  for (const [key, value] of [['run_attempt', 3], ['conclusion', 'failure'], ['status', 'in_progress'],
    ['event', 'push'], ['head_branch', 'master'], ['path', '.github/workflows/deploy.yml'], ['head_sha', manifest.sourceSha]]) {
    assert.throws(() => verifyProducerMetadata(selected, { ...run, [key]: value }, artifact));
  }
  for (const change of [
    value => { value.expired = true; }, value => { value.id = 201; }, value => { value.name = 'runtime-image-100-2'; },
    value => { value.digest = 'sha256:' + 'e'.repeat(64); }, value => { value.workflow_run.id = 101; },
  ]) {
    const changed = structuredClone(artifact); change(changed);
    assert.throws(() => verifyProducerMetadata(selected, run, changed));
  }
  assert.throws(() => validateSelection({ ...selected, id: ['200'] }));
  assert.throws(() => validateSelection({ ...selected, digest: artifact.digest }));
});

test('artifact verification detects archive, sidecar, provenance, and symlink substitution', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'momo-repair-artifact-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = resolve(root, 'image');
  await command('python3', [resolve(directory, 'preparation-runtime-image.test.py'), '--fixture', artifact, manifestPath]);
  await verifyArtifact(artifact, execution(context));
  const path = resolve(artifact, 'candidate.json');
  const original = await readJson(path);
  await writeJson(path, { ...original, sourceSha: 'e'.repeat(40) }, 'w');
  await assert.rejects(() => verifyArtifact(artifact));
  await writeJson(path, original, 'w');
  await writeFile(resolve(artifact, 'unexpected.json'), '{}');
  await assert.rejects(() => verifyArtifact(artifact));
  await rm(resolve(artifact, 'unexpected.json'));
  const smokePath = resolve(artifact, 'normal-smoke.json');
  const bytes = await readFile(smokePath);
  await rm(smokePath); await writeFile(resolve(root, 'smoke.json'), bytes);
  await symlink(resolve(root, 'smoke.json'), smokePath);
  await assert.rejects(() => verifyArtifact(artifact));
  await rm(smokePath); await writeFile(smokePath, bytes);
  await writeFile(resolve(artifact, 'momo-result-image.tar.gz'), 'changed');
  await assert.rejects(() => verifyArtifact(artifact));
});

test('load binds a different OCI runnable ID to producer config and exact layer bytes', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'momo-repair-load-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = resolve(root, 'image'), fixtures = resolve(root, 'fixtures');
  await command('python3', [resolve(directory, 'preparation-runtime-image.test.py'), '--fixture', artifact, manifestPath, fixtures]);
  const calls = [];
  const run = async (program, args, options) => {
    if (program === 'python3') return command(program, args, options);
    assert.equal(program, 'docker'); calls.push(args);
    if (args[0] === 'load') return Buffer.from('Loaded fixture');
    if (args[1] === 'inspect') return readFile(resolve(fixtures, 'inspect.json'));
    assert.deepEqual(args.slice(0, 3), ['image', 'save', '--output']);
    await copyFile(resolve(fixtures, 'export.tar'), args[3]); await chmod(args[3], 0o600);
    return Buffer.alloc(0);
  };
  const result = await loadArtifact(artifact, resolve(root, 'captures'), execution(context), run);
  assert.notEqual(result.runnable.actualDockerImageId, result.candidate.configDigest);
  assert.equal(result.runnable.producerConfigImageId, result.candidate.configDigest);
  assert.equal(result.runnable.localRunnableIdVerified, true);
  assert.equal(result.runnable.localIdentityKind, 'oci-manifest-digest');
  assert.deepEqual(calls.map(args => args[0]), ['load', 'image', 'image']);
  assert.equal(await fileHash(resolve(root, 'captures/export.tar')), await fileHash(resolve(fixtures, 'export.tar')));
});

test('isolated Worker child preserves all consumers, secrets, and its normal daemon PID', () => {
  const before = rawProviders(), after = structuredClone(before), now = '2026-10-18T12:00:00.000Z';
  const output = JSON.stringify(verifyObserverStability(shared, before, after, database, 'c'.repeat(64), now));
  for (const value of ['private-canary', 'SECRET_CANARY', 'secret-metadata-canary', 'instance-api', before.api.machines[0].id]) {
    assert.equal(output.includes(value), false);
  }
  for (const change of [
    value => { value.worker.status.processId++; }, value => { value.worker.status.mode = 'frozen'; },
    value => { value.api.machines[0].bootId = '00000000-0000-0000-0000-000000000002'; },
    value => { value.summit.machines[0].config.env.PRIVATE_VALUE = 'changed'; },
    value => { value.worker.secrets[0].digest = 'changed'; }, value => { value.api.status.writers[0].status = 'drained'; },
  ]) {
    const changed = structuredClone(after); change(changed);
    assert.throws(() => verifyObserverStability(shared, before, changed, database, 'c'.repeat(64), now));
  }
});

test('observer collects all three roles before and after the fixed read-only child', async () => {
  const providers = rawProviders();
  const names = { 'momo-result': 'api', 'momo-result-analysis': 'worker', 'summit-momotetsu': 'summit' };
  const counts = { api: 0, worker: 0, summit: 0, child: 0, barriers: 0 };
  const provider = {
    list: async app => [{ id: providers[names[app]].machines[0].id, state: 'started' }],
    inspect: async target => { counts[target.role]++; return structuredClone(providers[target.role].machines[0]); },
    secrets: async app => structuredClone(providers[names[app]].secrets),
    process: async target => structuredClone(providers[target.role].status),
  };
  const result = await observe({ ...shared, inspectPreparationBarriers: async () => {
    counts.barriers++; return 'c'.repeat(64);
  } }, {}, { execution: {} }, { provider, exec: async (target, args) => {
    assert.equal(target.role, 'worker');
    assert.deepEqual(args, ['/momo-toolbox/env', 'MOMO_MAINTENANCE_MODE=frozen',
      '/usr/local/bin/momo-processing-worker', 'bootstrap', '--', 'maintenance-readiness']);
    assert.deepEqual([counts.api, counts.worker, counts.summit], [1, 1, 1]);
    counts.child++;
    return { event: 'worker_maintenance_readiness', status: 'ready', schemaVersion: 1, mode: 'frozen', database };
  } });
  assert.deepEqual(counts, { api: 2, worker: 2, summit: 2, child: 1, barriers: 2 });
  assert.deepEqual(result.observation.database, database);
  await assert.rejects(() => collectProviders({ ...provider, list: async () => [] }));
});

test('observer routes fixed commands to scoped tokens and rejects arbitrary exec or mutation', async () => {
  let routed;
  const calls = [];
  const fakeShared = { processCommand: role => [role, 'status'],
    createFlyProvider: async options => { routed = options.run; assert.equal(options.token, 'read-only'); return {}; } };
  const environment = { PREPARATION_OBSERVER_FLY_API_TOKEN: 'read-only', FLY_API_TOKEN: 'api-only',
    ANALYSIS_FLY_API_TOKEN: 'worker-only', SUMMIT_PREPARATION_EXEC_TOKEN: 'summit-exec-only' };
  await createObserver(fakeShared, environment, async (program, args, options) => {
    calls.push({ program, args, token: options.env.FLY_API_TOKEN }); return Buffer.from('{}');
  });
  for (const [app, wanted] of [['momo-result', 'api-only'], ['momo-result-analysis', 'worker-only'], ['summit-momotetsu', 'summit-exec-only']]) {
    await routed('flyctl', ['machine', 'exec', 'a'.repeat(14), 'cat /proc/sys/kernel/random/boot_id', '--app', app, '--json', '--timeout', '25']);
    assert.equal(calls.at(-1).token, wanted);
  }
  await routed('flyctl', ['secrets', 'list', '--app', 'momo-result', '--json']);
  assert.equal(calls.at(-1).token, 'read-only');
  await assert.rejects(() => routed('flyctl', ['secrets', 'set', 'PRIVATE=canary', '--app', 'momo-result']));
  await assert.rejects(() => routed('flyctl', ['machine', 'exec', 'a'.repeat(14), 'printenv', '--app', 'momo-result', '--json', '--timeout', '25']));
  await assert.rejects(() => createObserver(fakeShared, { ...environment, SUMMIT_PREPARATION_EXEC_TOKEN: '' }));
  assert.equal(calls.length, 4);
});

test('Runtime update preserves config, checks exact lease and permission, then releases its lease', async () => {
  const original = rawProviders().api.machines[0], ref = 'registry.fly.io/momo-result@sha256:' + 'f'.repeat(64);
  const config = updateConfiguration(original, ref);
  assert.deepEqual(config, { ...original.config, image: ref }); assert.notEqual(config.env, original.config.env);
  const calls = [];
  await updateRuntime(original, ref, async () => { calls.push('guard'); },
    { inspect: async () => { calls.push('inspect'); return original; } },
    async (target, method, suffix, body, nonce) => {
      assert.deepEqual(target, { role: 'api', app: 'momo-result', id: original.id }); calls.push(method + suffix);
      if (suffix === '/lease' && method === 'POST') return { data: { nonce: 'own-lease', version: original.instance } };
      assert.equal(nonce, 'own-lease');
      if (method === 'POST') {
        assert.deepEqual(body, { config, current_version: original.instance, skip_secrets: false });
        return { id: original.id, instance_id: 'next-instance', config };
      }
    });
  assert.deepEqual(calls, ['guard', 'POST/lease', 'inspect', 'guard', 'POST', 'DELETE/lease']);
  assert.equal(original.config.image, 'previous-tag');
});

test('stale lease, changed Runtime, or revoked permission stops update and releases the lease', async () => {
  const original = rawProviders().api.machines[0], ref = 'registry.fly.io/momo-result@sha256:' + 'f'.repeat(64);
  for (const scenario of ['stale-lease', 'changed-machine', 'revoked-guard']) {
    const calls = []; let guards = 0;
    await assert.rejects(() => updateRuntime(original, ref, async () => {
      guards++; if (scenario === 'revoked-guard' && guards === 2) throw new Error('revoked');
    }, { inspect: async () => scenario === 'changed-machine' ? { ...original, instance: 'changed' } : original },
    async (target, method, suffix) => {
      calls.push(method + suffix);
      if (method === 'POST') return { data: { nonce: 'own-lease', version: scenario === 'stale-lease' ? 'stale' : original.instance } };
    }));
    assert.deepEqual(calls, ['POST/lease', 'DELETE/lease'], scenario);
  }
});

test('CI database guard accepts only the disposable local service and exact workflow', () => {
  const environment = { ...context, CI: 'true', GITHUB_ACTIONS: 'true', MOMO_DB_TEST_DATABASE: 'momo_db_test_preparation_runtime',
    MOMO_DB_TEST_HOST: '127.0.0.1', MOMO_DB_TEST_PORT: '5432', MOMO_DB_TEST_USER: 'postgres', MOMO_DB_TEST_PASSWORD: 'postgres' };
  requireSmokeEnvironment(environment);
  for (const [key, value] of [['CI', 'false'], ['GITHUB_ACTIONS', 'false'],
    ['MOMO_DB_TEST_DATABASE', 'production'], ['MOMO_DB_TEST_HOST', 'database.example.invalid']]) {
    assert.throws(() => requireSmokeEnvironment({ ...environment, [key]: value }));
  }
});

test('failed commands and malformed JSON never expose raw diagnostic data', async t => {
  await assert.rejects(() => command(process.execPath, ['-e', 'process.stderr.write("private-canary");process.exit(1)']),
    error => error.message === 'CHILD_COMMAND_FAILED');
  const root = await mkdtemp(resolve(tmpdir(), 'momo-repair-json-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, 'invalid.json'); await writeFile(path, '{}\n{"private":"canary"}');
  await assert.rejects(() => readJson(path), error => error.message === 'INVALID_JSON_FILE');
});

#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check, command, digest, downloadArtifact, execution, imageTag, loadArtifact, readJson,
  same, validateSmoke, verifyLoadedImage, writeJson } from './preparation-runtime-repair.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apps = { api: 'momo-result', worker: 'momo-result-analysis', summit: 'summit-momotetsu' };
const workerProofCommand = ['/momo-toolbox/env', 'MOMO_MAINTENANCE_MODE=frozen',
  '/usr/local/bin/momo-processing-worker', 'bootstrap', '--', 'maintenance-readiness'];
const runtimeSmokeCommand = ['/opt/momo-result/bin/momo-runtime-tool', 'smoke', 'local'];
const identifier = /^[a-f0-9]{10,32}$/;
const imageReference = /^registry\.fly\.io\/momo-result@sha256:[a-f0-9]{64}$/;
const token = (environment, key) => {
  const value = environment[key];
  check(typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value), 'REPAIR_PROVIDER_TOKEN_REQUIRED');
  return value;
};

export async function sharedControl(directory) {
  const wanted = (await readFile(resolve(scriptDirectory, 'maintenance-control-ref.txt'), 'utf8')).trim();
  check(/^[a-f0-9]{40}$/.test(wanted), 'INVALID_REPAIR_CONTROL_PIN');
  check((await command('git', ['rev-parse', 'HEAD'], { cwd: directory })).toString().trim() === wanted,
    'REPAIR_CONTROL_CHECKOUT_CHANGED');
  check((await command('git', ['status', '--porcelain', '--untracked-files=no', '--', 'scripts/maintenance', 'scripts/migration'],
    { cwd: directory })).toString().trim() === '', 'REPAIR_CONTROL_CHECKOUT_DIRTY');
  const modules = {};
  for (const name of ['control', 'github-store', 'run', 'preparation-repair', 'preparation-repair-run', 'fly-provider', 'freeze-contract']) {
    Object.assign(modules, await import(pathToFileURL(resolve(directory, 'scripts/maintenance/' + name + '.mjs'))));
  }
  return modules;
}

export function observerCommands(shared, role) {
  return [
    ['cat', '/proc/sys/kernel/random/boot_id'],
    shared.processCommand(role, 'status'),
    ...(role === 'worker' ? [workerProofCommand] : []),
    ...(role === 'api' ? [runtimeSmokeCommand] : []),
  ].map(args => args.join(' '));
}

export async function createObserver(shared, environment = process.env, run = command) {
  const tokens = {
    api: token(environment, 'FLY_API_TOKEN'),
    worker: token(environment, 'ANALYSIS_FLY_API_TOKEN'),
    summit: token(environment, 'SUMMIT_PREPARATION_EXEC_TOKEN'),
  };
  const observerToken = token(environment, 'PREPARATION_OBSERVER_FLY_API_TOKEN');
  const routed = async (program, args, options = {}) => {
    check(program === 'flyctl', 'REPAIR_FIXED_PROVIDER_COMMAND_REQUIRED');
    let selected = observerToken;
    if (args[0] === 'machine' && args[1] === 'exec') {
      const role = Object.keys(apps).find(value => apps[value] === args[5]);
      check(role && args.length === 9 && args[4] === '--app' && args[6] === '--json' &&
        args[7] === '--timeout' && args[8] === '25' && identifier.test(args[2]) &&
        observerCommands(shared, role).includes(args[3]), 'REPAIR_FIXED_PROVIDER_COMMAND_REQUIRED');
      selected = tokens[role];
    } else {
      check(args.length === 5 && args[0] === 'secrets' && args[1] === 'list' &&
        args[2] === '--app' && Object.values(apps).includes(args[3]) && args[4] === '--json',
      'REPAIR_READ_ONLY_PROVIDER_COMMAND_REQUIRED');
    }
    return (await run(program, args, { ...options, timeout: 45000,
      env: { ...environment, FLY_API_TOKEN: selected, NO_COLOR: '1' } })).toString('utf8');
  };
  const provider = await shared.createFlyProvider({ token: observerToken, run: routed });
  const exec = async (target, args) => {
    const response = JSON.parse(await routed('flyctl', ['machine', 'exec', target.id, args.join(' '),
      '--app', apps[target.role], '--json', '--timeout', '25']));
    check((response.exit_code === undefined || response.exit_code === 0) &&
      (response.exit_signal === undefined || response.exit_signal === 0) && typeof response.stdout === 'string' &&
      response.stdout.length <= 16384, 'REPAIR_PROCESS_COMMAND_FAILED');
    return JSON.parse(response.stdout);
  };
  return { provider, exec };
}

export async function collectProviders(provider) {
  return Object.fromEntries(await Promise.all(Object.entries(apps).map(async ([role, app]) => {
    const inventory = await provider.list(app);
    check(Array.isArray(inventory) && inventory.length === 1 && identifier.test(inventory[0].id) &&
      inventory[0].state === 'started', 'REPAIR_SINGLE_STARTED_MACHINE_REQUIRED');
    const target = { role, app, id: inventory[0].id };
    const [machine, secrets, status] = await Promise.all([
      provider.inspect(target), provider.secrets(app), provider.process(target, 'status'),
    ]);
    return [role, { machines: [machine], secrets, status }];
  })));
}

export function verifyObserverStability(shared, before, after, database, barrierDigest, observedAt) {
  shared.validateDatabaseProof(database);
  check(before.worker.status.processId === after.worker.status.processId, 'REPAIR_WORKER_DAEMON_RESTARTED');
  const normalizedBefore = shared.observePreparationRepair({ observedAt, providers: before, database, barrierDigest });
  const observation = shared.observePreparationRepair({ observedAt, providers: after, database, barrierDigest });
  check(same(normalizedBefore.machines, observation.machines), 'REPAIR_CONSUMER_CHANGED_DURING_OBSERVATION');
  return observation;
}

// The Worker command is a separate read-only child. Its mode is never a service
// barrier: normal daemon status and every consumer identity must survive it.
export async function observe(shared, record, context, observer, request = shared.githubApi) {
  const barrierBefore = await shared.inspectPreparationBarriers(record, context.execution, request);
  const before = await collectProviders(observer.provider);
  const worker = before.worker.machines[0];
  const proof = await observer.exec({ role: 'worker', app: apps.worker, id: worker.id }, workerProofCommand);
  check(proof.event === 'worker_maintenance_readiness' && proof.status === 'ready' &&
    proof.schemaVersion === 1 && proof.mode === 'frozen', 'REPAIR_ISOLATED_DATABASE_PROOF_FAILED');
  shared.validateDatabaseProof(proof.database);
  const after = await collectProviders(observer.provider);
  const barrierDigest = await shared.inspectPreparationBarriers(record, context.execution, request);
  check(barrierBefore === barrierDigest, 'REPAIR_BARRIERS_CHANGED_DURING_OBSERVATION');
  return {
    observation: verifyObserverStability(shared, before, after, proof.database, barrierDigest, new Date().toISOString()),
    providers: after,
  };
}

async function runtimeRequest(environment, target, method, suffix = '', body, nonce, fetcher = fetch) {
  check(target.role === 'api' && target.app === apps.api && identifier.test(target.id) &&
    ['', '/lease'].includes(suffix) && ['POST', 'DELETE'].includes(method), 'REPAIR_RUNTIME_ONLY_MUTATION_REQUIRED');
  try {
    const response = await fetcher('https://api.machines.dev/v1/apps/' + apps.api + '/machines/' + target.id + suffix, {
      method, redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: { Authorization: 'Bearer ' + token(environment, 'FLY_API_TOKEN'), 'Content-Type': 'application/json',
        ...(nonce ? { 'fly-machine-lease-nonce': nonce } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    check(response.ok, 'REPAIR_RUNTIME_REQUEST_FAILED');
    if (response.status === 204) return null;
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      check(size <= 4 * 1024 * 1024, 'REPAIR_RUNTIME_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks));
  } catch { throw new Error('REPAIR_RUNTIME_REQUEST_FAILED'); }
}

export function updateConfiguration(original, registryRef) {
  check(imageReference.test(registryRef) && original.config && typeof original.config === 'object',
    'REPAIR_IMMUTABLE_RUNTIME_IMAGE_REQUIRED');
  return { ...structuredClone(original.config), image: registryRef };
}

export async function updateRuntime(original, registryRef, guard, provider, request) {
  const target = { role: 'api', app: apps.api, id: original.id };
  await guard();
  const lease = await request(target, 'POST', '/lease', { ttl: 120, description: 'preparation-runtime-repair' });
  const nonce = lease?.data?.nonce;
  check(typeof nonce === 'string' && nonce.length > 0, 'REPAIR_RUNTIME_LEASE_UNAVAILABLE');
  try {
    check(lease.data.version === original.instance, 'REPAIR_RUNTIME_LEASE_VERSION_CHANGED');
    check(same(await provider.inspect(target), original), 'REPAIR_RUNTIME_CHANGED_BEFORE_UPDATE');
    const config = updateConfiguration(original, registryRef);
    await guard();
    const updated = await request(target, 'POST', '', { config, current_version: original.instance, skip_secrets: false }, nonce);
    check(updated?.id === original.id && typeof updated.instance_id === 'string' &&
      updated.instance_id !== original.instance && same(updated.config, config), 'REPAIR_RUNTIME_UPDATE_RESULT_UNKNOWN');
  } finally {
    await request(target, 'DELETE', '/lease', undefined, nonce);
  }
}

export async function verifyRegistry(directory, captures, candidate, run = command) {
  const values = JSON.parse((await run('docker', ['image', 'inspect', imageTag(candidate)])).toString());
  check(Array.isArray(values) && values.length === 1 && Array.isArray(values[0].RepoDigests), 'REPAIR_REGISTRY_DIGEST_REQUIRED');
  const references = [...new Set(values[0].RepoDigests.filter(value => imageReference.test(value)))];
  check(references.length === 1, 'REPAIR_SINGLE_REGISTRY_DIGEST_REQUIRED');
  const registryRef = references[0];
  await run('docker', ['pull', '--platform', 'linux/amd64', registryRef], { timeout: 600000 });
  const pulled = JSON.parse((await run('docker', ['image', 'inspect', registryRef])).toString());
  check(Array.isArray(pulled) && pulled.length === 1 && pulled[0].RepoDigests?.includes(registryRef),
    'REPAIR_PULLED_REGISTRY_IDENTITY_CHANGED');
  await run('docker', ['tag', registryRef, imageTag(candidate)]);
  await verifyLoadedImage(directory, captures, candidate, run);
  return { registryRef, registryProof: { formatVersion: 1, archiveSha256: candidate.archiveSha256,
    configDigest: candidate.configDigest, rootfsDigest: candidate.rootfsDigest, imageDigest: digest(registryRef) } };
}

export async function deploy(controlDirectory, receiptPath, outputDirectory, environment = process.env) {
  execution(environment);
  const shared = await sharedControl(controlDirectory);
  const context = shared.executionContext(environment);
  const receipt = shared.validatePreparationReceipt(await readJson(receiptPath));
  check(same(context.execution, receipt.execution), 'REPAIR_DEPLOY_EXECUTION_CHANGED');
  const store = shared.createStore();
  const observer = await createObserver(shared, environment);
  const current = await store.read();
  const grantHead = current.head;
  const privateDirectory = resolve(environment.RUNNER_TEMP, 'preparation-runtime-' + receipt.execution.runId + '-' + receipt.execution.runAttempt);
  await mkdir(privateDirectory, { mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  const selection = { ...receipt.producer.artifact, runId: receipt.producer.runId,
    runAttempt: receipt.producer.runAttempt, workflowSha: receipt.producer.workflowSha };
  const downloaded = await downloadArtifact(selection, resolve(privateDirectory, 'download'), resolve(privateDirectory, 'candidate-report.json'));
  check(same(downloaded.candidate, receipt.candidate), 'REPAIR_RECEIPT_CANDIDATE_CHANGED');
  const imageDirectory = resolve(privateDirectory, 'download/image');
  await loadArtifact(imageDirectory, resolve(privateDirectory, 'loaded'), selection);
  await command('flyctl', ['auth', 'docker'], { env: { ...environment, FLY_API_TOKEN: token(environment, 'FLY_API_TOKEN') } });
  const boundary = async (step, registryProof) => {
    const observed = await observe(shared, receipt.baselineControl.record, context, observer);
    await shared.guardPreparationExecution(store, receipt, grantHead,
      { observation: observed.observation, registryProof }, step, context);
    return observed;
  };
  await boundary('registry-push', null);
  await command('docker', ['push', imageTag(receipt.candidate)], { timeout: 600000 });
  const { registryRef, registryProof } = await verifyRegistry(imageDirectory, resolve(privateDirectory, 'registry'), receipt.candidate);
  shared.validatePreparationRegistryProof(registryProof, receipt.candidate);
  const before = await boundary('runtime-update', registryProof);
  const original = before.providers.api.machines[0];
  await updateRuntime(original, registryRef, () => boundary('runtime-update', registryProof), observer.provider,
    (target, method, suffix, body, nonce) => runtimeRequest(environment, target, method, suffix, body, nonce));
  let normalSmoke = null;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      normalSmoke = validateSmoke(await observer.exec({ role: 'api', app: apps.api, id: original.id }, runtimeSmokeCommand), false, true);
      break;
    } catch { await new Promise(accept => setTimeout(accept, 2000)); }
  }
  check(normalSmoke, 'REPAIR_PRODUCTION_NORMAL_SMOKE_FAILED');
  const after = await observe(shared, receipt.baselineControl.record, context, observer);
  const completion = { formatVersion: 1, receiptDigest: shared.digest(receipt), grantHead, execution: receipt.execution,
    observation: after.observation, registryProof, normalSmokeDigest: shared.digest(normalSmoke), normalSmokePassed: true };
  shared.validatePreparationDeployment(receipt, grantHead, completion);
  const completedControl = await store.read();
  const grantedRecord = shared.grantPreparationRepair(receipt.baselineControl, receipt, completedControl.record.updatedAt);
  check(completedControl.head === grantHead && same(completedControl.record, grantedRecord) &&
    Date.now() < Date.parse(receipt.deadline), 'REPAIR_GRANT_CHANGED_BEFORE_COMPLETION');
  await writeJson(resolve(outputDirectory, 'normal-smoke.json'), normalSmoke);
  await writeJson(resolve(outputDirectory, 'completion.json'), completion);
  return { receiptDigest: completion.receiptDigest, normalSmokeDigest: completion.normalSmokeDigest,
    sourceSha: receipt.candidate.sourceSha, workflowSha: receipt.execution.sha };
}

export async function main(args, environment = process.env) {
  const [action, controlDirectory, ...rest] = args;
  if (action === 'bind') {
    execution(environment);
    check(rest.length === 1 && typeof environment.REPAIR_RECEIPT_INPUT === 'string' &&
      Buffer.byteLength(environment.REPAIR_RECEIPT_INPUT) <= 65536, 'REPAIR_RECEIPT_INPUT_REQUIRED');
    const shared = await sharedControl(controlDirectory);
    const input = JSON.parse(environment.REPAIR_RECEIPT_INPUT);
    check(!Object.hasOwn(input, 'execution'), 'REPAIR_UNBOUND_RECEIPT_REQUIRED');
    const receipt = shared.validatePreparationReceipt({ ...input, execution: shared.executionContext(environment).execution });
    await shared.verifyPreparationProducer(receipt);
    check(await shared.inspectPreparationBarriers(receipt.baselineControl.record, receipt.execution) === receipt.baseline.barrierDigest,
      'REPAIR_BARRIERS_CHANGED');
    shared.grantPreparationRepair(await shared.createStore().read(), receipt);
    await mkdir(rest[0], { mode: 0o700 });
    await writeJson(resolve(rest[0], 'receipt.json'), receipt);
    console.log(JSON.stringify({ receiptDigest: shared.digest(receipt), execution: receipt.execution }));
  } else if (action === 'candidate-context') {
    execution(environment);
    check(rest.length === 0, 'REPAIR_CONTROL_DIRECTORY_REQUIRED');
    const shared = await sharedControl(controlDirectory);
    const current = await shared.createStore().read();
    check(current.record.cutover?.phase === 'PREPARING' && current.record.cutover.candidates === null &&
      current.record.cutover.permits.length === 0 && Object.keys(current.record.cutover.evidence).length === 0 &&
      current.record.cutover.invalidatedReason === null &&
      environment.GITHUB_REF === 'refs/heads/cutover/' + current.record.cutover.id, 'UNTOUCHED_REPAIR_PREPARATION_REQUIRED');
    // Building a candidate has no provider mutation. Administrative barrier
    // reads belong to bind, grant and the two mutation boundaries.
    console.log(JSON.stringify({ controlHead: current.head, stopEpoch: current.record.cutover.stopEpoch,
      ...execution(environment) }));
  } else if (action === 'deploy') {
    check(rest.length === 2, 'REPAIR_RECEIPT_AND_OUTPUT_REQUIRED');
    console.log(JSON.stringify(await deploy(controlDirectory, rest[0], rest[1], environment)));
  } else if (action === 'observe') {
    check(rest.length === 2, 'REPAIR_RECEIPT_AND_OUTPUT_REQUIRED');
    const shared = await sharedControl(controlDirectory);
    const receipt = shared.validatePreparationReceipt(await readJson(rest[0]));
    const result = await observe(shared, receipt.baselineControl.record, { execution: receipt.execution },
      await createObserver(shared, environment));
    await writeJson(rest[1], result.observation);
    console.log(JSON.stringify({ observationDigest: shared.digest(result.observation) }));
  } else throw new Error('UNKNOWN_PREPARATION_RUNTIME_OPERATION');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch { console.error('PREPARATION_RUNTIME_OPERATION_FAILED'); process.exitCode = 1; }
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const manifestPath = resolve(scriptDirectory, 'preparation-runtime-repair-source.json');
export const sourceManifestSha256 = '133dbcf1b0fb522b0c24b319c38879b092aa390a0a4a9ff0cd65f72abe00b4a1';
export const workflowPath = '.github/workflows/preparation-runtime-repair.yml';
export const repository = 'ponta2git/momo-result';
export const artifactFiles = [
  'candidate.json', 'source-manifest.json', 'rootfs-layers.json', 'http4s-patch.json',
  'normal-smoke.json', 'frozen-smoke.json', 'momo-result-image.tar.gz',
];
const hex = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const imageDigest = /^sha256:[a-f0-9]{64}$/;
const runIdPattern = /^[1-9][0-9]{0,19}$/;
const branchPattern = /^refs\/heads\/cutover\/[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/;
const normalChecks = ['database', 'http', 'http2', 'processes', 'web'];
const frozenChecks = ['frozen_readiness', 'normal_routes_closed', 'database_contract', 'runtime_processes'];
const candidateKeys = [
  'formatVersion', 'operation', 'baseSha', 'patchSha', 'sourceSha', 'sourceTree',
  'sourceManifestSha256', 'workflowSha', 'runId', 'runAttempt', 'archiveSha256',
  'configDigest', 'rootfsDigest',
];

export class RepairError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const check = (condition, code) => { if (!condition) throw new RepairError(code); };
export const canonicalJson = value => JSON.stringify(
  Array.isArray(value) ? value.map(item => JSON.parse(canonicalJson(item))) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, JSON.parse(canonicalJson(value[key]))])) : value
);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const digest = value => hash(canonicalJson(value));
export const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  same(Object.keys(value).sort(), [...expected].sort());
export const imageTag = candidate => 'registry.fly.io/momo-result:' + candidate.sourceSha + '-' +
  candidate.runId + '-' + candidate.runAttempt;
export const artifactName = candidate => 'preparation-runtime-image-' + candidate.runId + '-' + candidate.runAttempt;

export async function readJson(path, maxBytes = 65536) {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink() && info.size <= maxBytes, 'INVALID_JSON_FILE');
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new RepairError('INVALID_JSON_FILE'); }
}
export async function writeJson(path, value, flag = 'wx') {
  await writeFile(path, canonicalJson(value) + '\n', { mode: 0o600, flag });
}
export async function fileHash(path) {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink(), 'REGULAR_FILE_REQUIRED');
  const result = createHash('sha256');
  for await (const chunk of createReadStream(path)) result.update(chunk);
  return result.digest('hex');
}
export async function command(program, args, options = {}) {
  const child = spawn(program, args, {
    cwd: options.cwd, env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(options.timeout ?? 60000),
  });
  // Provider and process errors can contain environment or connection values.
  child.stderr.resume();
  const completed = new Promise((accept, reject) => {
    child.once('error', () => reject(new RepairError('CHILD_START_FAILED')));
    child.once('close', (code, signal) => code === 0 && !signal ? accept() :
      reject(new RepairError('CHILD_COMMAND_FAILED')));
  });
  completed.catch(() => {});
  const chunks = []; let length = 0;
  for await (const chunk of child.stdout) {
    length += chunk.length;
    if (length > (options.maxBytes ?? 4 * 1024 * 1024)) {
      child.kill('SIGKILL'); await completed.catch(() => {});
      throw new RepairError('CHILD_OUTPUT_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  await completed;
  return Buffer.concat(chunks);
}
async function git(directory, ...args) {
  return (await command('git', args, { cwd: directory })).toString('utf8').trim();
}
export async function sourceManifest() {
  const sha256 = await fileHash(manifestPath);
  check(sha256 === sourceManifestSha256, 'FIXED_REPAIR_SOURCE_MANIFEST_CHANGED');
  return { value: await readJson(manifestPath), sha256 };
}

// The source is one reviewed commit over one reviewed parent, never an input SHA.
export async function verifySource(directory) {
  const { value: manifest, sha256 } = await sourceManifest();
  check(await git(directory, 'rev-parse', 'HEAD') === manifest.sourceSha, 'REPAIR_SOURCE_CHANGED');
  check(await git(directory, 'rev-parse', 'HEAD^') === manifest.baseSha, 'REPAIR_PARENT_CHANGED');
  check(await git(directory, 'rev-parse', 'HEAD^{tree}') === manifest.sourceTree &&
    await git(directory, 'rev-parse', manifest.baseSha + '^{tree}') === manifest.baseTree, 'REPAIR_TREE_CHANGED');
  check(await git(directory, 'status', '--porcelain', '--untracked-files=all') === '', 'REPAIR_SOURCE_DIRTY');
  const paths = (await git(directory, 'diff', '--name-only', manifest.baseSha, 'HEAD')).split('\n');
  check(same(paths, manifest.files.map(file => file.path)) && paths.length === 10, 'REPAIR_PATCH_SCOPE_CHANGED');
  for (const file of manifest.files) {
    for (const [revision, blob, sha] of [
      [manifest.baseSha, file.beforeBlob, file.beforeSha256], ['HEAD', file.afterBlob, file.afterSha256],
    ]) {
      if (blob === null) {
        check(await git(directory, 'ls-tree', revision, '--', file.path) === '', 'REPAIR_ADDITION_ALREADY_EXISTS');
      } else {
        check(await git(directory, 'rev-parse', revision + ':' + file.path) === blob, 'REPAIR_BLOB_CHANGED');
        check(hash(await command('git', ['show', revision + ':' + file.path], { cwd: directory })) === sha,
          'REPAIR_BYTES_CHANGED');
      }
    }
  }
  check(await git(directory, 'rev-parse', 'HEAD:apps/processing-worker') === manifest.workerTree,
    'WORKER_TREE_CHANGED');
  for (const [path, value] of Object.entries(manifest.pins)) {
    check(await git(directory, 'show', 'HEAD:' + path) === value, 'REPAIR_PIN_CHANGED');
  }
  check(await fileHash(resolve(directory, 'fly.toml')) === manifest.runtimeConfigSha256, 'RUNTIME_CONFIG_CHANGED');
  return { sourceSha: manifest.sourceSha, sourceTree: manifest.sourceTree, sourceManifestSha256: sha256,
    databaseSha: manifest.pins['.momo-db-ref'] };
}

export function validateSmoke(value, frozen = false, publicEdge = false) {
  check(keys(value, frozen ? ['event', 'schemaVersion', 'status', 'checks', 'database'] :
    ['event', 'schemaVersion', 'status', 'checks']), 'SMOKE_FIELDS_CHANGED');
  check(value.schemaVersion === 1 && value.status === 'ok' &&
    value.event === (frozen ? 'runtime_maintenance_readiness' : 'runtime_postdeploy_smoke'), 'SMOKE_FAILED');
  const expected = frozen ? frozenChecks : publicEdge ?
    ['database', 'http', 'http2', 'processes', 'publicEdge', 'web'] : normalChecks;
  check(same(value.checks, expected), 'SMOKE_CHECKS_CHANGED');
  if (frozen) check(keys(value.database, ['formatVersion', 'targetFingerprint', 'ledgerFingerprint']) &&
    value.database.formatVersion === 1 && hex.test(value.database.targetFingerprint) &&
    hex.test(value.database.ledgerFingerprint), 'DATABASE_PROOF_REQUIRED');
  return value;
}

export function validateCandidate(value, manifest, manifestSha256, expected = {}) {
  check(keys(value, candidateKeys) && value.formatVersion === 1 &&
    value.operation === 'preparation-runtime-repair', 'INVALID_REPAIR_CANDIDATE');
  for (const key of ['baseSha', 'patchSha', 'sourceSha', 'sourceTree']) {
    check(value[key] === manifest[key], 'REPAIR_CANDIDATE_SOURCE_CHANGED');
  }
  check(value.sourceManifestSha256 === manifestSha256 && typeof value.workflowSha === 'string' && commit.test(value.workflowSha) &&
    value.workflowSha !== value.sourceSha && typeof value.runId === 'string' && runIdPattern.test(value.runId) &&
    Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0 &&
    typeof value.archiveSha256 === 'string' && hex.test(value.archiveSha256) &&
    typeof value.configDigest === 'string' && imageDigest.test(value.configDigest) &&
    typeof value.rootfsDigest === 'string' && hex.test(value.rootfsDigest),
  'INVALID_REPAIR_CANDIDATE_IDENTITY');
  for (const key of ['runId', 'runAttempt', 'workflowSha']) {
    if (expected[key] !== undefined) check(value[key] === expected[key], 'REPAIR_PRODUCER_CHANGED');
  }
  return value;
}

export async function verifyArtifact(directory, expected = {}, inspectArchive = true) {
  const { value: manifest, sha256 } = await sourceManifest();
  check(same((await readdir(directory)).sort(), [...artifactFiles].sort()), 'UNEXPECTED_REPAIR_ARTIFACT_FILE');
  for (const file of artifactFiles) {
    const info = await lstat(resolve(directory, file));
    check(info.isFile() && !info.isSymbolicLink(), 'REGULAR_ARTIFACT_FILES_REQUIRED');
  }
  check(await fileHash(resolve(directory, 'source-manifest.json')) === sha256, 'REPAIR_MANIFEST_CHANGED');
  const candidate = validateCandidate(await readJson(resolve(directory, 'candidate.json')), manifest, sha256, expected);
  check(await fileHash(resolve(directory, 'momo-result-image.tar.gz')) === candidate.archiveSha256,
    'REPAIR_IMAGE_ARCHIVE_CHANGED');
  const layers = await readJson(resolve(directory, 'rootfs-layers.json'));
  check(Array.isArray(layers) && layers.length > 0 && layers.length <= 150 && layers.every(value => imageDigest.test(value)) &&
    digest(layers) === candidate.rootfsDigest, 'REPAIR_ROOTFS_CHANGED');
  const patch = await readJson(resolve(directory, 'http4s-patch.json'));
  check(keys(patch, ['repository', 'scalaVersion', 'sourceSha', 'version']) &&
    patch.repository === 'https://github.com/ponta2git/http4s.git' && patch.scalaVersion === '3.3.6' &&
    patch.sourceSha === manifest.http4sSourceSha && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,150}$/.test(patch.version),
  'HTTP4S_PATCH_CHANGED');
  validateSmoke(await readJson(resolve(directory, 'normal-smoke.json')));
  validateSmoke(await readJson(resolve(directory, 'frozen-smoke.json')), true);
  if (inspectArchive) await command('python3', [resolve(scriptDirectory, 'preparation-runtime-image.py'),
    'verify-tar', directory], { timeout: 600000 });
  return candidate;
}

export function execution(environment = process.env) {
  const workflow = environment.GITHUB_WORKFLOW_REF?.split('@')[0];
  check(environment.GITHUB_EVENT_NAME === 'workflow_dispatch' && environment.GITHUB_REPOSITORY === repository &&
    workflow === repository + '/' + workflowPath && branchPattern.test(environment.GITHUB_REF) &&
    commit.test(environment.GITHUB_SHA) && runIdPattern.test(environment.GITHUB_RUN_ID) &&
    /^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ATTEMPT) &&
    Number.isSafeInteger(Number(environment.GITHUB_RUN_ATTEMPT)), 'REPAIR_WORKFLOW_CONTEXT_REQUIRED');
  return { workflowSha: environment.GITHUB_SHA, runId: environment.GITHUB_RUN_ID,
    runAttempt: Number(environment.GITHUB_RUN_ATTEMPT) };
}

export async function createCandidate(directory, source, environment = process.env, run = command) {
  const context = execution(environment);
  await verifySource(source);
  const { value: manifest, sha256 } = await sourceManifest();
  const tag = imageTag({ sourceSha: manifest.sourceSha, ...context });
  const inspected = JSON.parse((await run('docker', ['image', 'inspect', tag])).toString('utf8'));
  check(Array.isArray(inspected) && inspected.length === 1 && inspected[0].Os === 'linux' &&
    inspected[0].Architecture === 'amd64' && imageDigest.test(inspected[0].Id) &&
    Array.isArray(inspected[0].RootFS?.Layers), 'REPAIR_IMAGE_INSPECTION_FAILED');
  const config = JSON.parse((await run('python3', [resolve(scriptDirectory, 'preparation-runtime-image.py'),
    'source-config', resolve(directory, 'momo-result-image.tar.gz'), tag], { timeout: 600000 })).toString());
  check(imageDigest.test(config.configDigest) && same(config.layers, inspected[0].RootFS.Layers),
    'PRODUCER_ARCHIVE_CONFIG_CHANGED');
  const candidate = {
    formatVersion: 1, operation: 'preparation-runtime-repair',
    baseSha: manifest.baseSha, patchSha: manifest.patchSha, sourceSha: manifest.sourceSha,
    sourceTree: manifest.sourceTree, sourceManifestSha256: sha256, ...context,
    archiveSha256: await fileHash(resolve(directory, 'momo-result-image.tar.gz')),
    configDigest: config.configDigest, rootfsDigest: digest(config.layers),
  };
  await writeFile(resolve(directory, 'source-manifest.json'), await readFile(manifestPath), { mode: 0o600, flag: 'wx' });
  await writeJson(resolve(directory, 'rootfs-layers.json'), inspected[0].RootFS.Layers);
  const patch = {};
  for (const [key, file] of [['repository', 'repository'], ['sourceSha', 'source-sha'],
    ['scalaVersion', 'scala-version'], ['version', 'version']]) {
    patch[key] = (await run('docker', ['run', '--rm', '--entrypoint', '/usr/bin/cat', tag,
      '/opt/momo-result/contracts/http4s-patch/' + file + '.txt'])).toString('utf8').trim();
  }
  await writeJson(resolve(directory, 'http4s-patch.json'), patch);
  await writeJson(resolve(directory, 'candidate.json'), candidate);
  await verifyArtifact(directory, context);
  return candidate;
}

export function validateSelection(selection) {
  check(keys(selection, ['id', 'digest', 'runId', 'runAttempt', 'workflowSha']) &&
    typeof selection.id === 'string' && runIdPattern.test(selection.id) &&
    typeof selection.digest === 'string' && hex.test(selection.digest) &&
    typeof selection.runId === 'string' && runIdPattern.test(selection.runId) &&
    Number.isSafeInteger(selection.runAttempt) && selection.runAttempt > 0 &&
    typeof selection.workflowSha === 'string' && commit.test(selection.workflowSha),
  'INVALID_REPAIR_ARTIFACT_SELECTION');
  return selection;
}
export function verifyProducerMetadata(selection, run, artifact) {
  validateSelection(selection);
  check(String(run.id) === selection.runId && run.run_attempt === selection.runAttempt &&
    run.head_sha === selection.workflowSha && run.event === 'workflow_dispatch' && run.status === 'completed' &&
    run.conclusion === 'success' && run.path === workflowPath &&
    branchPattern.test('refs/heads/' + run.head_branch), 'UNSUCCESSFUL_REPAIR_PRODUCER');
  check(String(artifact.id) === selection.id && artifact.name === artifactName(selection) &&
    artifact.expired === false && artifact.digest === 'sha256:' + selection.digest &&
    String(artifact.workflow_run?.id) === selection.runId &&
    artifact.workflow_run.head_sha === selection.workflowSha &&
    artifact.workflow_run.head_branch === run.head_branch, 'REPAIR_ARTIFACT_PROVENANCE_CHANGED');
}
async function githubJson(path) {
  return JSON.parse((await command('gh', ['api', path])).toString('utf8'));
}
export async function downloadArtifact(selection, destination, report, request = githubJson) {
  validateSelection(selection);
  const prefix = 'repos/' + repository + '/actions/';
  const [run, artifact] = await Promise.all([
    request(prefix + 'runs/' + selection.runId + '/attempts/' + selection.runAttempt),
    request(prefix + 'artifacts/' + selection.id),
  ]);
  verifyProducerMetadata(selection, run, artifact);
  await mkdir(destination, { mode: 0o700 });
  await writeJson(resolve(destination, 'producer-run.json'), run);
  await writeJson(resolve(destination, 'producer-artifact.json'), artifact);
  const zipPath = resolve(destination, 'candidate.zip');
  const child = spawn('gh', ['api', prefix + 'artifacts/' + selection.id + '/zip'], {
    stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(600000),
  });
  child.stderr.resume();
  const completed = new Promise((accept, reject) => {
    child.once('error', () => reject(new RepairError('ARTIFACT_DOWNLOAD_FAILED')));
    child.once('close', (code, signal) => code === 0 && !signal ? accept() :
      reject(new RepairError('ARTIFACT_DOWNLOAD_FAILED')));
  });
  completed.catch(() => {});
  await Promise.all([pipeline(child.stdout, createWriteStream(zipPath, { flags: 'wx', mode: 0o600 })), completed]);
  check(await fileHash(zipPath) === selection.digest, 'REPAIR_ARTIFACT_ZIP_CHANGED');
  const directory = resolve(destination, 'image');
  await command('python3', [resolve(scriptDirectory, 'preparation-runtime-image.py'),
    'extract-zip', zipPath, directory], { timeout: 600000 });
  const candidate = await verifyArtifact(directory, selection);
  const result = { formatVersion: 1, operation: 'preparation-runtime-repair-candidate', verified: true,
    artifact: { ...selection, name: artifactName(selection) }, candidate,
    sourceManifestSha256: candidate.sourceManifestSha256, zipSha256: selection.digest };
  await writeJson(report, result);
  return result;
}

export async function verifyLoadedImage(directory, captures, expected = {}, run = command) {
  const candidate = await verifyArtifact(directory, expected);
  await mkdir(captures, { mode: 0o700 });
  const captureRoot = await realpath(captures);
  const inspectPath = resolve(captureRoot, 'inspect.json');
  const exportPath = resolve(captureRoot, 'export.tar');
  const expectedPath = resolve(captureRoot, 'expected.json');
  await writeFile(inspectPath, await run('docker', ['image', 'inspect', imageTag(candidate)]),
    { flag: 'wx', mode: 0o600 });
  await run('docker', ['image', 'save', '--output', exportPath, imageTag(candidate)], { timeout: 600000 });
  await chmod(exportPath, 0o600);
  await writeJson(expectedPath, { imageRef: imageTag(candidate), producerConfigImageId: candidate.configDigest,
    rootfsDigest: candidate.rootfsDigest, archivePath: await realpath(resolve(directory, 'momo-result-image.tar.gz')),
    archiveSha256: candidate.archiveSha256 });
  const runnable = JSON.parse((await run('python3', [resolve(scriptDirectory, 'preparation-runtime-image.py'),
    'verify-local', expectedPath, inspectPath, exportPath], { timeout: 600000 })).toString());
  check(runnable.localRunnableIdVerified === true && runnable.producerConfigImageId === candidate.configDigest &&
    runnable.rootfsDigest === candidate.rootfsDigest && imageDigest.test(runnable.actualDockerImageId),
  'LOADED_REPAIR_IMAGE_CHANGED');
  await writeJson(resolve(captureRoot, 'runnable.json'), runnable);
  return { candidate, runnable };
}

export async function loadArtifact(directory, captures, expected = {}, run = command) {
  await verifyArtifact(directory, expected);
  await run('docker', ['load', '--input', resolve(directory, 'momo-result-image.tar.gz')],
    { timeout: 600000, maxBytes: 65536 });
  return verifyLoadedImage(directory, captures, expected, run);
}

export async function main(args) {
  const [action, ...rest] = args;
  if (action === 'workflow-config') {
    check(rest.length === 0, 'UNEXPECTED_WORKFLOW_CONFIG_ARGUMENT');
    const context = execution();
    const { value: manifest } = await sourceManifest();
    const controlSha = (await readFile(resolve(scriptDirectory, 'maintenance-control-ref.txt'), 'utf8')).trim();
    check(commit.test(controlSha), 'INVALID_REPAIR_CONTROL_PIN');
    for (const [key, value] of Object.entries({ sourceSha: manifest.sourceSha,
      databaseSha: manifest.pins['.momo-db-ref'], controlSha, imageTag: imageTag({ ...context, sourceSha: manifest.sourceSha }) })) {
      console.log(key + '=' + value);
    }
  } else if (action === 'source') {
    check(rest.length === 1, 'SOURCE_DIRECTORY_REQUIRED');
    const source = await verifySource(rest[0]);
    for (const [key, value] of Object.entries(source)) console.log(key + '=' + value);
  } else if (action === 'create-candidate') {
    check(rest.length === 2, 'ARTIFACT_AND_SOURCE_DIRECTORIES_REQUIRED');
    console.log(JSON.stringify(await createCandidate(rest[0], rest[1])));
  } else if (action === 'verify-artifact') {
    check(rest.length === 1, 'ARTIFACT_DIRECTORY_REQUIRED');
    console.log(JSON.stringify(await verifyArtifact(rest[0])));
  } else if (action === 'download') {
    check(rest.length === 3, 'SELECTION_DESTINATION_AND_REPORT_REQUIRED');
    console.log(JSON.stringify(await downloadArtifact(await readJson(rest[0]), rest[1], rest[2])));
  } else if (action === 'load') {
    check(rest.length === 2, 'ARTIFACT_AND_PRIVATE_CAPTURE_DIRECTORIES_REQUIRED');
    console.log(JSON.stringify(await loadArtifact(rest[0], rest[1])));
  } else if (action === 'verify-loaded') {
    check(rest.length === 2, 'ARTIFACT_AND_PRIVATE_CAPTURE_DIRECTORIES_REQUIRED');
    console.log(JSON.stringify(await verifyLoadedImage(rest[0], rest[1])));
  } else throw new RepairError('UNKNOWN_REPAIR_OPERATION');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof RepairError ? error.code : 'PREPARATION_REPAIR_FAILED'); process.exitCode = 1; }
}

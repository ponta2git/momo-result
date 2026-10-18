#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { check, command, execution, imageTag, readJson, same, sourceManifest,
  validateSmoke, verifySource, writeJson } from './preparation-runtime-repair.mjs';

const database = 'momo_db_test_preparation_runtime';
const localUrl = 'postgres://postgres:postgres@127.0.0.1:5432/' + database;
const tool = '/opt/momo-result/bin/momo-runtime-tool';

export function requireSmokeEnvironment(environment) {
  execution(environment);
  check(environment.CI === 'true' && environment.GITHUB_ACTIONS === 'true' &&
    environment.MOMO_DB_TEST_DATABASE === database && environment.MOMO_DB_TEST_HOST === '127.0.0.1' &&
    environment.MOMO_DB_TEST_PORT === '5432' && environment.MOMO_DB_TEST_USER === 'postgres' &&
    environment.MOMO_DB_TEST_PASSWORD === 'postgres', 'DEDICATED_CI_DATABASE_REQUIRED');
}

export async function ciSmoke(source, controlDirectory, directory, environment = process.env, run = command) {
  requireSmokeEnvironment(environment);
  await verifySource(source);
  const { value: manifest } = await sourceManifest();
  const owner = resolve(source, '_deps/momo-db');
  const ownerSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: owner })).toString().trim();
  const ownerDirty = (await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: owner })).toString().trim();
  check(ownerSha === manifest.pins['.momo-db-ref'] && !ownerDirty, 'SMOKE_DATABASE_OWNER_CHANGED');
  const { createTestClient } = await import(pathToFileURL(resolve(owner, 'tests/notification-fixtures.mjs')));
  const { verifyMigrationHistory } = await import(pathToFileURL(resolve(owner, 'scripts/check-migration-history.mjs')));
  const { inspectConnectionProof } = await import(pathToFileURL(resolve(controlDirectory, 'scripts/maintenance/connection-proof.mjs')));
  const client = createTestClient();
  const context = execution(environment);
  const tag = imageTag({ ...context, sourceSha: manifest.sourceSha });
  const names = ['normal', 'frozen'].map(mode => 'preparation-runtime-' + mode + '-' + context.runId + '-' + context.runAttempt);
  const proof = () => client.begin('isolation level repeatable read read only', sql => inspectConnectionProof(sql, localUrl));
  const owned = new Set();
  await mkdir(directory, { mode: 0o700 });
  try {
    await verifyMigrationHistory(client, resolve(owner, 'drizzle'));
    const publication = await readJson(resolve(source, 'docs/schemas/series-analysis-publication-contract-v2.json'));
    check(publication.contractVersion === 2 && Number.isSafeInteger(publication.artifactSchemaVersion) &&
      publication.artifactSchemaVersion > 0 && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(publication.validationContractId),
    'SMOKE_PUBLICATION_CONTRACT_CHANGED');
    // The DB-owner migrator created this dedicated service DB and real ledger.
    // This is the same fresh, unused publication fixture as the P0 web bootstrap.
    await client.begin(async sql => {
      const [identity] = await sql.unsafe('SELECT current_database() AS database');
      check(identity.database === database, 'DEDICATED_CI_DATABASE_REQUIRED');
      const [unused] = await sql.unsafe('SELECT (SELECT count(*)::int FROM series_analysis_release_state) AS count, ' +
        'EXISTS (SELECT 1 FROM game_titles) OR EXISTS (SELECT 1 FROM series_analysis_operation_requests) OR ' +
        'EXISTS (SELECT 1 FROM series_analysis_campaigns) OR EXISTS (SELECT 1 FROM series_analysis_reader_capabilities) OR ' +
        'EXISTS (SELECT 1 FROM series_analysis_worker_capabilities) AS used');
      check(unused.count === 1 && unused.used === false, 'UNUSED_CI_PUBLICATION_FIXTURE_REQUIRED');
      const rows = await sql.unsafe('UPDATE series_analysis_release_state SET artifact_schema_version = $1, ' +
        'validation_contract_id = $2, updated_at = clock_timestamp() WHERE singleton_key = $3 RETURNING singleton_key',
      [publication.artifactSchemaVersion, publication.validationContractId, 'current']);
      check(rows.length === 1, 'SMOKE_PUBLICATION_FIXTURE_FAILED');
    });
    const expected = await proof();
    for (const [index, mode] of ['normal', 'frozen'].entries()) {
      const name = names[index];
      await run('docker', ['run', '-d', '--name', name, '--network', 'host', '--memory', '512m',
        '--memory-swap', '512m', '--cpus', '2', '-e', 'APP_ENV=dev', '-e', 'DATABASE_URL=' + localUrl,
        '-e', 'DEV_MEMBER_IDS=member_ponta,member_akane_mami,member_otaka,member_eu',
        '-e', 'MOMO_CANONICAL_HOST=momo-result.ponta.me', '-e', 'MOMO_ORIGIN_LOCK_TOKEN=' + '0123456789abcdef'.repeat(8),
        '-e', 'MOMO_MAINTENANCE_MODE=' + mode, tag], { timeout: 120000 });
      owned.add(name);
      let smoke = null;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        try {
          const args = mode === 'normal' ? ['exec', '-e', 'MOMO_POSTDEPLOY_PUBLIC_EDGE=deferred', name, tool, 'smoke', 'local'] :
            ['exec', name, tool, 'smoke', 'maintenance'];
          const observed = validateSmoke(JSON.parse((await run('docker', args, { timeout: 30000, maxBytes: 65536 })).toString()), mode === 'frozen');
          if (mode === 'frozen') check(same(observed.database, expected), 'CI_FROZEN_DATABASE_PROOF_CHANGED');
          smoke = observed;
          break;
        } catch {
          const state = JSON.parse((await run('docker', ['inspect', '--format', '{{json .State}}', name])).toString());
          check(state.Running === true, 'CI_RUNTIME_EXITED');
          await new Promise(accept => setTimeout(accept, 2000));
        }
      }
      check(smoke, 'CI_RUNTIME_SMOKE_FAILED');
      await writeJson(resolve(directory, mode + '-smoke.json'), smoke);
      await run('docker', ['stop', '--time', '90', name], { timeout: 100000 });
      const state = JSON.parse((await run('docker', ['inspect', '--format', '{{json .State}}', name])).toString());
      check(state.Running === false && state.ExitCode === 0 && state.OOMKilled === false, 'CI_RUNTIME_SHUTDOWN_FAILED');
      await run('docker', ['rm', name]);
      owned.delete(name);
    }
    check(same(await proof(), expected), 'CI_DATABASE_LEDGER_CHANGED');
    await verifyMigrationHistory(client, resolve(owner, 'drizzle'));
    return { sourceSha: manifest.sourceSha, workflowSha: context.workflowSha, normal: true, frozen: true };
  } finally {
    for (const name of owned) await run('docker', ['rm', '--force', name]).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    check(process.argv.length === 5, 'SOURCE_CONTROL_AND_ARTIFACT_DIRECTORIES_REQUIRED');
    console.log(JSON.stringify(await ciSmoke(...process.argv.slice(2))));
  } catch { console.error('PREPARATION_RUNTIME_SMOKE_FAILED'); process.exitCode = 1; }
}

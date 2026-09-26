#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyMigrations,
  childEnvironment,
  createInterruptionSignal,
  findFreePort,
  runPlaywrightCommand,
  startApi,
  startPostgres,
  startRedis,
  stopProcessGroup,
  waitForApi,
} from "./runtime.mjs";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const playwrightArgs = process.argv.slice(2);
const POSTGRES_DB = "momo_result";

const resources = {
  apiProcess: undefined,
  imageTmpDir: undefined,
  postgres: undefined,
  redis: undefined,
};
const interruption = createInterruptionSignal();

try {
  const exitCode = await run();
  if (!interruption.aborted) process.exitCode = exitCode;
} catch (error) {
  if (!interruption.aborted) throw error;
} finally {
  await cleanup();
}

async function run() {
  const apiPort = await findFreePort();
  let webPort = await findFreePort();
  while (webPort === apiPort) webPort = await findFreePort();
  resources.imageTmpDir = await mkdtemp(join(tmpdir(), "momo-result-e2e-images-"));

  console.log("Starting isolated E2E dependencies with Testcontainers.");
  interruption.throwIfAborted();
  await startDependencies();
  interruption.throwIfAborted();
  await applyMigrations(resources.postgres, POSTGRES_DB, interruption);
  interruption.throwIfAborted();

  const databaseUrl = `postgres://postgres:postgres@${resources.postgres.getHost()}:${resources.postgres.getMappedPort(
    5432,
  )}/${POSTGRES_DB}`;
  const redisUrl = `redis://${resources.redis.getHost()}:${resources.redis.getMappedPort(6379)}/0`;
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;

  resources.apiProcess = startApi({
    apiPort,
    databaseUrl,
    imageTmpDir: resources.imageTmpDir,
    redisUrl,
  });
  await waitForApi(resources.apiProcess, `${apiBaseUrl}/healthz/details`, () =>
    interruption.throwIfAborted(),
  );

  return runPlaywright({
    apiBaseUrl,
    webBaseUrl,
  });
}

async function startDependencies() {
  const [postgresResult, redisResult] = await Promise.allSettled([startPostgres(), startRedis()]);
  const failures = [];

  if (postgresResult.status === "fulfilled") {
    resources.postgres = postgresResult.value;
  } else {
    failures.push(postgresResult.reason);
  }
  if (redisResult.status === "fulfilled") {
    resources.redis = redisResult.value;
  } else {
    failures.push(redisResult.reason);
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to start isolated E2E dependencies.");
  }
}

async function runPlaywright({ apiBaseUrl, webBaseUrl }) {
  await runPlaywrightCommand(playwrightArgs, {
    cwd: webDir,
    env: childEnvironment({
      PLAYWRIGHT_BASE_URL: webBaseUrl,
      PLAYWRIGHT_SKIP_WEB_SERVER: "0",
      VITE_API_PROXY_TARGET: apiBaseUrl,
    }),
    label: "Playwright",
    signal: interruption,
  });
  return 0;
}

async function cleanup() {
  const processCleanup = await Promise.allSettled([stopProcessGroup(resources.apiProcess)]);
  const dependencyCleanup = await Promise.allSettled([
    resources.redis?.stop(),
    resources.postgres?.stop(),
    resources.imageTmpDir
      ? rm(resources.imageTmpDir, { force: true, recursive: true })
      : Promise.resolve(),
  ]);
  const failures = [...processCleanup, ...dependencyCleanup].filter(
    (result) => result.status === "rejected",
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Standard E2E cleanup failed.",
    );
}

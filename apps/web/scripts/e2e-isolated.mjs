#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

configureDockerHost();
const { GenericContainer, Wait } = await import("testcontainers");

const POSTGRES_IMAGE = process.env["MOMO_E2E_POSTGRES_IMAGE"] ?? "postgres:16-alpine";
const REDIS_IMAGE = process.env["MOMO_E2E_REDIS_IMAGE"] ?? "redis:7-alpine";
const POSTGRES_DB = "momo_result";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "postgres";
const DEV_MEMBER_IDS = "member_ponta,member_akane_mami,member_otaka,member_eu";
const API_START_TIMEOUT_MS = 240_000;
const PROCESS_STOP_TIMEOUT_MS = 10_000;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const repoRoot = resolve(webDir, "../..");
const apiDir = resolve(repoRoot, "apps/api");
const playwrightArgs = process.argv.slice(2);

const resources = {
  apiProcess: undefined,
  imageTmpDir: undefined,
  postgres: undefined,
  redis: undefined,
};
let cleanupStarted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}

try {
  const exitCode = await run();
  process.exitCode = exitCode;
} finally {
  await cleanup();
}

async function run() {
  const apiPort = await findFreePort();
  const webPort = await findFreePort();
  resources.imageTmpDir = await mkdtemp(join(tmpdir(), "momo-result-e2e-images-"));

  console.log("Starting isolated E2E dependencies with Testcontainers.");
  resources.postgres = await startPostgres();
  await applyMigrations(resources.postgres);
  resources.redis = await startRedis();

  const databaseUrl = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${resources.postgres.getHost()}:${resources.postgres.getMappedPort(
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
  await waitForApi(resources.apiProcess, `${apiBaseUrl}/healthz/details`);

  return runPlaywright({
    apiBaseUrl,
    webBaseUrl,
  });
}

async function startPostgres() {
  return new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_DB,
      POSTGRES_PASSWORD,
      POSTGRES_USER,
    })
    .withExposedPorts(5432)
    .withStartupTimeout(120_000)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start();
}

async function startRedis() {
  return new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withStartupTimeout(120_000)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/u))
    .start();
}

async function applyMigrations(postgres) {
  const migrationsDir = await resolveMigrationsDir();
  const migrationFiles = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .toSorted()
    .map((name) => join(migrationsDir, name));

  if (migrationFiles.length === 0) {
    throw new Error(`No momo-db migration SQL files found in ${migrationsDir}.`);
  }

  console.log(`Applying ${migrationFiles.length} momo-db migrations from ${migrationsDir}.`);
  await expectContainerExec(postgres, ["mkdir", "-p", "/tmp/momo-db-migrations"], "mkdir");

  for (const migrationFile of migrationFiles) {
    const target = `/tmp/momo-db-migrations/${basename(migrationFile)}`;
    await postgres.copyContentToContainer([
      {
        content: await readFile(migrationFile),
        target,
      },
    ]);
    await expectContainerExec(
      postgres,
      [
        "psql",
        `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}`,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        target,
      ],
      basename(migrationFile),
    );
  }
}

async function resolveMigrationsDir() {
  const explicit = process.env["MOMO_DB_MIGRATIONS_DIR"]
    ? [resolve(process.env["MOMO_DB_MIGRATIONS_DIR"])]
    : [];
  const candidates = [
    ...explicit,
    resolve(repoRoot, "_deps/momo-db/drizzle"),
    resolve(repoRoot, "../momo-db/drizzle"),
  ];

  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(
    `momo-db migrations directory was not found. Set MOMO_DB_MIGRATIONS_DIR. Searched: ${candidates.join(
      ", ",
    )}`,
  );
}

async function expectContainerExec(container, command, label) {
  const result = await container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.exitCode}\n${result.stdout}${result.stderr}`,
    );
  }
}

function startApi({ apiPort, databaseUrl, imageTmpDir, redisUrl }) {
  const logs = createRingBuffer(240);
  const child = spawn("sbt", ["run"], {
    cwd: apiDir,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      APP_ENV: "dev",
      DATABASE_URL: databaseUrl,
      DEV_MEMBER_IDS: process.env["DEV_MEMBER_IDS"] ?? DEV_MEMBER_IDS,
      HTTP_HOST: "127.0.0.1",
      HTTP_PORT: String(apiPort),
      IMAGE_TMP_DIR: imageTmpDir,
      MOMO_LOG_FORMAT: process.env["MOMO_LOG_FORMAT"] ?? "text",
      REDIS_URL: redisUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = {
    code: undefined,
    signal: undefined,
  };
  child.stdout?.on("data", (chunk) => logs.push(chunk));
  child.stderr?.on("data", (chunk) => logs.push(chunk));
  child.once("exit", (code, signal) => {
    state.code = code;
    state.signal = signal;
  });
  child.e2eLogs = logs;
  child.e2eState = state;
  return child;
}

async function waitForApi(apiProcess, url) {
  const deadline = Date.now() + API_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (apiProcess.e2eState.code !== undefined || apiProcess.e2eState.signal !== undefined) {
      throw new Error(
        `API process exited before becoming healthy.\n${apiProcess.e2eLogs.toString()}`,
      );
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      const body = await response.text();
      if (response.ok && body.includes('"database":"ok"') && body.includes('"redis":"ok"')) {
        return;
      }
    } catch {
      // Retry until the API has finished compiling and binding the port.
    }

    await delay(1_000);
  }

  throw new Error(`API did not become healthy in time.\n${apiProcess.e2eLogs.toString()}`);
}

function runPlaywright({ apiBaseUrl, webBaseUrl }) {
  return new Promise((resolveRun) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", ...playwrightArgs], {
      cwd: webDir,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: webBaseUrl,
        PLAYWRIGHT_SKIP_WEB_SERVER: "0",
        VITE_API_PROXY_TARGET: apiBaseUrl,
      },
      stdio: "inherit",
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        resolveRun(1);
        return;
      }
      resolveRun(code ?? 1);
    });
  });
}

async function cleanup() {
  if (cleanupStarted) {
    return;
  }
  cleanupStarted = true;

  await stopProcessGroup(resources.apiProcess);
  await stopContainer(resources.redis);
  await stopContainer(resources.postgres);
  if (resources.imageTmpDir) {
    await rm(resources.imageTmpDir, { force: true, recursive: true });
  }
}

async function stopContainer(container) {
  if (!container) {
    return;
  }
  await container.stop().catch((error) => {
    console.error(`Failed to stop Testcontainer ${container.getId()}: ${String(error)}`);
  });
}

async function stopProcessGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    return;
  }

  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    delay(PROCESS_STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (exited) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL");
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // The process may have exited between the timeout and forced kill.
  }
}

function createRingBuffer(limit) {
  const lines = [];
  return {
    push(chunk) {
      const text = chunk.toString();
      if (process.env["MOMO_E2E_VERBOSE"] === "1") {
        process.stderr.write(text);
      }
      lines.push(...text.split(/\r?\n/u).filter(Boolean));
      if (lines.length > limit) {
        lines.splice(0, lines.length - limit);
      }
    },
    toString() {
      return lines.join("\n");
    },
  };
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolvePort(address.port);
          return;
        }
        reject(new Error("Failed to allocate a local port."));
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function configureDockerHost() {
  if (process.env["DOCKER_HOST"]) {
    return;
  }
  const dockerDesktopSocket = join(homedir(), ".docker", "run", "docker.sock");
  if (existsSync(dockerDesktopSocket)) {
    process.env["DOCKER_HOST"] = `unix://${dockerDesktopSocket}`;
  }
}

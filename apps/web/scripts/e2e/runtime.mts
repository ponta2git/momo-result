import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCommand } from "../process.mts";
import type { CommandOptions } from "../process.mts";
export { createInterruptionSignal, runCommand, stopProcessGroup } from "../process.mts";

const POSTGRES_IMAGE = process.env["MOMO_E2E_POSTGRES_IMAGE"] ?? "postgres:18-alpine";
const REDIS_IMAGE = process.env["MOMO_E2E_REDIS_IMAGE"] ?? "redis:7-alpine";
const POSTGRES_DB = "momo_result";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "postgres";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "../..");
const repoRoot = resolve(webDir, "../..");
const migrationScript = resolve(repoRoot, "scripts/ci/apply-momo-db-migrations.sh");
const migrationResolver = resolve(repoRoot, "scripts/ci/resolve-momo-db-migrations.sh");

const toolEnvironmentNames = [
  "ALL_PROXY",
  "CI",
  "COLORTERM",
  "COMSPEC",
  "COURSIER_CACHE",
  "COURSIER_REPOSITORIES",
  "CURL_CA_BUNDLE",
  "DEVELOPER_DIR",
  "FORCE_COLOR",
  "GIT_SSL_CAINFO",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "IVY_HOME",
  "JAVA_HOME",
  "JAVA_OPTS",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "MAVEN_OPTS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NO_COLOR",
  "NO_PROXY",
  "NPM_CONFIG_CAFILE",
  "PATH",
  "Path",
  "PATHEXT",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_WORKERS",
  "PNPM_HOME",
  "PWDEBUG",
  "REQUESTS_CA_BUNDLE",
  "SBT_HOME",
  "SBT_OPTS",
  "SCALA_HOME",
  "SDKROOT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "_JAVA_OPTIONS",
  "all_proxy",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "npm_config_cafile",
];

export async function startPostgres(databaseName = POSTGRES_DB) {
  configureDockerHost();
  const { GenericContainer, Wait } = await import("testcontainers");
  return new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_DB: databaseName,
      POSTGRES_PASSWORD,
      POSTGRES_USER,
    })
    .withExposedPorts(5432)
    .withStartupTimeout(120_000)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start();
}

export async function startRedis() {
  configureDockerHost();
  const { GenericContainer, Wait } = await import("testcontainers");
  return new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withStartupTimeout(120_000)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/u))
    .start();
}

export async function applyMigrations(
  postgres: { getId(): string },
  databaseName = POSTGRES_DB,
  signal?: AbortSignal,
) {
  const migrationsDir = await resolveMigrationsDir(signal);
  await runCommand(migrationScript, [], {
    cwd: repoRoot,
    env: childEnvironment({
      DATABASE_URL: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${databaseName}`,
      DOCKER_API_VERSION: process.env["DOCKER_API_VERSION"],
      DOCKER_CERT_PATH: process.env["DOCKER_CERT_PATH"],
      DOCKER_CONFIG: process.env["DOCKER_CONFIG"],
      DOCKER_CONTEXT: process.env["DOCKER_CONTEXT"],
      DOCKER_HOST: process.env["DOCKER_HOST"],
      DOCKER_TLS_VERIFY: process.env["DOCKER_TLS_VERIFY"],
      MOMO_DB_BOOTSTRAP_IS_FRESH: "true",
      MOMO_DB_BOOTSTRAP_PROFILE: "web-e2e",
      MOMO_DB_MIGRATIONS_DIR: migrationsDir,
      POSTGRES_CONTAINER: postgres.getId(),
      POSTGRES_DB: databaseName,
      POSTGRES_USER,
    }),
    label: "momo-db migrations",
    signal,
  });
}

export async function resolveMigrationsDir(signal?: AbortSignal) {
  const explicit = process.env["MOMO_DB_MIGRATIONS_DIR"];
  const { stdout } = await promisify(execFile)(migrationResolver, [], {
    cwd: repoRoot,
    env: childEnvironment({
      MOMO_DB_MIGRATIONS_DIR: explicit ? resolve(explicit) : undefined,
    }),
    signal,
  });
  return stdout.replace(/\r?\n$/u, "");
}

export function runPlaywrightCommand(args: string[], options: CommandOptions) {
  // Direct CLI ownership lets SIGINT reach Playwright's teardown without a package-manager
  // launcher forwarding the same signal a second time.
  const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  return runCommand(process.execPath, [playwrightCli, "test", ...args], {
    ...options,
    interruptSignal: "SIGINT",
  });
}

export function findFreePort() {
  return new Promise<number>((resolvePort, reject) => {
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

export function childEnvironment(additions: NodeJS.ProcessEnv) {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of toolEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const [name, value] of Object.entries(additions)) {
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

export function configureDockerHost() {
  if (process.env["DOCKER_HOST"]) {
    return;
  }
  const dockerDesktopSocket = join(homedir(), ".docker", "run", "docker.sock");
  if (existsSync(dockerDesktopSocket)) {
    process.env["DOCKER_HOST"] = `unix://${dockerDesktopSocket}`;
  }
}

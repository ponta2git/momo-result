import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const POSTGRES_IMAGE = process.env["MOMO_E2E_POSTGRES_IMAGE"] ?? "postgres:18-alpine";
const REDIS_IMAGE = process.env["MOMO_E2E_REDIS_IMAGE"] ?? "redis:7-alpine";
const POSTGRES_DB = "momo_result";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "postgres";
const DEV_MEMBER_IDS = "member_ponta,member_akane_mami,member_otaka,member_eu";
const E2E_MUTATION_RATE_LIMIT_PER_MINUTE = "240";
const API_START_TIMEOUT_MS = 240_000;
const PROCESS_STOP_TIMEOUT_MS = 10_000;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "../..");
const repoRoot = resolve(webDir, "../..");
const apiDir = resolve(repoRoot, "apps/api");
const migrationScript = resolve(repoRoot, "scripts/ci/apply-momo-db-migrations.sh");

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

// Install once per CLI run. Keep handlers through asynchronous cleanup: a once listener
// disappears before invocation, so a later dependency's exit hook can re-send the signal.
export function createInterruptionSignal() {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (controller.signal.aborted) return;
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      controller.abort(new Error(`E2E interrupted by ${signal}.`));
    });
  }
  return controller.signal;
}

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

export async function applyMigrations(postgres, databaseName = POSTGRES_DB, signal) {
  const migrationsDir = await resolveMigrationsDir();
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

async function resolveMigrationsDir() {
  // An explicit path must not silently fall back to another schema revision.
  const explicit = process.env["MOMO_DB_MIGRATIONS_DIR"];
  const candidates = explicit
    ? [resolve(explicit)]
    : [resolve(repoRoot, "_deps/momo-db/drizzle"), resolve(repoRoot, "../momo-db/drizzle")];

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

export function startApi({ apiPort, databaseUrl, imageTmpDir, redisUrl, environment = {} }) {
  const logs = createRingBuffer(240);
  const child = spawn("sbt", ["run"], {
    cwd: apiDir,
    detached: process.platform !== "win32",
    env: childEnvironment({
      APP_ENV: "dev",
      DATABASE_URL: databaseUrl,
      DEV_MEMBER_IDS: process.env["DEV_MEMBER_IDS"] ?? DEV_MEMBER_IDS,
      HTTP_HOST: "127.0.0.1",
      HTTP_PORT: String(apiPort),
      IMAGE_TMP_DIR: imageTmpDir,
      MOMO_HTTP4S_PATCHED_VERSION: process.env["MOMO_HTTP4S_PATCHED_VERSION"],
      MOMO_LOG_FORMAT: process.env["MOMO_LOG_FORMAT"] ?? "text",
      MUTATION_RATE_LIMIT_PER_MINUTE: E2E_MUTATION_RATE_LIMIT_PER_MINUTE,
      REDIS_URL: redisUrl,
      ...environment,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = {
    code: undefined,
    signal: undefined,
    error: undefined,
  };
  child.once("error", (error) => {
    state.error = error;
  });
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

export async function waitForApi(apiProcess, url, checkpoint = () => {}) {
  const deadline = Date.now() + API_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    checkpoint();
    if (apiProcess.e2eState.error) {
      throw new Error("API process could not start.", { cause: apiProcess.e2eState.error });
    }
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

export function runPlaywrightCommand(args, options) {
  // Direct CLI ownership lets SIGINT reach Playwright's teardown without a package-manager
  // launcher forwarding the same signal a second time.
  const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  return runCommand(process.execPath, [playwrightCli, "test", ...args], {
    ...options,
    interruptSignal: "SIGINT",
  });
}

export async function stopProcessGroup(child, { signal: initialSignal = "SIGTERM" } = {}) {
  if (!child?.pid) return;
  const target = process.platform === "win32" ? child.pid : -child.pid;
  const alive = async () => {
    if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
    // macOS can report EPERM for kill(-pgid, 0) after the last live member exits.
    // Observe only the owned group; zombies have already stopped executing.
    const { stdout } = await promisify(execFile)("ps", ["-e", "-o", "pgid=,stat="]);
    return stdout.split("\n").some((line) => {
      const [group, state] = line.trim().split(/\s+/u);
      return Number(group) === child.pid && state && !state.startsWith("Z");
    });
  };
  const signal = async (value) => {
    try {
      process.kill(target, value);
    } catch (error) {
      if (error.code === "ESRCH") return;
      if (error.code === "EPERM" && !(await alive())) return;
      throw error;
    }
  };
  // Reap the owned group, including descendants whose launcher has already exited.
  // Detached groups belong to their launcher: Playwright receives SIGINT to run its teardown.
  // Arbitrary SIGKILL of that launcher is not covered by this process-group contract.
  if (!(await alive())) return;
  await signal(initialSignal);
  const deadline = Date.now() + PROCESS_STOP_TIMEOUT_MS;
  while ((await alive()) && Date.now() < deadline) await delay(100);
  if (!(await alive())) return;
  await signal("SIGKILL");
  const killDeadline = Date.now() + 2_000;
  while ((await alive()) && Date.now() < killDeadline) await delay(100);
  if (await alive()) throw new Error("An owned E2E process group did not stop.");
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

export function findFreePort() {
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

export function childEnvironment(additions) {
  const environment = {};
  for (const name of toolEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const [name, value] of Object.entries(additions)) {
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

export async function runCommand(
  command,
  args,
  { cwd, env, label, signal, interruptSignal = "SIGTERM" },
) {
  signal?.throwIfAborted();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  let stopping;
  let rejectRun;
  const interrupt = () => {
    stopping ??= stopProcessGroup(child, { signal: interruptSignal });
    void stopping.catch((error) => rejectRun?.(error));
  };
  try {
    await new Promise((resolveCommand, rejectCommand) => {
      rejectRun = rejectCommand;
      child.once("error", rejectCommand);
      child.once("exit", (code, exitSignal) => {
        if (exitSignal) rejectCommand(new Error(`${label} exited after signal ${exitSignal}.`));
        else if (code === 0) resolveCommand();
        else rejectCommand(new Error(`${label} exited with code ${code ?? "unknown"}.`));
      });
      signal?.addEventListener("abort", interrupt, { once: true });
      if (signal?.aborted) interrupt();
    });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", interrupt);
    // A launcher may exit before its browser, server, or other forked child.
    await (stopping ?? stopProcessGroup(child));
  }
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

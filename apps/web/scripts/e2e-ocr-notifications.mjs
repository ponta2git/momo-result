#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  applyMigrations,
  childEnvironment,
  findFreePort,
  runPlaywrightCommand,
  startApi,
  startPostgres,
  startRedis,
  stopProcessGroup,
  waitForApi,
} from "./e2e-isolated.mjs";
import {
  dockerFailure,
  workerTiming,
  writeImages,
  writeMinioImageContexts,
} from "./ocr-e2e-fixtures.mjs";

const execute = promisify(execFile);
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webDir, "../..");
const summitDir = resolve(process.env["MOM24_SUMMIT_DIR"] ?? join(repoRoot, "_deps/summit"));
const workerImage = process.env["MOM24_WORKER_TEST_IMAGE"];
const playwrightArgs = process.argv.slice(2).filter((value) => value !== "--hold");
if (!workerImage)
  throw new Error("MOM24_WORKER_TEST_IMAGE must identify the controlled Linux image.");
const workerImageId = (
  await execute("docker", ["image", "inspect", "--format", "{{.Id}}", workerImage])
).stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/u.test(workerImageId))
  throw new Error("Expected an immutable local Worker image identity.");
const runDir = await mkdtemp(join(tmpdir(), "mom24_e2e_"));
const controlDir = join(runDir, "control");
const recorderDir = join(runDir, "recorder");
const databaseName = "mom24_e2e";
const resources = {
  processes: [],
  containers: [],
  images: [],
  workerId: undefined,
  workerName: `mom24-e2e-${basename(runDir).toLowerCase()}`,
  workerRequested: false,
};
let interrupted;
const interruption = new AbortController();
let releaseHold;
let cleanupPromise;
remember();
function interrupt(signal) {
  interrupted = signal;
  interruption.abort(new Error(`OCR E2E interrupted by ${signal}.`));
  releaseHold?.();
}
process.once("SIGINT", () => interrupt("SIGINT"));
process.once("SIGTERM", () => interrupt("SIGTERM"));

try {
  await run();
} catch (error) {
  if (interrupted) process.exitCode = interrupted === "SIGINT" ? 130 : 143;
  else throw error;
} finally {
  await cleanup();
}
function checkpoint() {
  if (interrupted) throw new Error("Owned E2E run interrupted.");
}

async function run() {
  await mkdir(controlDir);
  const architecture = (await docker(["info", "--format", "{{.Architecture}}"])).stdout.trim();
  const minioImages = {};
  for (const { name, context } of await writeMinioImageContexts(runDir, architecture)) {
    checkpoint();
    const built = await docker(
      ["build", "--quiet", "--label", `momo.test.run=${basename(runDir)}`, context],
      { operation: `${name} fixture image`, phase: "build" },
    );
    const imageId = built.stdout.trim();
    if (!/^sha256:[0-9a-f]{64}$/u.test(imageId))
      throw new Error("Expected an immutable local MinIO fixture image identity.");
    resources.images.push(imageId);
    remember();
    minioImages[name] = imageId;
  }
  const minioClientImage = minioImages.mc;
  const images = await writeImages(runDir);
  checkpoint();
  const postgres = await startPostgres(databaseName);
  resources.containers.push(postgres);
  remember();
  checkpoint();
  const redis = await startRedis();
  resources.containers.push(redis);
  remember();
  checkpoint();
  await applyMigrations(postgres, databaseName);
  checkpoint();
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${postgres.getMappedPort(5432)}/${databaseName}`;
  const redisUrl = `redis://127.0.0.1:${redis.getMappedPort(6379)}/0`;
  const { GenericContainer, Wait } = await import("testcontainers");
  const accessKey = randomBytes(16).toString("hex");
  const secretKey = randomBytes(32).toString("hex");
  const minio = await new GenericContainer(minioImages.minio)
    .withEnvironment({
      MINIO_ROOT_USER: accessKey,
      MINIO_ROOT_PASSWORD: secretKey,
      MINIO_SITE_REGION: "auto",
    })
    .withCommand(["server", "/data", "--address", ":9000"])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000))
    .start();
  resources.containers.push(minio);
  remember();
  checkpoint();
  const bucket = "mom24-fixtures";
  const clientEnv = join(runDir, "minio-client.env");
  await writeEnvironment(clientEnv, {
    MC_HOST_fixture: `http://${accessKey}:${secretKey}@127.0.0.1:9000`,
  });
  await docker(
    [
      "run",
      "--rm",
      "--pull=never",
      "--network",
      `container:${minio.getId()}`,
      "--env-file",
      clientEnv,
      minioClientImage,
      "mb",
      `fixture/${bucket}`,
    ],
    { operation: "MinIO bucket creation", phase: "run" },
  );
  const r2 = {
    SOURCE_IMAGE_STORAGE_MODE: "r2",
    SOURCE_IMAGE_R2_ENDPOINT: `http://127.0.0.1:${minio.getMappedPort(9000)}`,
    SOURCE_IMAGE_R2_BUCKET: bucket,
    SOURCE_IMAGE_R2_ACCESS_KEY_ID: accessKey,
    SOURCE_IMAGE_R2_SECRET_ACCESS_KEY: secretKey,
    SOURCE_IMAGE_R2_REGION: "auto",
  };
  const apiPort = await findFreePort();
  let webPort = await findFreePort();
  while (webPort === apiPort) webPort = await findFreePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const token = randomBytes(32).toString("hex");
  const recorder = startProcess("node", ["scripts/dev/resultNotificationRecorder.ts"], summitDir, {
    TEST_DATABASE_URL: databaseUrl,
    MOM24_RUN_DIR: recorderDir,
    RESULT_NOTIFICATION_TOKEN: token,
    RESULT_NOTIFICATION_OPERATIONS_TOKEN: randomBytes(32).toString("hex"),
    RESULT_NOTIFICATION_WEB_ORIGIN: webOrigin,
  });
  const recorderReady = await waitForJson(join(recorderDir, "summit-ready.json"), recorder);
  const api = startApi({
    apiPort,
    databaseUrl,
    imageTmpDir: join(runDir, "images"),
    redisUrl,
    environment: r2,
  });
  resources.processes.push(api);
  remember();
  checkpoint();
  await waitForApi(api, `${apiOrigin}/healthz/details`, checkpoint);
  await runOwnedCommand("pnpm", ["build"], {
    cwd: webDir,
    env: childEnvironment({}),
    label: "Web build",
  });
  const webBuild = join(runDir, "web-dist");
  await cp(join(webDir, "dist"), webBuild, { recursive: true, force: false, errorOnExist: true });
  checkpoint();
  const web = startProcess(
    "pnpm",
    [
      "preview",
      "--outDir",
      webBuild,
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    webDir,
    { VITE_API_PROXY_TARGET: apiOrigin },
  );
  await until(async () => (await fetch(webOrigin)).ok, web, "built Web");

  const workerEnv = join(runDir, "worker.env");
  const containerHost = process.platform === "linux" ? "127.0.0.1" : "host.docker.internal";
  const workerDatabase = new URL(databaseUrl);
  workerDatabase.hostname = containerHost;
  const workerRedis = new URL(redisUrl);
  workerRedis.hostname = containerHost;
  const notificationUrl = new URL("/internal/discord-notifications", recorderReady.origin);
  notificationUrl.hostname = containerHost;
  await writeEnvironment(workerEnv, {
    ...r2,
    ...workerTiming(),
    SOURCE_IMAGE_R2_ENDPOINT:
      process.platform === "linux" ? r2.SOURCE_IMAGE_R2_ENDPOINT : "http://127.0.0.1:9000",
    ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED: "true",
    MOM24_E2E_CONTROL_DIR: "/mom24-control",
    OCR_CONTROL_SMOKE_DATABASE_URL: workerDatabase.toString(),
    OCR_CONTROL_SMOKE_REDIS_URL: workerRedis.toString(),
    RESULT_NOTIFICATIONS_MODE: "http",
    RESULT_NOTIFICATIONS_URL: notificationUrl.toString(),
    RESULT_NOTIFICATIONS_BEARER_TOKEN: token,
  });
  resources.workerRequested = true;
  remember();
  checkpoint();
  const result = await docker([
    "run",
    "--name",
    resources.workerName,
    "--detach",
    "--label",
    "momo.test=ocr-notifications",
    "--memory",
    "768m",
    "--cpus",
    "2",
    "--network",
    process.platform === "linux" ? "host" : `container:${minio.getId()}`,
    "--env-file",
    workerEnv,
    "--mount",
    `type=bind,src=${controlDir},dst=/mom24-control`,
    "--entrypoint",
    "/usr/local/bin/mom24-worker-test",
    workerImageId,
    "ocr::e2e_runtime::controlled_worker_process",
    "--ignored",
    "--exact",
    "--nocapture",
  ]);
  resources.workerId = result.stdout.trim();
  remember();
  checkpoint();
  await until(
    async () => Boolean(await readFile(join(controlDir, "process.started"))),
    undefined,
    "controlled Worker",
  );
  const metadata = {
    runnerPid: process.pid,
    runDir,
    controlDir,
    images,
    apiOrigin,
    webOrigin,
    recorderOrigin: recorderReady.origin,
    messagesFile: join(recorderDir, "summit-messages.jsonl"),
    postgresContainer: postgres.getId(),
    databaseName,
    workerContainer: resources.workerId,
    workerImageId,
    minioContainer: minio.getId(),
  };
  const metadataFile = join(runDir, "ready.json");
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Isolated OCR notification E2E ready: ${metadataFile}`);
  if (process.argv.includes("--hold")) {
    await new Promise((resolveStop) => {
      releaseHold = resolveStop;
      if (interrupted) resolveStop();
    });
    checkpoint();
  } else {
    await runPlaywrightCommand(
      ["--config", "playwright.ocr-notifications.config.ts", ...playwrightArgs],
      {
        cwd: webDir,
        env: childEnvironment({
          MOM24_E2E_METADATA: metadataFile,
          PLAYWRIGHT_BASE_URL: webOrigin,
          PLAYWRIGHT_SKIP_WEB_SERVER: "1",
        }),
        label: "OCR notification E2E",
        signal: interruption.signal,
      },
    );
  }
}

function startProcess(command, args, cwd, additions) {
  const child = spawn(command, args, {
    cwd,
    env: childEnvironment(additions),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  resources.processes.push(child);
  remember();
  checkpoint();
  // Keep errors attributable without echoing connection values or notification payloads.
  child.on("error", () => {
    child.e2eFailed = true;
    console.error(`${command} failed to start.`);
  });
  child.e2eOutput = "";
  const capture = (chunk) => {
    child.e2eOutput = (child.e2eOutput + chunk.toString()).slice(-16000);
  };
  child.stderr.on("data", capture);
  child.stdout.on("data", capture);
  return child;
}
async function waitForJson(path, child) {
  let parsed;
  await until(
    async () => {
      parsed = JSON.parse(await readFile(path, "utf8"));
      return true;
    },
    child,
    "Summit recorder",
  );
  return parsed;
}
async function until(probe, child, label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    checkpoint();
    if (child && (child.e2eFailed || child.exitCode !== null || child.signalCode !== null))
      throw new Error(`${label} exited before ready.\n${child.e2eOutput ?? ""}`);
    try {
      if (await probe()) return;
    } catch {
      /* Readiness can precede bind / file creation. */
    }
    await new Promise((resolvePoll) => {
      setTimeout(resolvePoll, 100);
    });
  }
  throw new Error(`${label} did not become ready.\n${child?.e2eOutput ?? ""}`);
}
async function writeEnvironment(path, values) {
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    { flag: "wx", mode: 0o600 },
  );
}
async function docker(args, { operation = args[0], phase = args[0], ...options } = {}) {
  try {
    return await execute("docker", args, options);
  } catch (error) {
    throw dockerFailure(operation, phase, error);
  }
}
function cleanup() {
  cleanupPromise ??= (async () => {
    const failures = [];
    if (resources.workerRequested && !resources.workerId) {
      try {
        resources.workerId =
          (
            await docker([
              "ps",
              "--all",
              "--quiet",
              "--no-trunc",
              "--filter",
              `name=^/${resources.workerName}$`,
            ])
          ).stdout.trim() || undefined;
      } catch (error) {
        failures.push(error);
      }
    }
    if (resources.workerId) {
      await writeFile(join(controlDir, "stop"), "stop\n").catch((error) => failures.push(error));
      try {
        await docker(["wait", resources.workerId], { timeout: 20_000 });
      } catch {
        await docker(["stop", "--time", "5", resources.workerId]).catch((error) =>
          failures.push(error),
        );
      }
      await docker(["rm", resources.workerId]).catch((error) => failures.push(error));
    }
    for (const child of resources.processes.toReversed())
      await stopProcessGroup(child).catch((error) => failures.push(error));
    for (const container of resources.containers.toReversed())
      await container.stop().catch((error) => failures.push(error));
    for (const image of resources.images.toReversed())
      await docker(["image", "rm", image], {
        operation: "MinIO fixture image",
        phase: "remove",
      }).catch((error) => failures.push(error));
    if (failures.length > 0)
      throw new AggregateError(failures, `E2E cleanup incomplete; ownership metadata: ${runDir}`);
    await rm(runDir, { recursive: true, force: true });
  })();
  return cleanupPromise;
}

function remember() {
  writeFileSync(
    join(runDir, "ownership.json"),
    JSON.stringify({
      runnerPid: process.pid,
      processIds: resources.processes.map((child) => child.pid),
      containerIds: resources.containers.map((container) => container.getId()),
      imageIds: resources.images,
      workerId: resources.workerId,
      workerName: resources.workerName,
      workerRequested: resources.workerRequested,
    }),
    { mode: 0o600 },
  );
}

async function runOwnedCommand(command, args, { cwd, env, label }) {
  checkpoint();
  const child = spawn(command, args, { cwd, env, detached: true, stdio: "inherit" });
  resources.processes.push(child);
  remember();
  await new Promise((resolveCommand, rejectCommand) => {
    child.once("error", rejectCommand);
    child.once("exit", (code) =>
      code === 0 ? resolveCommand() : rejectCommand(new Error(`${label} failed.`)),
    );
    const poll = setInterval(() => {
      if (interrupted) {
        clearInterval(poll);
        rejectCommand(new Error("Run interrupted."));
      }
    }, 100);
    child.once("exit", () => clearInterval(poll));
    child.once("error", () => clearInterval(poll));
  });
  checkpoint();
}

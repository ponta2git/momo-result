import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";

import {
  dockerFailure,
  workerTiming,
  writeImages,
  writeMinioImageContexts,
} from "../../apps/web/scripts/e2e/ocr-fixtures.mts";
import {
  applyMigrations,
  childEnvironment,
  configureDockerHost,
  runCommand,
  startPostgres,
  startRedis,
  stopProcessGroup,
} from "../../apps/web/scripts/e2e/runtime.mts";
import { settle } from "../../apps/web/scripts/e2e/settle.mts";
import { analysisEnvironment } from "./worker-smoke-support.mts";

const execute = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const databaseName = "mom24_e2e";
const devMembers = "member_ponta,member_akane_mami,member_otaka,member_eu";
type Cleanup = { label: string; close: () => Promise<unknown> };

/** Every owned resource is attempted, even when an earlier cleanup fails. */
export async function cleanupResources(resources: Cleanup[]) {
  const failures: string[] = [];
  for (const resource of resources.toReversed()) {
    try {
      await resource.close();
    } catch {
      failures.push(resource.label);
    }
  }
  if (failures.length) throw new Error(`System E2E cleanup failed: ${failures.join(", ")}.`);
}

export type SystemMetadata = {
  runDir: string;
  controlDir: string;
  images: Awaited<ReturnType<typeof writeImages>>;
  webOrigin: string;
  apiOrigin: string;
  sessionsFile: string;
  messagesFile: string;
  postgresContainer: string;
  databaseName: "mom24_e2e";
  workerContainer: string;
  workerImageId: string;
  runtimeImageId: string;
  minioContainer: string;
  sourceCommit: string;
  sourceDirty: boolean;
  recorderPid: number;
};

/** One fresh stack per invocation; candidates are resolved to immutable image IDs first. */
export async function withSystemEnvironment(
  { controlled = false, signal }: { controlled?: boolean; signal: AbortSignal },
  run: (metadata: SystemMetadata, metadataFile: string) => Promise<void>,
) {
  configureDockerHost();
  const runtimeImageId = await imageIdentity("MOMO_E2E_RUNTIME_IMAGE");
  const workerImageId = await imageIdentity(
    controlled ? "MOMO_E2E_CONTROLLED_WORKER_IMAGE" : "MOMO_E2E_WORKER_IMAGE",
  );
  const summitDir = resolve(process.env["MOMO_E2E_SUMMIT_DIR"] ?? join(repoRoot, "_deps/summit"));
  const pinned = (await readFile(join(repoRoot, ".summit-ref"), "utf8")).trim();
  const revision = (await execute("git", ["-C", summitDir, "rev-parse", "HEAD"])).stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(pinned) || revision !== pinned)
    throw new Error("System E2E requires the pinned Summit checkout.");
  const sourceCommit = (
    await execute("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
  const sourceDirty = Boolean(
    (await execute("git", ["status", "--porcelain"], { cwd: repoRoot })).stdout.trim(),
  );
  const runDir = await mkdtemp(join(tmpdir(), "mom24_e2e_"));
  const controlDir = join(runDir, "control");
  const recorderDir = join(runDir, "recorder");
  const resources: Cleanup[] = [];
  const ownership: {
    processIds: number[];
    containerIds: string[];
    containerNames: string[];
    imageIds: string[];
  } = { processIds: [], containerIds: [], containerNames: [], imageIds: [] };
  const remember = () =>
    writeFileSync(
      join(runDir, "ownership.json"),
      JSON.stringify({ runnerPid: process.pid, ...ownership }),
      { mode: 0o600 },
    );
  const checkpoint = () => signal.throwIfAborted();
  let phase = "prepare";
  async function ownedContainer(start: () => Promise<StartedTestContainer>) {
    checkpoint();
    const container = await start();
    ownership.containerIds.push(container.getId());
    resources.push({ label: "service container", close: () => container.stop() });
    remember();
    checkpoint();
    return container;
  }
  async function launchContainer(name: string, args: string[]) {
    checkpoint();
    ownership.containerNames.push(name);
    resources.push({
      label: "application container",
      close: async () => {
        const ids = (await docker(["ps", "-aq", "--filter", `name=^/${name}$`])).stdout.trim();
        if (!ids) return;
        if (controlled && name.includes("worker"))
          await writeFile(join(controlDir, "stop"), "stop\n");
        await docker(["stop", "--time", "15", name]);
        await docker(["rm", name]);
      },
    });
    remember();
    const id = (
      await docker(
        [
          "run",
          "--detach",
          "--name",
          name,
          "--label",
          `momo.test.run=${basename(runDir)}`,
          ...args,
        ],
        signal,
      )
    ).stdout.trim();
    ownership.containerIds.push(id);
    remember();
    return id;
  }
  try {
    remember();
    await mkdir(controlDir);
    phase = "start dependencies";
    const [postgres, redis, storage, images] = await settle([
      ownedContainer(() => startPostgres(databaseName)),
      ownedContainer(startRedis),
      prepareStorage(),
      writeImages(runDir),
    ]);
    checkpoint();
    // API object storage accepts loopback HTTP only. Sharing MinIO's network
    // namespace preserves that contract while exposing the candidate proxy on 8080.
    const webOrigin = `http://127.0.0.1:${storage.minio.getMappedPort(8080)}`;
    const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${postgres.getMappedPort(5432)}/${databaseName}`;
    const redisUrl = `redis://127.0.0.1:${redis.getMappedPort(6379)}/0`;
    phase = "migrate disposable database";
    await applyMigrations(postgres, databaseName, signal);
    phase = "prepare session fixtures";
    const sessionsFile = join(runDir, "sessions.json");
    await runCommand("sbt", ["--batch", "Test/runMain momo.api.e2e.SessionFixture"], {
      cwd: join(repoRoot, "apps/api"),
      env: childEnvironment({
        APP_ENV: "dev",
        DATABASE_URL: databaseUrl,
        DEV_MEMBER_IDS: devMembers,
        REDIS_URL: redisUrl,
        E2E_SERVICES_ARE_ISOLATED: "true",
        E2E_SESSION_FIXTURE_PATH: sessionsFile,
        MOMO_HTTP4S_PATCHED_VERSION: process.env["MOMO_HTTP4S_PATCHED_VERSION"],
      }),
      label: "System E2E session fixtures",
      signal,
    });
    phase = "start notification receiver";
    const token = randomBytes(32).toString("hex");
    const recorder = Object.assign(
      spawn("node", ["scripts/dev/resultNotificationRecorder.ts"], {
        cwd: summitDir,
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: childEnvironment({
          TEST_DATABASE_URL: databaseUrl,
          MOM24_RUN_DIR: recorderDir,
          RESULT_NOTIFICATION_TOKEN: token,
          RESULT_NOTIFICATION_OPERATIONS_TOKEN: randomBytes(32).toString("hex"),
          RESULT_NOTIFICATION_WEB_ORIGIN: webOrigin,
        }),
      }),
      { failed: false },
    );
    recorder.once("error", () => {
      recorder.failed = true;
    });
    if (recorder.pid) ownership.processIds.push(recorder.pid);
    resources.push({ label: "notification receiver", close: () => stopProcessGroup(recorder) });
    remember();
    let recorderOrigin = "";
    await until(
      async () => {
        if (recorder.failed || recorder.exitCode !== null || recorder.signalCode !== null)
          throw new Error("Notification receiver exited.");
        const parsed: unknown = JSON.parse(
          await readFile(join(recorderDir, "summit-ready.json"), "utf8"),
        );
        if (
          !parsed ||
          typeof parsed !== "object" ||
          !("origin" in parsed) ||
          typeof parsed.origin !== "string"
        )
          return false;
        const origin = new URL(parsed.origin);
        if (origin.hostname !== "127.0.0.1") return false;
        recorderOrigin = origin.origin;
        return true;
      },
      "notification receiver",
      signal,
      () => recorder.failed || recorder.exitCode !== null || recorder.signalCode !== null,
    );
    const recorderPid = recorder.pid;
    if (!recorderPid) throw new Error("Notification receiver has no owned process identity.");
    phase = "start candidate Runtime";
    const runtimeEnv = join(runDir, "runtime.env");
    await writeEnvironment(runtimeEnv, {
      APP_ENV: "dev",
      DATABASE_URL: containerURL(databaseUrl),
      REDIS_URL: containerURL(redisUrl),
      DEV_MEMBER_IDS: devMembers,
      ...storage.r2,
      SOURCE_IMAGE_R2_ENDPOINT: "http://127.0.0.1:9000",
      MUTATION_RATE_LIMIT_PER_MINUTE: "240",
      IMAGE_UPLOAD_STORAGE_MAX_USED_PERCENT: "100",
      IMAGE_UPLOAD_STORAGE_MIN_FREE_BYTES: "1",
    });
    const runtimeContainer = await launchContainer(`momo-system-runtime-${basename(runDir)}`, [
      "--network",
      `container:${storage.minio.getId()}`,
      "--memory",
      "768m",
      "--env-file",
      runtimeEnv,
      runtimeImageId,
    ]);
    await until(
      async () => {
        const response = await fetch(`${webOrigin}/healthz/details`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) return false;
        const details: unknown = await response.json();
        return (
          typeof details === "object" &&
          details !== null &&
          "database" in details &&
          details.database === "ok" &&
          "redis" in details &&
          details.redis === "ok"
        );
      },
      "candidate Runtime",
      signal,
      () => containerExited(runtimeContainer),
    );
    phase = "start candidate Worker";
    const workerHost = process.platform === "linux" ? "127.0.0.1" : "host.docker.internal";
    const notificationUrl = new URL("/internal/discord-notifications", recorderOrigin);
    notificationUrl.hostname = workerHost;
    const workerEnv = join(runDir, "worker.env");
    await writeEnvironment(workerEnv, {
      ...analysisEnvironment(
        containerURL(databaseUrl, workerHost),
        containerURL(redisUrl, workerHost),
        "momo:analysis:jobs",
        "momo-system-e2e",
        `system-${basename(runDir)}`,
      ),
      ...workerTiming(),
      ...storage.r2,
      SOURCE_IMAGE_R2_ENDPOINT:
        process.platform === "linux"
          ? storage.r2.SOURCE_IMAGE_R2_ENDPOINT
          : "http://127.0.0.1:9000",
      MOMO_ANALYSIS_RUNTIME_MEMORY_LIMIT_BYTES: "805306368",
      MOMO_ANALYSIS_CHILD_MEMORY_LIMIT_BYTES: "536870912",
      MOMO_ANALYSIS_PARENT_HEADROOM_BYTES: "268435456",
      MOMO_ANALYSIS_CONFIG_VERSION: "system-e2e-v1",
      MOMO_OCR_V2_CONSUMER_MODE: "enabled",
      RESULT_NOTIFICATIONS_MODE: "http",
      RESULT_NOTIFICATIONS_URL: notificationUrl.toString(),
      RESULT_NOTIFICATIONS_BEARER_TOKEN: token,
      ...(controlled
        ? {
            ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED: "true",
            MOM24_E2E_CONTROL_DIR: "/mom24-control",
            OCR_CONTROL_SMOKE_DATABASE_URL: containerURL(databaseUrl, workerHost),
            OCR_CONTROL_SMOKE_REDIS_URL: containerURL(redisUrl, workerHost),
          }
        : {}),
    });
    const workerContainer = await launchContainer(`momo-system-worker-${basename(runDir)}`, [
      ...(process.platform === "linux"
        ? ["--network", "host"]
        : ["--network", `container:${storage.minio.getId()}`]),
      "--memory",
      "768m",
      "--memory-swap",
      "768m",
      "--env-file",
      workerEnv,
      ...(controlled
        ? [
            "--mount",
            `type=bind,src=${controlDir},dst=/mom24-control`,
            "--entrypoint",
            "/usr/local/bin/mom24-worker-test",
            workerImageId,
            "ocr::e2e_runtime::controlled_worker_process",
            "--ignored",
            "--exact",
            "--nocapture",
          ]
        : [
            "--privileged",
            "--cgroupns",
            "private",
            "--tmpfs",
            "/var/lib/momo-analysis:rw,noexec,nosuid,size=67108864,uid=10001,gid=10001,mode=0700",
            workerImageId,
          ]),
    ]);
    await until(
      async () =>
        controlled
          ? Boolean(await readFile(join(controlDir, "process.started")))
          : (await docker(["logs", workerContainer])).stdout.includes(
              '"event":"ocr_rust_v2_worker_ready"',
            ),
      "candidate Worker",
      signal,
      () => containerExited(workerContainer),
    );
    const metadata: SystemMetadata = {
      runDir,
      controlDir,
      images,
      webOrigin,
      apiOrigin: webOrigin,
      sessionsFile,
      messagesFile: join(recorderDir, "summit-messages.jsonl"),
      postgresContainer: postgres.getId(),
      databaseName,
      workerContainer,
      workerImageId,
      runtimeImageId,
      minioContainer: storage.minio.getId(),
      sourceCommit,
      sourceDirty,
      recorderPid,
    };
    const metadataFile = join(runDir, "ready.json");
    await writeFile(metadataFile, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
    phase = "run browser suite";
    await run(metadata, metadataFile);
  } catch (error) {
    if (!signal.aborted) {
      const detail =
        error instanceof Error &&
        /^Owned E2E Docker [a-z-]+ failed \(phase=[a-z-]+, exit=(?:[0-9]+|[A-Z_]+|unknown), signal=(?:[A-Z0-9]+|none|unknown)\)\.$/u.test(
          error.message,
        )
          ? ` ${error.message}`
          : "";
      throw new Error(`System E2E failed during ${phase}.${detail}`);
    }
  } finally {
    await cleanup();
  }

  async function cleanup() {
    try {
      await cleanupResources(resources);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : "System E2E cleanup failed."} Ownership metadata: ${runDir}`,
      );
    }
    await rm(runDir, { recursive: true, force: true });
  }

  async function prepareStorage() {
    const architecture = (
      await docker(["info", "--format", "{{.Architecture}}"], signal)
    ).stdout.trim();
    const contexts = await writeMinioImageContexts(runDir, architecture);
    const imageIds: Partial<Record<"mc" | "minio", string>> = {};
    await settle(
      contexts.map(async ({ name, context }) => {
        const image = (
          await docker(
            ["build", "--quiet", "--label", `momo.test.run=${basename(runDir)}`, context],
            signal,
          )
        ).stdout.trim();
        if (!/^sha256:[0-9a-f]{64}$/u.test(image))
          throw new Error("Invalid fixture image identity.");
        ownership.imageIds.push(image);
        resources.push({
          label: "storage fixture image",
          close: () => docker(["image", "rm", image]),
        });
        imageIds[name] = image;
        remember();
      }),
    );
    if (!imageIds.minio || !imageIds.mc) throw new Error("Storage images are missing.");
    const accessKey = randomBytes(16).toString("hex"),
      secretKey = randomBytes(32).toString("hex");
    const minio = await ownedContainer(() =>
      new GenericContainer(imageIds.minio!)
        .withEnvironment({
          MINIO_ROOT_USER: accessKey,
          MINIO_ROOT_PASSWORD: secretKey,
          MINIO_SITE_REGION: "auto",
        })
        .withCommand(["server", "/data", "--address", ":9000"])
        .withExposedPorts(9000, 8080)
        .withExtraHosts(
          process.platform === "linux"
            ? [{ host: "host.docker.internal", ipAddress: "host-gateway" }]
            : [],
        )
        .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000))
        .start(),
    );
    const bucket = "mom24-fixtures";
    const environment = join(runDir, "minio-client.env");
    await writeEnvironment(environment, {
      MC_HOST_fixture: `http://${accessKey}:${secretKey}@127.0.0.1:9000`,
    });
    const clientName = `momo-system-storage-init-${basename(runDir)}`;
    ownership.containerNames.push(clientName);
    resources.push({
      label: "storage initialization",
      close: async () => {
        const id = (await docker(["ps", "-aq", "--filter", `name=^/${clientName}$`])).stdout.trim();
        if (id) await docker(["rm", "--force", id]);
      },
    });
    remember();
    await docker(
      [
        "run",
        "--name",
        clientName,
        "--label",
        `momo.test.run=${basename(runDir)}`,
        "--rm",
        "--pull=never",
        "--network",
        `container:${minio.getId()}`,
        "--env-file",
        environment,
        imageIds.mc,
        "mb",
        `fixture/${bucket}`,
      ],
      signal,
    );
    return {
      minio,
      r2: {
        SOURCE_IMAGE_STORAGE_MODE: "r2",
        SOURCE_IMAGE_R2_ENDPOINT: `http://127.0.0.1:${minio.getMappedPort(9000)}`,
        SOURCE_IMAGE_R2_BUCKET: bucket,
        SOURCE_IMAGE_R2_ACCESS_KEY_ID: accessKey,
        SOURCE_IMAGE_R2_SECRET_ACCESS_KEY: secretKey,
        SOURCE_IMAGE_R2_REGION: "auto",
      },
    };
  }
}

async function imageIdentity(variable: string) {
  const image = process.env[variable];
  if (!image) throw new Error(`${variable} must identify an already built candidate image.`);
  const id = (await docker(["image", "inspect", "--format", "{{.Id}}", image])).stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/u.test(id)) throw new Error("Invalid candidate image identity.");
  return id;
}
function containerURL(value: string, host = "host.docker.internal") {
  const url = new URL(value);
  url.hostname = host;
  return url.toString();
}
async function writeEnvironment(path: string, values: Record<string, string>) {
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    { flag: "wx", mode: 0o600 },
  );
}
async function containerExited(id: string) {
  return (await docker(["inspect", "--format", "{{.State.Running}}", id])).stdout.trim() !== "true";
}
async function until(
  probe: () => Promise<boolean>,
  label: string,
  signal: AbortSignal,
  exited: () => boolean | Promise<boolean>,
) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (await exited()) throw new Error(`${label} exited before ready.`);
    try {
      if (await probe()) return;
    } catch {
      /* A bind or owned ready file may still be pending. */
    }
    await delay(100, undefined, { signal });
  }
  throw new Error(`${label} did not become ready.`);
}
async function docker(args: string[], signal?: AbortSignal) {
  try {
    return await execute("docker", args, { signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw dockerFailure(args[0] ?? "command", args[0] ?? "command", error);
  }
}

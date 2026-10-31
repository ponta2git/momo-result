import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { dockerFailure } from "../../apps/web/scripts/e2e/ocr-fixtures.mts";
import {
  applyMigrations,
  childEnvironment,
  configureDockerHost,
  createInterruptionSignal,
  runCommand,
  startPostgres,
} from "../../apps/web/scripts/e2e/runtime.mts";
import { summitNode } from "./summit-node.mts";
import { cleanupResources } from "./system-environment.mts";

// This producer fixture changes global member names, so it owns a separate database.
const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const signal = createInterruptionSignal("Notification contract");
const consumerNode = await summitNode();
configureDockerHost();
const image = process.env["MOMO_E2E_CONTROLLED_WORKER_IMAGE"];
if (!image) throw new Error("MOMO_E2E_CONTROLLED_WORKER_IMAGE is required.");
const imageId = (
  await execute("docker", ["image", "inspect", "--format", "{{.Id}}", image])
).stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/u.test(imageId))
  throw new Error("Expected immutable Worker image identity.");
const directory = await mkdtemp(join(tmpdir(), "momo-notification-contract-"));
const name = basename(directory).toLowerCase();
const resources: Parameters<typeof cleanupResources>[0] = [
  {
    label: "contract temporary files",
    close: () => rm(directory, { recursive: true, force: true }),
  },
];
try {
  const postgres = await startPostgres("mom24_e2e");
  resources.push({ label: "contract database", close: () => postgres.stop() });
  signal.throwIfAborted();
  await applyMigrations(postgres, "mom24_e2e", signal);
  const environment = join(directory, "worker.env");
  await writeFile(
    environment,
    [
      `ANALYSIS_CONTROL_SMOKE_DATABASE_URL=postgres://postgres:postgres@host.docker.internal:${postgres.getMappedPort(5432)}/mom24_e2e`,
      "ANALYSIS_SMOKE_SERVICES_ARE_ISOLATED=true",
      "ANALYSIS_NOTIFICATION_LIMIT_FIXTURE_PATH=/notification-contract/analysis.json",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  resources.push({
    label: "contract Worker",
    close: async () => {
      const ids = (
        await execute("docker", ["ps", "-aq", "--filter", `name=^/${name}$`], {
          timeout: 20_000,
        })
      ).stdout.trim();
      if (ids) await execute("docker", ["rm", "--force", name], { timeout: 20_000 });
    },
  });
  signal.throwIfAborted();
  try {
    await execute(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--memory",
        "768m",
        "--cpus",
        "2",
        "--add-host",
        "host.docker.internal:host-gateway",
        "--env-file",
        environment,
        "--mount",
        `type=bind,src=${directory},dst=/notification-contract`,
        "--entrypoint",
        "/usr/local/bin/mom24-worker-test",
        imageId,
        "series_analysis::control::integration_tests::notifications::policy::limits::real_postgres_maximum_standard_notification_exports_consumer_fixture",
        "--ignored",
        "--exact",
      ],
      { signal, timeout: 120_000 },
    );
  } catch (error) {
    throw dockerFailure("Notification producer contract", "run", error);
  }
  await runCommand(
    consumerNode,
    [
      join(root, "apps/web/scripts/e2e/analysis-notification-contract.mts"),
      resolve(process.env["MOMO_E2E_SUMMIT_DIR"] ?? join(root, "_deps/summit")),
      join(directory, "analysis.json"),
      "http://127.0.0.1:8080",
    ],
    { cwd: root, env: childEnvironment({}), label: "Notification consumer contract", signal },
  );
} catch (error) {
  if (!signal.aborted) {
    console.error(error instanceof Error ? error.message : "Notification contract failed.");
    process.exitCode = 1;
  }
} finally {
  await cleanupResources(resources);
}

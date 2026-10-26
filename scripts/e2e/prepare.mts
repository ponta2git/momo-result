import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  childEnvironment,
  configureDockerHost,
  createInterruptionSignal,
  runCommand,
} from "../../apps/web/scripts/e2e/runtime.mts";
import { settle } from "../../apps/web/scripts/e2e/settle.mts";
import { writeSessionFixtureManifest } from "./session-fixture.mts";

// Builds the inputs of `pnpm e2e`, `pnpm e2e:recovery`, and the notification
// contract from the working tree with the same Dockerfile targets as CI.
// BuildKit reuses layers by content, so local edits are always rebuilt;
// nothing is selected by commit SHA.
const execute = promisify(execFile);
const workerDockerfile = "apps/processing-worker/Dockerfile";
const images = {
  MOMO_E2E_RUNTIME_IMAGE: { tag: "momo-e2e-runtime:local", file: "Dockerfile" },
  MOMO_E2E_WORKER_IMAGE: { tag: "momo-e2e-worker:local", file: workerDockerfile },
  MOMO_E2E_CONTROLLED_WORKER_IMAGE: {
    tag: "momo-e2e-controlled-worker:local",
    file: workerDockerfile,
    target: "e2e-test",
  },
} as const;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export async function prepareE2eInputs(repoRoot: string, signal: AbortSignal) {
  const output = join(repoRoot, "target/e2e");
  const fixture = join(output, "session-fixture");
  const environment = join(output, "prepared.env");
  const env = childEnvironment({
    BUILDX_BUILDER: process.env["BUILDX_BUILDER"],
    DOCKER_CONFIG: process.env["DOCKER_CONFIG"],
    DOCKER_CONTEXT: process.env["DOCKER_CONTEXT"],
    DOCKER_HOST: process.env["DOCKER_HOST"],
  });
  const build = (label: string, buildArgs: string[]) =>
    runCommand("docker", ["buildx", "build", ...buildArgs, "."], {
      cwd: repoRoot,
      env,
      label,
      signal,
    });
  const buildImage = async (image: { tag: string; file: string; target?: string }) => {
    await build(image.tag, [
      "--load",
      "--file",
      image.file,
      ...(image.target ? ["--target", image.target] : []),
      "--tag",
      image.tag,
    ]);
    return (
      await execute("docker", ["image", "inspect", "--format", "{{.Id}}", image.tag], {
        cwd: repoRoot,
        env,
        signal,
      })
    ).stdout.trim();
  };
  // A failed rebuild must not leave the previous inputs looking ready to use.
  await rm(environment, { force: true });
  await rm(fixture, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  // Runtime and fixture share API stages; both Worker targets share the native build.
  const [runtimeId, [workerId, controlledWorkerId]] = await settle([
    (async () => {
      const id = await buildImage(images.MOMO_E2E_RUNTIME_IMAGE);
      await build("Session fixture", [
        "--target",
        "e2e-session-fixture",
        "--output",
        `type=local,dest=${fixture}`,
      ]);
      await writeSessionFixtureManifest(fixture, id);
      return id;
    })(),
    (async () =>
      [
        await buildImage(images.MOMO_E2E_WORKER_IMAGE),
        await buildImage(images.MOMO_E2E_CONTROLLED_WORKER_IMAGE),
      ] as const)(),
  ]);
  signal.throwIfAborted();
  await writeFile(
    environment,
    Object.entries({
      MOMO_E2E_RUNTIME_IMAGE: runtimeId,
      MOMO_E2E_WORKER_IMAGE: workerId,
      MOMO_E2E_CONTROLLED_WORKER_IMAGE: controlledWorkerId,
      MOMO_E2E_SESSION_FIXTURE_DIR: fixture,
    })
      .map(([name, value]) => `export ${name}=${shellQuote(value)}\n`)
      .join(""),
  );
  console.log(`E2E inputs prepared. Load them with: source ${shellQuote(environment)}`);
}

if (import.meta.main) {
  if (process.argv.length > 2) throw new Error("Usage: pnpm e2e:prepare");
  configureDockerHost();
  await prepareE2eInputs(
    fileURLToPath(new URL("../../", import.meta.url)),
    createInterruptionSignal("E2E preparation"),
  );
}

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
if (process.argv.length > 2) throw new Error("Usage: pnpm e2e:prepare");
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
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
const output = join(repoRoot, "target/e2e");
const fixture = join(output, "session-fixture");

configureDockerHost();
const signal = createInterruptionSignal("E2E preparation");
const build = (label: string, buildArgs: string[]) =>
  runCommand("docker", ["buildx", "build", ...buildArgs, "."], {
    cwd: repoRoot,
    env: childEnvironment({
      BUILDX_BUILDER: process.env["BUILDX_BUILDER"],
      DOCKER_CONFIG: process.env["DOCKER_CONFIG"],
      DOCKER_CONTEXT: process.env["DOCKER_CONTEXT"],
      DOCKER_HOST: process.env["DOCKER_HOST"],
    }),
    label,
    signal,
  });
await rm(fixture, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// The Runtime and fixture share API stages; both Worker targets share the native build.
await settle([
  (async () => {
    const runtime = images.MOMO_E2E_RUNTIME_IMAGE;
    await build("Runtime image", ["--load", "--file", runtime.file, "--tag", runtime.tag]);
    await build("Session fixture", [
      "--target",
      "e2e-session-fixture",
      "--output",
      `type=local,dest=${fixture}`,
    ]);
    const id = (
      await execute("docker", ["image", "inspect", "--format", "{{.Id}}", runtime.tag])
    ).stdout.trim();
    await writeSessionFixtureManifest(fixture, id);
  })(),
  (async () => {
    for (const image of [images.MOMO_E2E_WORKER_IMAGE, images.MOMO_E2E_CONTROLLED_WORKER_IMAGE])
      await build(image.tag, [
        "--load",
        "--file",
        image.file,
        ...("target" in image ? ["--target", image.target] : []),
        "--tag",
        image.tag,
      ]);
  })(),
]);
const environment = join(output, "prepared.env");
await writeFile(
  environment,
  [
    ...Object.entries(images).map(([name, image]) => `export ${name}=${image.tag}`),
    `export MOMO_E2E_SESSION_FIXTURE_DIR=${fixture}`,
    "",
  ].join("\n"),
);
console.log(`E2E inputs prepared. Load them with: source ${environment}`);

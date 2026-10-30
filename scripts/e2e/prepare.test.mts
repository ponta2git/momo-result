import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { prepareE2eInputs } from "./prepare.mts";
import { verifiedSessionFixture } from "./session-fixture.mts";

const execute = promisify(execFile);
const runtimeId = `sha256:${"a".repeat(64)}`;
const workerId = `sha256:${"b".repeat(64)}`;
const controlledWorkerId = `sha256:${"c".repeat(64)}`;

test("preparation publishes sourceable, immutable inputs and invalidates them on failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "momo-prepare-"));
  const root = join(directory, "work tree's $(literal)");
  await mkdir(root);
  const previousPath = process.env.PATH;
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  t.mock.method(console, "log", () => {});
  await writeFile(
    join(directory, "docker"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "image") {
  const ids = {
    "momo-e2e-runtime:local": "${runtimeId}",
    "momo-e2e-worker:local": "${workerId}",
    "momo-e2e-controlled-worker:local": "${controlledWorkerId}",
  };
  console.log(ids[args.at(-1)]);
} else if (args[0] === "buildx") {
  if (fs.existsSync("fail-build")) process.exit(1);
  const output = args.indexOf("--output");
  if (output !== -1) {
    const destination = args[output + 1].slice("type=local,dest=".length);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "session-fixture.jar"), "fixture classes");
  }
} else process.exit(2);
`,
    { mode: 0o700 },
  );
  process.env.PATH = `${directory}:${previousPath}`;
  const signal = AbortSignal.timeout(10_000);
  await prepareE2eInputs(root, signal);
  const environment = join(root, "target/e2e/prepared.env");
  const { stdout } = await execute("sh", [
    "-c",
    '. "$1"; printf "%s\\n" "$MOMO_E2E_RUNTIME_IMAGE" "$MOMO_E2E_WORKER_IMAGE" "$MOMO_E2E_CONTROLLED_WORKER_IMAGE" "$MOMO_E2E_SESSION_FIXTURE_DIR"',
    "sh",
    environment,
  ]);
  const fixture = join(root, "target/e2e/session-fixture");
  assert.deepEqual(stdout.trimEnd().split("\n"), [
    runtimeId,
    workerId,
    controlledWorkerId,
    fixture,
  ]);
  assert.equal((await verifiedSessionFixture(fixture, runtimeId)).toString(), "fixture classes");

  await writeFile(join(root, "fail-build"), "");
  await assert.rejects(prepareE2eInputs(root, signal), /E2E preparation failed/u);
  await assert.rejects(readFile(environment), { code: "ENOENT" });
});

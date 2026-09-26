import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { childEnvironment, runPlaywrightCommand, stopProcessGroup } from "./runtime.mjs";

const require = createRequire(import.meta.url);
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// This is a runner contract: the installed CLI owns its detached webServer.
// It does not launch a browser or claim cleanup after arbitrary SIGKILL/launcher crashes.
test(
  "Playwright interruption runs teardown and stops its detached webServer",
  { skip: process.platform === "win32", timeout: 45_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "momo-playwright-interruption-"));
    const serverPidFile = join(directory, "server.pid");
    const startedFile = join(directory, "test-started");
    const teardownFile = join(directory, "teardown-completed");
    const serverFile = join(directory, "server.cjs");
    const configFile = join(directory, "playwright.config.cjs");
    const controller = new AbortController();
    let outcome;
    let serverPid;

    try {
      await Promise.all([
        writeFile(
          serverFile,
          `const { createServer } = require("node:http");
const { writeFileSync } = require("node:fs");
createServer((_request, response) => response.end("ready")).listen(0, "127.0.0.1", () => {
  writeFileSync(${JSON.stringify(serverPidFile)}, String(process.pid));
  process.stdout.write("INTERRUPTION_SERVER_READY\\n");
});
`,
        ),
        writeFile(
          join(directory, "waiting.spec.cjs"),
          `const { test } = require(${JSON.stringify(require.resolve("@playwright/test"))});
const { writeFileSync } = require("node:fs");
test("wait for parent interruption", async () => {
  writeFileSync(${JSON.stringify(startedFile)}, "running");
  await new Promise(() => {});
});
`,
        ),
        writeFile(
          join(directory, "teardown.cjs"),
          `module.exports = () => require("node:fs").writeFileSync(${JSON.stringify(teardownFile)}, "completed");\n`,
        ),
        writeFile(
          configFile,
          `module.exports = {
  testDir: ${JSON.stringify(directory)},
  testMatch: "waiting.spec.cjs",
  outputDir: ${JSON.stringify(join(directory, "results"))},
  globalTeardown: ${JSON.stringify(join(directory, "teardown.cjs"))},
  reporter: "line",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  webServer: {
    command: ${JSON.stringify(`exec ${shellQuote(process.execPath)} ${shellQuote(serverFile)}`)},
    wait: { stdout: /INTERRUPTION_SERVER_READY/u },
    timeout: 10_000,
    reuseExistingServer: false,
  },
};
`,
        ),
      ]);

      // Attach the rejection handler before signalling; a cancelled CLI must reject.
      outcome = runPlaywrightCommand(["--config", configFile], {
        cwd: webDir,
        env: childEnvironment({}),
        label: "Playwright interruption fixture",
        signal: controller.signal,
      }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      await Promise.race([
        waitForFile(startedFile, controller.signal),
        outcome.then((result) => {
          throw new Error("Playwright exited before its test started.", { cause: result.error });
        }),
      ]);
      serverPid = await readPid(serverPidFile);
      assert.ok(Number.isInteger(serverPid) && serverPid > 0, "the server reports its owned PID");
      assert.equal(await isRunning(serverPid), true, "the server must be running before abort");

      controller.abort(new Error("test interruption"));
      assert.equal((await outcome).ok, false, "interruption cannot be reported as success");
      assert.equal(await readFile(teardownFile, "utf8"), "completed");
      assert.equal(await isRunning(serverPid), false, "Playwright must stop its own webServer");
    } finally {
      controller.abort();
      try {
        await outcome;
        // exec makes the fixture's known server PID its process-group leader.
        // Recover it even if CLI startup failed before the test obtained the PID.
        serverPid ??= await readPid(serverPidFile);
        if (Number.isInteger(serverPid) && serverPid > 0) {
          await stopProcessGroup({ pid: serverPid });
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function waitForFile(path, signal) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(20, undefined, { signal });
  }
  throw new Error("Playwright did not start its interruption fixture.");
}

async function readPid(path) {
  try {
    return Number(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

async function isRunning(pid) {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-p", String(pid), "-o", "stat="]);
    return stdout.trim() !== "" && !stdout.trim().startsWith("Z");
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { applyMigrations, runCommand, startApi, stopProcessGroup, waitForApi } from "./runtime.mjs";

test(
  "interruption survives lazy dependency exit hooks and repeated signals until cleanup finishes",
  { skip: process.platform === "win32", timeout: 15_000 },
  async () => {
    const code = `
import { createInterruptionSignal } from ${JSON.stringify(new URL("./runtime.mjs", import.meta.url).href)};
import { once } from "node:events";
const interruption = createInterruptionSignal();
// Loading the real dependency after the CLI handler registers its signal-exit hook.
await import(${JSON.stringify(import.meta.resolve("testcontainers"))});
const release = once(process, "message");
process.send("ready");
await new Promise(resolve => interruption.addEventListener("abort", resolve, { once: true }));
process.send("cleaning");
await release;
process.send("cleaned");
process.disconnect();
`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      detached: true,
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const messages = [];
    child.on("message", (message) => {
      messages.push(message);
      if (message === "ready") child.kill("SIGINT");
      if (message === "cleaning") {
        child.kill("SIGINT");
        child.kill("SIGTERM");
        child.send("release cleanup");
      }
    });
    try {
      const [exitCode, signal] = await once(child, "exit");
      assert.deepEqual(messages, ["ready", "cleaning", "cleaned"]);
      assert.equal(exitCode, 130, "the first interruption remains the exit status");
      assert.equal(signal, null, "a dependency must not terminate asynchronous cleanup");
    } finally {
      await stopProcessGroup(child);
    }
  },
);

test("an explicit missing migration directory never bootstraps a different schema revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "momo-e2e-migrations-"));
  const previous = process.env["MOMO_DB_MIGRATIONS_DIR"];
  process.env["MOMO_DB_MIGRATIONS_DIR"] = join(directory, "missing");
  try {
    await assert.rejects(
      applyMigrations({
        getId() {
          throw new Error("A fallback must not reach the database bootstrap.");
        },
      }),
      /momo-db migrations directory was not found/u,
    );
  } finally {
    if (previous === undefined) delete process.env["MOMO_DB_MIGRATIONS_DIR"];
    else process.env["MOMO_DB_MIGRATIONS_DIR"] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a missing command and nonzero exit reject rather than hanging the runner", async () => {
  await assert.rejects(
    runCommand("momo-e2e-command-that-does-not-exist", [], {
      label: "missing fixture command",
    }),
    { code: "ENOENT" },
  );
  await assert.rejects(
    runCommand(process.execPath, ["-e", "process.exit(7)"], {
      label: "failed fixture command",
    }),
    /failed fixture command exited with code 7/u,
  );
});

test("API readiness observes a spawn failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "momo-e2e-process-"));
  const api = startApi({
    apiPort: 1,
    databaseUrl: "unused",
    redisUrl: "unused",
    imageTmpDir: directory,
    environment: { PATH: directory },
  });
  try {
    await assert.rejects(waitForApi(api, "http://127.0.0.1:1/healthz/details"), /could not start/u);
  } finally {
    await stopProcessGroup(api);
    await rm(directory, { recursive: true, force: true });
  }
});

// POSIX groups let a completed launcher retain ownership of its descendants.
// Windows uses single-process termination and does not provide this group contract.
for (const abort of [false, true]) {
  test(
    `owned descendants stop ${abort ? "when interrupted" : "after their launcher exits"}`,
    {
      skip: process.platform === "win32",
      timeout: 15_000,
    },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "momo-e2e-process-"));
      const ready = join(directory, "child.pid");
      const controller = new AbortController();
      const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: "ignore",
      });
      const childCode = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
      const launcherCode = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' }); ${abort ? "setInterval(() => {}, 1000);" : "child.unref(); const timer = setInterval(() => { if (require('node:fs').existsSync(process.argv[1])) { clearInterval(timer); process.exit(0); } }, 10);"}`;
      // Attach the rejection handler immediately, before driving the interruption.
      const result = runCommand(process.execPath, ["-e", launcherCode, ready], {
        label: "owned fixture launcher",
        signal: controller.signal,
      }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      try {
        const pid = await readStartedPid(ready);
        if (abort) controller.abort(new Error("test interruption"));
        const outcome = await result;
        assert.equal(outcome.ok, !abort);
        assert.equal(await isRunning(pid), false, "the owned descendant must be reaped");
        assert.equal(
          await isRunning(unrelated.pid),
          true,
          "another process group must remain alive",
        );
      } finally {
        controller.abort();
        await result;
        await stopProcessGroup(unrelated);
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

async function readStartedPid(path) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const pid = Number(await readFile(path, "utf8"));
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(20);
  }
  throw new Error("The owned child did not become ready.");
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

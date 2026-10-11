import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanups,
  command,
  eventFields,
  report,
  redisGroupDrained,
  requireSuccess,
  safeDiagnostics,
  startCommand,
  startWorker,
  waitFor,
  withCleanup,
} from "./worker-smoke-support.mts";

test("command preserves argv and exit status without publishing command diagnostics", async () => {
  const result = await command(process.execPath, [
    "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write('private diagnostic'); process.exitCode=7;",
    "a space;$(literal)",
  ]);
  assert.equal(result.code, 7);
  assert.equal(result.stdout, "a space;$(literal)");
  assert.throws(
    () => requireSuccess(result, "Fixture command"),
    /^Error: Fixture command failed\.$/,
  );
  await assert.rejects(
    command("/nonexistent-command", ["private argument"]),
    /^Error: Command could not be started\.$/,
  );
});

test("a wait deadline cancels and joins a running probe process", async () => {
  await assert.rejects(
    waitFor(
      "fixture probe",
      async (signal) => {
        await command(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
          signal,
          timeoutMs: 0,
        });
        return false;
      },
      { timeoutMs: 100 },
    ),
    /^Error: Timed out waiting for fixture probe\.$/,
  );
});

test("a terminated child is joined before its log is consumed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "momo-smoke-process-test-"));
  try {
    const log = join(directory, "process.log");
    const child = startCommand(
      process.execPath,
      ["-e", "process.stdout.write('before exit'); process.stderr.write('after stdout');"],
      { log },
    );
    requireSuccess(await child.done, "Fixture child");
    child.stop(); // stopping an already joined process is harmless
    assert.equal(readFileSync(log, "utf8"), "before exitafter stdout");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cleanup attempts every resource and preserves the original failure", async (context) => {
  const seen: string[] = [];
  context.mock.method(console, "error", () => {});
  await assert.rejects(
    withCleanup(
      async () => {
        throw new Error("original");
      },
      () =>
        cleanups([
          () => {
            seen.push("worker");
            throw new Error("cleanup");
          },
          () => {
            seen.push("database");
          },
          () => {
            seen.push("scratch");
          },
        ]),
    ),
    /^Error: original$/,
  );
  assert.deepEqual(seen, ["worker", "database", "scratch"]);
  await assert.rejects(
    withCleanup(
      async () => {},
      () =>
        cleanups([
          () => {
            throw new Error("cleanup");
          },
        ]),
    ),
    /^Error: Smoke resource cleanup failed: cleanup$/,
  );
});

test("maintenance reports reject absent, duplicated and malformed documents", () => {
  const valid = JSON.stringify({ schemaVersion: 1, planDigest: "digest", status: "running" });
  assert.equal(report(`${JSON.stringify({ event: "diagnostic" })}\n${valid}`).status, "running");
  assert.throws(() => report("{}"), /exactly one/);
  assert.throws(() => report(`${valid}\n${valid}`), /exactly one/);
  assert.throws(() => report("private malformed diagnostic"), /^Error: Invalid JSON report\.$/);
});

test("worker event diagnostics allow only bounded enum fields", () => {
  const log = [
    "unstructured private value",
    JSON.stringify({
      fields: {
        event: "analysis_command_failed",
        error: "private detail",
        reason: "postgres://private-location",
        error_kind: "connection_error",
        worker_id: "private-id",
      },
    }),
    JSON.stringify({
      fields: { event: { nested: "private value" }, reason: "private text with spaces" },
    }),
  ].join("\n");
  assert.equal(eventFields(log).length, 2);
  assert.deepEqual(safeDiagnostics(log), [
    { event: "analysis_command_failed", error_kind: "connection_error" },
  ]);
});

test(
  "deadline reaps descendants which retain pipes after their leader exits",
  { timeout: 5_000, skip: process.platform === "win32" },
  async () => {
    await assert.rejects(
      command(
        process.execPath,
        [
          "-e",
          `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], { stdio: ["ignore", "inherit", "inherit"] });
    process.exit(0);
  `,
        ],
        { timeoutMs: 300 },
      ),
      /^Error: Command timed out\.$/,
    );
  },
);

test("Redis group drain reads the redis-cli JSON object wire and rejects unknown lag", () => {
  // Captured shape from the isolated Redis 7 CLI, with only fixture identities.
  const group = {
    name: "parser-group",
    consumers: 0,
    pending: 0,
    "last-delivered-id": "0-0",
    "entries-read": null,
    lag: 0,
  };
  assert.equal(redisGroupDrained(JSON.stringify([group]), "parser-group"), true);
  assert.equal(redisGroupDrained(JSON.stringify([group]), "other-group"), false);
  assert.equal(
    redisGroupDrained(JSON.stringify([{ ...group, pending: 1 }]), "parser-group"),
    false,
  );
  assert.equal(redisGroupDrained(JSON.stringify([{ ...group, lag: null }]), "parser-group"), false);
  assert.throws(() => redisGroupDrained("[null]", "parser-group"), /Invalid Redis group fields/);
});

test("worker correlation fields are read from the current tracing span", () => {
  const [event] = eventFields(
    JSON.stringify({
      span: {
        name: "analysis_attempt",
        delivery_message_id: "1-0",
        attempt_id: "fixture-attempt",
        worker_id: "fixture-worker",
      },
      fields: { event: "analysis_child_report_accepted", artifact_payload_bytes: 128 },
    }),
  );
  assert.equal(event?.delivery_message_id, "1-0");
  assert.equal(event?.attempt_id, "fixture-attempt");
  assert.equal(event?.artifact_payload_bytes, 128);
});

test(
  "worker startup waits for container creation instead of treating absence as exit",
  { timeout: 5_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "momo-smoke-startup-test-"));
    const previousPath = process.env.PATH;
    const previousFixture = process.env.MOMO_SMOKE_FIXTURE;
    writeFileSync(
      join(directory, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  run)
    sleep 0.2
    touch "$MOMO_SMOKE_FIXTURE/ready"
    while [[ ! -f "$MOMO_SMOKE_FIXTURE/stop" ]]; do sleep 0.02; done
    ;;
  inspect)
    [[ -f "$MOMO_SMOKE_FIXTURE/ready" ]] || exit 1
    echo true
    ;;
  stop) touch "$MOMO_SMOKE_FIXTURE/stop" ;;
  rm) ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${directory}:${previousPath}`;
    process.env.MOMO_SMOKE_FIXTURE = directory;
    const worker = startWorker(
      { signal: AbortSignal.timeout(3_000), log: join(directory, "worker.log") },
      "fixture",
      "fixture-image",
      {},
    );
    try {
      await worker.ready();
      assert.equal(readFileSync(join(directory, "ready"), "utf8"), "");
    } finally {
      try {
        await worker.stop();
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        if (previousFixture === undefined) delete process.env.MOMO_SMOKE_FIXTURE;
        else process.env.MOMO_SMOKE_FIXTURE = previousFixture;
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
);

test(
  "worker cleanup joins its owned CLI even when container removal cannot start",
  { skip: process.platform === "win32", timeout: 5_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "momo-smoke-cleanup-test-"));
    const previousPath = process.env.PATH;
    const pidFile = join(directory, "worker.pid");
    const stoppedFile = join(directory, "worker.stopped");
    let pid: number | undefined;
    t.after(() => {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      try {
        if (pid !== undefined) process.kill(-pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
    writeFileSync(
      join(directory, "docker"),
      `#!${process.execPath}
const fs = require("node:fs");
switch (process.argv[2]) {
  case "run": {
    const timer = setInterval(() => {}, 1000);
    process.on("SIGTERM", () => {
      fs.writeFileSync(${JSON.stringify(stoppedFile)}, "stopped");
      clearInterval(timer);
    });
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    break;
  }
  case "inspect":
    if (!fs.existsSync(${JSON.stringify(pidFile)})) process.exit(1);
    console.log("true");
    break;
  case "stop":
    fs.unlinkSync(__filename);
    process.exit(1);
  default:
    process.exit(2);
}
`,
      { mode: 0o700 },
    );
    // An absent fixture command must not fall back to the machine's Docker.
    process.env.PATH = directory;
    const worker = startWorker(
      { signal: AbortSignal.timeout(3_000), log: join(directory, "worker.log") },
      "fixture",
      "fixture-image",
      {},
    );
    await worker.ready();
    pid = Number(readFileSync(pidFile, "utf8"));
    await assert.rejects(worker.stop(), /^Error: Command could not be started\.$/);
    assert.equal(readFileSync(stoppedFile, "utf8"), "stopped");
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  },
);

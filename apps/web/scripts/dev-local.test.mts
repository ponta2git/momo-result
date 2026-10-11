import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveDevEnvironment, waitForPersistentApi } from "./dev-local.mts";

function repos(t: TestContext) {
  const parent = mkdtempSync(join(tmpdir(), "momo-dev-environment-"));
  t.after(() => rmSync(parent, { force: true, recursive: true }));
  const repoRoot = join(parent, "momo-result");
  const sharedDbRoot = join(parent, "momo-db");
  mkdirSync(repoRoot);
  mkdirSync(sharedDbRoot);
  writeFileSync(join(repoRoot, ".env.example"), "APP_ENV=dev\nREDIS_URL=redis://example\n");
  return { repoRoot, sharedDbRoot };
}

test("development environment keeps process, root and sibling precedence", (t) => {
  const { repoRoot, sharedDbRoot } = repos(t);
  writeFileSync(join(sharedDbRoot, ".env.local"), "DIRECT_URL=postgres://shared\n");
  assert.equal(
    resolveDevEnvironment({ baseEnv: {}, repoRoot })["DATABASE_URL"],
    "postgres://shared",
  );
  writeFileSync(join(repoRoot, ".env"), "DATABASE_URL=postgres://local\nCUSTOM='quoted # value'\n");
  const env = resolveDevEnvironment({ baseEnv: { DATABASE_URL: " ", PATH: "/bin" }, repoRoot });
  assert.equal(env["DATABASE_URL"], "postgres://local");
  assert.equal(env["APP_ENV"], "dev");
  assert.equal(env["MOMO_LOG_FORMAT"], "text");
  assert.equal(env["REDIS_URL"], "redis://example");
  assert.equal(env["CUSTOM"], "quoted # value");
  assert.equal(env["PATH"], "/bin");
  // Explicit configuration must not depend on being able to read a sibling file.
  rmSync(join(sharedDbRoot, ".env.local"));
  mkdirSync(join(sharedDbRoot, ".env.local"));
  assert.equal(
    resolveDevEnvironment({ baseEnv: { DATABASE_URL: "postgres://explicit" }, repoRoot })[
      "DATABASE_URL"
    ],
    "postgres://explicit",
  );
});

test("missing database fails before launching processes", (t) => {
  const { repoRoot } = repos(t);
  assert.throws(() => resolveDevEnvironment({ baseEnv: {}, repoRoot }), /requires DATABASE_URL/u);
});

test("readiness accepts persistent API and diagnoses disabled or unavailable DB", async (t) => {
  let database = "ok";
  let status = 200;
  const server = createServer((request, response) => {
    assert.equal(request.url, "/healthz/details");
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ database }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(
    () =>
      new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const signal = new AbortController().signal;
  await waitForPersistentApi({}, address.port, signal);
  database = "disabled";
  await assert.rejects(
    waitForPersistentApi({}, address.port, signal),
    /without persistent database/u,
  );
  database = "unavailable";
  status = 503;
  await assert.rejects(waitForPersistentApi({}, address.port, signal), /db:up.*db:migrate/u);
});

test("readiness stops on API exit or cancellation", async () => {
  await assert.rejects(
    waitForPersistentApi({ result: { code: 1, signal: null } }, 8080, new AbortController().signal),
    /db:migrate/u,
  );
  const controller = new AbortController();
  controller.abort(new Error("interrupted"));
  await assert.rejects(waitForPersistentApi({}, 8080, controller.signal), /interrupted/u);
});

test("help and invalid CLI arguments exit before loading environment or starting apps", async () => {
  const script = fileURLToPath(new URL("./dev-local.mts", import.meta.url));
  const execute = promisify(execFile);
  const help = await execute(process.execPath, [script, "--help"], { cwd: tmpdir() });
  assert.match(help.stdout, /Usage: dev-local/u);
  await assert.rejects(
    execute(process.execPath, [script, "unexpected"], { cwd: tmpdir() }),
    (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, 2);
      return true;
    },
  );
});

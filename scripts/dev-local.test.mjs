import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { resolveDevEnvironment, waitForPersistentApi } from "./dev-local.mjs";

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function makeRepos() {
  const parent = mkdtempSync(join(tmpdir(), "momo-result-dev-launcher-"));
  const repoRoot = join(parent, "momo-result");
  const sharedDbRoot = join(parent, "momo-db");
  mkdirSync(repoRoot);
  mkdirSync(sharedDbRoot);
  tempRoots.push(parent);
  return { repoRoot, sharedDbRoot };
}

test("uses the shared local DB configuration without exposing it in tracked config", () => {
  const { repoRoot, sharedDbRoot } = makeRepos();
  writeFileSync(join(repoRoot, ".env.example"), "APP_ENV=dev\nREDIS_URL=redis://example\n");
  writeFileSync(join(sharedDbRoot, ".env.local"), "DIRECT_URL=postgres://local-placeholder\n");

  const env = resolveDevEnvironment({ baseEnv: { PATH: "/bin" }, repoRoot });

  assert.equal(env.APP_ENV, "dev");
  assert.equal(env.DATABASE_URL, "postgres://local-placeholder");
  assert.equal(env.REDIS_URL, "redis://example");
});

test("prefers an explicit process environment over local files", () => {
  const { repoRoot, sharedDbRoot } = makeRepos();
  writeFileSync(join(sharedDbRoot, ".env.local"), "DIRECT_URL=postgres://fallback\n");

  const env = resolveDevEnvironment({
    baseEnv: { DATABASE_URL: "postgres://explicit", PATH: "/bin" },
    repoRoot,
  });

  assert.equal(env.DATABASE_URL, "postgres://explicit");
});

test("uses a non-empty root environment when the process value is blank", () => {
  const { repoRoot, sharedDbRoot } = makeRepos();
  writeFileSync(join(repoRoot, ".env"), "DATABASE_URL=postgres://root-local\n");
  writeFileSync(join(sharedDbRoot, ".env.local"), "DIRECT_URL=postgres://shared-fallback\n");

  const env = resolveDevEnvironment({
    baseEnv: { DATABASE_URL: "", PATH: "/bin" },
    repoRoot,
  });

  assert.equal(env.DATABASE_URL, "postgres://root-local");
});

test("fails before starting an empty in-memory API when DB configuration is missing", () => {
  const { repoRoot } = makeRepos();

  assert.throws(
    () => resolveDevEnvironment({ baseEnv: { PATH: "/bin" }, repoRoot }),
    /Local development requires DATABASE_URL/u,
  );
});

test("rejects an API that reports persistent database access as disabled", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ database: "disabled" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  await assert.rejects(
    () => waitForPersistentApi({ result: undefined }, {}, { fetchImpl, timeoutMs: 100 }),
    /API started without persistent database access/u,
  );
});

test("reports the local recovery commands when the configured database is unavailable", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ database: "unavailable" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  await assert.rejects(
    () => waitForPersistentApi({ result: undefined }, {}, { fetchImpl, timeoutMs: 100 }),
    /pnpm --dir \.\.\/momo-db db:up.*pnpm --dir \.\.\/momo-db db:migrate/u,
  );
});

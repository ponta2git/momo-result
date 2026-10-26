import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  sessionFixtureJar,
  sessionFixtureManifest,
  verifiedSessionFixture,
  writeSessionFixtureManifest,
} from "./session-fixture.mts";

const runtime = `sha256:${"a".repeat(64)}`;

async function prepared() {
  const directory = await mkdtemp(join(tmpdir(), "momo-session-fixture-"));
  await writeFile(join(directory, sessionFixtureJar), "fixture classes");
  await writeSessionFixtureManifest(directory, runtime);
  return directory;
}

test("a prepared fixture runs only with the Runtime image it was built against", async (t) => {
  const directory = await prepared();
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal((await verifiedSessionFixture(directory, runtime)).toString(), "fixture classes");
  await assert.rejects(verifiedSessionFixture(directory, `sha256:${"b".repeat(64)}`));
  // A repeated preparation must not silently replace an existing record.
  await assert.rejects(writeSessionFixtureManifest(directory, runtime));
  assert.equal((await stat(join(directory, sessionFixtureManifest))).mode & 0o777, 0o644);
});

test("missing, changed, ambiguous, and linked fixture inputs are rejected", async (t) => {
  const cases: Record<string, (directory: string) => Promise<unknown>> = {
    "changed jar": (directory) => writeFile(join(directory, sessionFixtureJar), "other classes"),
    "missing jar": (directory) => rm(join(directory, sessionFixtureJar)),
    "missing manifest": (directory) => rm(join(directory, sessionFixtureManifest)),
    "malformed manifest": (directory) =>
      writeFile(join(directory, sessionFixtureManifest), "{not json"),
    "extra field": async (directory) => {
      const manifest = join(directory, sessionFixtureManifest);
      const recorded = (await readFile(manifest, "utf8")).trim();
      await writeFile(manifest, `${recorded.slice(0, -1)},"source":"local"}`);
    },
    "linked jar": async (directory) => {
      const real = join(directory, "real.jar");
      await writeFile(real, "fixture classes");
      await rm(join(directory, sessionFixtureJar));
      await symlink(real, join(directory, sessionFixtureJar));
    },
  };
  for (const [name, change] of Object.entries(cases)) {
    const directory = await prepared();
    t.after(() => rm(directory, { recursive: true, force: true }));
    await change(directory);
    await assert.rejects(verifiedSessionFixture(directory, runtime), Error, name);
  }
});

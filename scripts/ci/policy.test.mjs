import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const concurrency = Math.min(4, availableParallelism());
const shellFiles = (
  await Promise.all(
    ["scripts/ci", "scripts/ops"].map(async (directory) =>
      (await readdir(resolve(repoRoot, directory)))
        .filter((name) => name.endsWith(".sh"))
        .map((name) => `${directory}/${name}`),
    ),
  )
).flat().sort();
const contracts = shellFiles.filter((path) => path.startsWith("scripts/ci/test-"));
assert.ok(contracts.length > 0, "No shell contract suites were discovered");

// Each contract owns a temporary directory and its command doubles. Separate
// child environments keep those doubles isolated while node:test reports every
// suite's result, including failures after another suite has already failed.
describe("Workflow and operations shell syntax", { concurrency }, () => {
  for (const path of shellFiles) {
    it(path, async () => {
      await run("bash", ["-n", path], { cwd: repoRoot });
    });
  }
});

describe("Workflow and operations contracts", { concurrency }, () => {
  for (const path of contracts) {
    it(path, async (context) => {
      try {
        await run("bash", [path], { cwd: repoRoot });
      } catch (error) {
        // execFile includes stderr in the error; preserve stdout diagnostics too.
        if (error.stdout) context.diagnostic(error.stdout);
        throw error;
      }
    });
  }
});

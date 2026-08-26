import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyUiPolicyBaseline,
  collectUiPolicyViolations,
  currentUiPolicyBaseline,
  formatUiPolicyViolation,
} from "./ui-consistency-policy.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const srcRoot = path.join(webRoot, "src");

function normalizedRelativePath(filePath) {
  return path.relative(srcRoot, filePath).split(path.sep).join("/");
}

function isProductionSource(relativePath) {
  return (
    !relativePath.includes(".test.") &&
    !relativePath.startsWith("test/") &&
    !relativePath.includes("/__tests__/") &&
    relativePath !== "shared/api/generated.ts"
  );
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else if (/\.(?:css|ts|tsx)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const files = (await walk(srcRoot)).filter((filePath) =>
  isProductionSource(normalizedRelativePath(filePath)),
);
const policySources = new Map(
  await Promise.all(
    files.map(async (filePath) => [
      normalizedRelativePath(filePath),
      await readFile(filePath, "utf8"),
    ]),
  ),
);
const violations = applyUiPolicyBaseline(
  collectUiPolicyViolations(policySources),
  currentUiPolicyBaseline,
).map(formatUiPolicyViolation);

if (violations.length > 0) {
  console.error("UI consistency check failed.");
  for (const violation of [...new Set(violations)].toSorted()) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

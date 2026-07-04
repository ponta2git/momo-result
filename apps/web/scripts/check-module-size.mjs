import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const srcRoot = path.resolve("src");
const maxProductionLines = 300;

const ignoredPathFragments = [
  `${path.sep}generated.ts`,
  `${path.sep}test${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
];

function isSourceFile(filePath) {
  return filePath.endsWith(".ts") || filePath.endsWith(".tsx");
}

function isIgnored(filePath) {
  const base = path.basename(filePath);
  return (
    base.endsWith(".test.ts") ||
    base.endsWith(".test.tsx") ||
    ignoredPathFragments.some((fragment) => filePath.includes(fragment))
  );
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else if (entry.isFile() && isSourceFile(entryPath) && !isIgnored(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

const files = await walk(srcRoot);
const violations = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  const lineCount = content === "" ? 0 : content.split(/\r?\n/u).length;
  if (lineCount > maxProductionLines) {
    violations.push({
      file: path.relative(process.cwd(), file),
      lineCount,
    });
  }
}

if (violations.length > 0) {
  console.error(`Production modules must stay within ${maxProductionLines} lines.`);
  for (const violation of violations.toSorted((a, b) => b.lineCount - a.lineCount)) {
    console.error(`- ${violation.file}: ${violation.lineCount} lines`);
  }
  process.exitCode = 1;
}

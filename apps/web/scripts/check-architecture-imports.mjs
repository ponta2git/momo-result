import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "src");
const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredPathParts = new Set(["dist", "coverage", "node_modules"]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredPathParts.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
      continue;
    }
    if ([...sourceExtensions].some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }
  return files;
}

function isProductionSource(relativePath) {
  return (
    !relativePath.includes(".test.") &&
    !relativePath.startsWith("test/") &&
    !relativePath.includes("/__tests__/")
  );
}

function topLevelFeature(relativePath) {
  const segments = relativePath.split("/");
  return segments[0] === "features" ? segments[1] : undefined;
}

function layer(relativePath) {
  return relativePath.split("/")[0];
}

function importedFeature(specifier) {
  const match = /^@\/features\/([^/]+)/u.exec(specifier);
  return match?.[1];
}

function normalizedRelativePath(path) {
  return path.split("\\").join("/");
}

function resolveLocalImport(sourceFile, specifier) {
  if (specifier.startsWith("@/")) {
    return normalizedRelativePath(specifier.slice(2));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const absoluteSource = join(root, sourceFile);
    return normalizedRelativePath(
      relative(root, normalize(join(dirname(absoluteSource), specifier))),
    );
  }
  return undefined;
}

const importPattern =
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gu;

const violations = [];

for (const file of walk(root)) {
  const relativePath = relative(root, file);
  if (!isProductionSource(relativePath)) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  const sourceLayer = layer(relativePath);
  const sourceFeature = topLevelFeature(relativePath);

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? "";
    const resolvedImport = resolveLocalImport(relativePath, specifier);
    const importedLayer = resolvedImport ? layer(resolvedImport) : undefined;
    const feature = resolvedImport ? topLevelFeature(resolvedImport) : importedFeature(specifier);

    if (sourceLayer === "shared" && (feature || importedLayer === "app")) {
      violations.push(`${relativePath}: shared must not import ${specifier}`);
    }

    if (sourceLayer === "features" && importedLayer === "app") {
      violations.push(`${relativePath}: feature '${sourceFeature}' must not import ${specifier}`);
    }

    if (sourceLayer === "features" && feature && sourceFeature && feature !== sourceFeature) {
      violations.push(`${relativePath}: feature '${sourceFeature}' must not import ${specifier}`);
    }

    if (sourceLayer !== "test" && resolvedImport?.startsWith("test/")) {
      violations.push(`${relativePath}: production code must not import ${specifier}`);
    }

    if (sourceLayer !== "test" && resolvedImport?.startsWith("shared/api/msw/")) {
      violations.push(`${relativePath}: production code must not import ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture import check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

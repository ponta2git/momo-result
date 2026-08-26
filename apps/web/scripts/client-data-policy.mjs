import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredPathParts = new Set(["coverage", "dist", "node_modules"]);

function normalizedRelativePath(path) {
  return path.split("\\").join("/");
}

function isProductionSource(relativePath) {
  return (
    !relativePath.includes(".test.") &&
    !relativePath.startsWith("test/") &&
    !relativePath.includes("/__tests__/")
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredPathParts.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
      continue;
    }
    if (sourceExtensions.has(extname(path))) files.push(path);
  }
  return files;
}

function configuredValues(source, optionName) {
  const pattern = new RegExp(`\\b${optionName}\\s*:\\s*([^,\\n}]+)`, "gu");
  return [...source.matchAll(pattern)].map((match) => match[1]?.trim() ?? "");
}

function schedulesServerRefresh(callback) {
  return (
    /\b(?:fetch|fetchQuery|invalidateQueries|refetch|refetchQueries)\s*\(/u.test(callback) ||
    /\b[\w$]*(?:poll|refresh|reload)[\w$]*\b/iu.test(callback)
  );
}

function firstCallArguments(source, callPattern) {
  const argumentsList = [];
  for (const match of source.matchAll(callPattern)) {
    let cursor = (match.index ?? 0) + match[0].length;
    const start = cursor;
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;
    let quote;
    let escaped = false;

    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "(") parentheses += 1;
      else if (character === ")") {
        if (parentheses === 0 && brackets === 0 && braces === 0) break;
        parentheses -= 1;
      } else if (character === "[") brackets += 1;
      else if (character === "]") brackets -= 1;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (character === "," && parentheses === 0 && brackets === 0 && braces === 0) break;
    }
    argumentsList.push(source.slice(start, cursor));
  }
  return argumentsList;
}

/**
 * Enforces user-driven server-state refreshes in production UI code. Initial queries,
 * mutation cache invalidation, and explicit refresh/retry handlers remain valid.
 */
export function findClientDataPolicyViolations(source, relativePath = "source.ts") {
  const violations = [];

  if (/\brefetchInterval(?:InBackground)?\s*:/u.test(source)) {
    violations.push(
      `${relativePath}: query intervals are forbidden; expose an explicit refresh action`,
    );
  }

  const intervalSchedulesServerRefresh = firstCallArguments(
    source,
    /\b(?:window\.)?setInterval\s*\(/gu,
  ).some(schedulesServerRefresh);
  if (intervalSchedulesServerRefresh) {
    violations.push(
      `${relativePath}: periodic server refresh is forbidden; expose a user-triggered action`,
    );
  }

  const timeoutSchedulesServerRefresh = firstCallArguments(
    source,
    /\b(?:window\.)?setTimeout\s*\(/gu,
  ).some(schedulesServerRefresh);
  if (timeoutSchedulesServerRefresh) {
    violations.push(
      `${relativePath}: delayed server refresh is forbidden; keep timeouts presentation-only`,
    );
  }

  if (/\b(?:focusManager|onlineManager)\b/u.test(source)) {
    violations.push(
      `${relativePath}: TanStack focus/online managers must not trigger background server-state refresh`,
    );
  }

  const observesActivation =
    /addEventListener\s*\(\s*["'](?:focus|online|pageshow|visibilitychange)["']/u.test(source) ||
    /\bon(?:focus|online|pageshow|visibilitychange)\s*=/u.test(source);
  const refreshesServerState =
    /\b(?:fetch|fetchQuery|invalidateQueries|refetch|refetchQueries)\s*\(/u.test(source);
  if (observesActivation && refreshesServerState) {
    violations.push(
      `${relativePath}: focus, visibility, pageshow, and reconnect events must not refresh server state`,
    );
  }

  for (const optionName of ["refetchOnReconnect", "refetchOnWindowFocus"]) {
    for (const value of configuredValues(source, optionName)) {
      if (value !== "false") {
        violations.push(`${relativePath}: ${optionName} must be configured as false`);
      }
    }
  }

  return violations;
}

export function collectClientDataPolicyViolations(root) {
  const violations = [];
  for (const file of walk(root)) {
    const relativePath = normalizedRelativePath(relative(root, file));
    if (!isProductionSource(relativePath)) continue;
    violations.push(...findClientDataPolicyViolations(readFileSync(file, "utf8"), relativePath));
  }
  return violations;
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const srcRoot = path.join(webRoot, "src");
const interactivePrimitiveFiles = new Set([
  "shared/ui/actions/Button.tsx",
  "shared/ui/actions/IconButton.tsx",
  "shared/ui/layout/GlobalNav.tsx",
]);

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

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function addPatternViolations(violations, relativePath, source, pattern, message) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    violations.push(`${relativePath}:${lineNumberAt(source, match.index)} ${message}`);
  }
}

function hasTouchTargetContract(openingTag) {
  return /\b(?:min-h-11|size-11)\b|buttonClassName|buttonClasses/u.test(openingTag);
}

function checkInteractiveTargets(violations, relativePath, source) {
  if (interactivePrimitiveFiles.has(relativePath)) {
    return;
  }

  for (const match of source.matchAll(/<button\b[\s\S]*?>/gu)) {
    if (!hasTouchTargetContract(match[0])) {
      violations.push(
        `${relativePath}:${lineNumberAt(source, match.index)} native button must expose a 44px mobile touch target or use the shared action primitive`,
      );
    }
  }

  for (const match of source.matchAll(/<(?:Link|NavLink|a)\b[\s\S]*?>/gu)) {
    const openingTag = match[0];
    if (
      !hasTouchTargetContract(openingTag) &&
      !/\bsr-only\b/u.test(openingTag) &&
      !/buttonClassName/u.test(openingTag)
    ) {
      violations.push(
        `${relativePath}:${lineNumberAt(source, match.index)} raw link must expose a 44px mobile touch target or use LinkButton`,
      );
    }
  }
}

function checkReducedMotion(violations, relativePath, source) {
  const lines = source.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (
      /\banimate-(?:bounce|ping|pulse|spin)\b/u.test(line) &&
      !line.includes("motion-reduce:animate-none")
    ) {
      violations.push(
        `${relativePath}:${index + 1} looping animation must include motion-reduce:animate-none`,
      );
    }
    if (
      /\btransition-(?:colors|opacity|transform)\b/u.test(line) &&
      !line.includes("motion-reduce:transition-none")
    ) {
      violations.push(
        `${relativePath}:${index + 1} CSS transition must include motion-reduce:transition-none`,
      );
    }
  }
}

const files = (await walk(srcRoot)).filter((filePath) =>
  isProductionSource(normalizedRelativePath(filePath)),
);
const sources = new Map(
  await Promise.all(files.map(async (filePath) => [filePath, await readFile(filePath, "utf8")])),
);
const stylesPath = path.join(srcRoot, "styles.css");
const styles = sources.get(stylesPath) ?? "";
const definedSemanticVariables = new Set(
  [...styles.matchAll(/--((?:motion|shadow|z)-[a-z0-9-]+)\s*:/gu)].map((match) => match[1]),
);
const violations = [];

for (const [filePath, source] of sources) {
  const relativePath = normalizedRelativePath(filePath);
  addPatternViolations(
    violations,
    relativePath,
    source,
    /\bshadow-(?:2xl|lg|md|sm|xl)\b/gu,
    "use a semantic shadow token instead of a raw Tailwind shadow",
  );
  addPatternViolations(
    violations,
    relativePath,
    source,
    /\bduration-[0-9]+\b/gu,
    "use a semantic motion duration token instead of a numeric duration class",
  );
  addPatternViolations(
    violations,
    relativePath,
    source,
    /\btransition-all\b/gu,
    "transition only the properties that visibly change",
  );
  addPatternViolations(
    violations,
    relativePath,
    source,
    /\bz-(?:0|[1-9][0-9]*)\b|\bz-\[calc\(/gu,
    "use a semantic z-index token",
  );
  addPatternViolations(
    violations,
    relativePath,
    source,
    /\b(?:gap(?:-[xy])?|[mp][trblxy]?|bottom|left|right|top)-(?:1\.5|2\.5)\b/gu,
    "structural spacing must use the 4px spacing scale",
  );
  addPatternViolations(
    violations,
    relativePath,
    source,
    /\b(?:bg|border|fill|outline|ring|stroke|text)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-/gu,
    "use a semantic color token instead of a direct palette color",
  );

  for (const match of source.matchAll(/var\(--((?:motion|shadow|z)-[a-z0-9-]+)\)/gu)) {
    if (!definedSemanticVariables.has(match[1])) {
      violations.push(
        `${relativePath}:${lineNumberAt(source, match.index)} references undefined semantic token --${match[1]}`,
      );
    }
  }

  if (relativePath.endsWith(".tsx")) {
    checkInteractiveTargets(violations, relativePath, source);
    checkReducedMotion(violations, relativePath, source);
  }

  if (relativePath === "shared/ui/motion/variants.ts") {
    for (const match of source.matchAll(/\bduration:\s*([0-9]*\.?[0-9]+)/gu)) {
      if (Number(match[1]) > 0.2) {
        violations.push(
          `${relativePath}:${lineNumberAt(source, match.index)} motion duration must not exceed 200ms`,
        );
      }
    }
  }
}

for (const match of styles.matchAll(/--motion-[a-z0-9-]+:\s*([0-9]+)ms/gu)) {
  if (Number(match[1]) > 200) {
    violations.push(
      `styles.css:${lineNumberAt(styles, match.index)} motion token must not exceed 200ms`,
    );
  }
}

if (violations.length > 0) {
  console.error("UI consistency check failed.");
  for (const violation of [...new Set(violations)].toSorted()) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

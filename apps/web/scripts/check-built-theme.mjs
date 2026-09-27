import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate, parse, walk } from "css-tree";

// Consumer inventory for dynamic sequence/chart paint; exact colors belong to styles.css.
export const requiredThemeVariables = [
  ...[1, 2, 3, 4].map((sequence) => `--color-member-sequence-${sequence}`),
  ...[1, 2, 3, 4].map((playOrder) => `--color-play-order-${playOrder}`),
  ...[1, 2, 3, 4, 5, 6].map((series) => `--color-series-${series}`),
  ...[1, 2, 3, 4].map((rank) => `--color-rank-${rank}`),
  ...[1, 2, 3, 4].map((rank) => `--color-rank-${rank}-foreground`),
  "--color-chart-segment-separator",
];

// This is artifact-retention evidence for the global theme, not a CSS cascade/paint engine.
// Comments, component-local declarations and conditional rules cannot supply the baseline.
export function validateBuiltTheme(css) {
  const declarations = new Map();
  walk(parse(css, { parseCustomProperty: true }), {
    enter(node) {
      if (node.type === "Atrule" && node.name !== "layer") return this.skip;
      if (node.type !== "Rule") return;
      if (
        node.prelude.type === "SelectorList" &&
        node.prelude.children.some((selector) => generate(selector) === ":root")
      ) {
        for (const declaration of node.block.children) {
          if (declaration.type === "Declaration" && declaration.property.startsWith("--")) {
            declarations.set(declaration.property, declaration.value);
          }
        }
      }
      return this.skip;
    },
  });

  function validateVariable(name, path = []) {
    if (path.includes(name)) {
      throw new Error(`Built CSS has a cyclic theme reference: ${[...path, name].join(" -> ")}`);
    }
    const value = declarations.get(name);
    if (!value || !generate(value).trim()) {
      throw new Error(
        `Built CSS is missing a runtime theme dependency: ${[...path, name].join(" -> ")}`,
      );
    }
    validateReferences(value, [...path, name]);
  }

  function validateReferences(value, path) {
    walk(value, {
      visit: "Function",
      enter(node) {
        if (node.name !== "var") return;
        const [reference, , fallback] = node.children;
        if (declarations.has(reference.name) || !fallback) {
          validateVariable(reference.name, path);
        } else {
          validateReferences(fallback, path);
        }
        return this.skip;
      },
    });
  }

  for (const name of requiredThemeVariables) validateVariable(name);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const assetsDirectory = resolve(root, "dist/assets");
  const cssAssetNames = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".css"));
  if (cssAssetNames.length === 0) throw new Error("Built CSS asset is missing.");
  const css = await Promise.all(
    cssAssetNames.toSorted().map((name) => readFile(resolve(assetsDirectory, name), "utf8")),
  );
  validateBuiltTheme(css.join("\n"));
}

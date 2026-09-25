import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirectory = resolve(root, "dist/assets");
const assetNames = await readdir(assetsDirectory);
const cssAssetNames = assetNames.filter((name) => name.endsWith(".css"));

if (cssAssetNames.length === 0) {
  throw new Error("Built CSS asset is missing.");
}

const builtCss = (
  await Promise.all(cssAssetNames.map((name) => readFile(resolve(assetsDirectory, name), "utf8")))
).join("\n");
const requiredThemeVariables = [
  ...[1, 2, 3, 4].map((sequence) => `--color-member-sequence-${sequence}`),
  ...[1, 2, 3, 4].map((playOrder) => `--color-play-order-${playOrder}`),
  ...[1, 2, 3, 4, 5, 6].map((series) => `--color-series-${series}`),
  ...[1, 2, 3, 4].map((rank) => `--color-rank-${rank}`),
  ...[1, 2, 3, 4].map((rank) => `--color-rank-${rank}-foreground`),
  "--color-chart-segment-separator",
];
// Follow aliases in the emitted asset: retaining a semantic name is insufficient
// when its reference palette was removed or a dependency graph became cyclic.
const declarations = new Map(
  [...builtCss.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)(?=[;}])/gu)].map((match) => [
    match[1],
    match[2],
  ]),
);

function validateThemeVariable(name, path = []) {
  if (path.includes(name)) {
    throw new Error(`Built CSS has a cyclic theme reference: ${[...path, name].join(" -> ")}`);
  }
  const value = declarations.get(name);
  if (!value) {
    throw new Error(
      `Built CSS is missing a runtime theme dependency: ${[...path, name].join(" -> ")}`,
    );
  }
  for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gu)) {
    validateThemeVariable(match[1], [...path, name]);
  }
}

for (const name of requiredThemeVariables) validateThemeVariable(name);

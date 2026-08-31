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
const missingThemeVariables = requiredThemeVariables.filter(
  (name) => !builtCss.includes(`${name}:`),
);

if (missingThemeVariables.length > 0) {
  throw new Error(
    `Built CSS is missing runtime-referenced theme variables: ${missingThemeVariables.join(", ")}`,
  );
}

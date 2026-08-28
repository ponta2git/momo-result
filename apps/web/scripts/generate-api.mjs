import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "../api/openapi.yaml");
const output = resolve(root, "src/shared/api/generated.ts");
const checkOnly = process.argv.slice(2).includes("--check");

if (process.argv.length > (checkOnly ? 3 : 2)) {
  throw new Error("Usage: node scripts/generate-api.mjs [--check]");
}

async function generate() {
  const schema = JSON.parse(await readFile(source, "utf8"));
  const ast = await openapiTS(schema);
  return astToString(ast);
}

const generated = await generate();
if (checkOnly) {
  const committed = await readFile(output, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error("Generated API types are stale. Run `pnpm generate:api` and commit the result.");
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(output), { recursive: true });
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== generated) await writeFile(output, generated);
}

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "../api/openapi.yaml");
const cache = resolve(root, ".cache/openapi.json");
const output = resolve(root, "src/shared/api/generated.ts");

async function generate(input) {
  const schema = JSON.parse(await readFile(input, "utf8"));
  const ast = await openapiTS(schema);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, astToString(ast));
}

try {
  await generate(source);
} catch (error) {
  await mkdir(dirname(cache), { recursive: true });
  await copyFile(source, cache);
  try {
    await generate(cache);
  } catch (fallbackError) {
    console.error("openapi-typescript failed for both YAML and JSON fallback.");
    console.error(fallbackError);
    throw error;
  }
}

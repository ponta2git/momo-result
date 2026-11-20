import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { createInterruptionSignal, runCommand } from "../../web/scripts/process.mts";
import { childEnvironment } from "../../web/scripts/e2e/runtime.mts";

const edgeDirectory = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = join(edgeDirectory, "dist");
const signal = createInterruptionSignal("Edge build");
await rm(output, { recursive: true, force: true });
await runCommand("pnpm", ["--filter", "web", "build"], {
  cwd: repoRoot,
  label: "Web asset build",
  signal,
});
await mkdir(output, { recursive: true });
try {
  await runCommand(
    process.execPath,
    [
      fileURLToPath(new URL("bin/wrangler.js", import.meta.resolve("wrangler/package.json"))),
      "deploy",
      "--dry-run",
      "--outdir",
      join(output, "worker"),
    ],
    {
      cwd: edgeDirectory,
      label: "Edge bundle build",
      signal,
      env: childEnvironment({ WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" }),
    },
  );
  const config = JSON.parse(await readFile(join(edgeDirectory, "wrangler.json"), "utf8"));
  await cp(resolve(edgeDirectory, config.assets.directory), join(output, "assets"), {
    recursive: true,
  });
  delete config.$schema;
  await writeFile(
    join(output, "wrangler.json"),
    JSON.stringify(
      {
        ...config,
        main: "worker/index.js",
        no_bundle: true,
        assets: { ...config.assets, directory: "assets" },
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  await rm(output, { recursive: true, force: true });
  throw error;
}

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { childEnvironment, findFreePort } from "../../web/scripts/e2e/runtime.mts";
import { stopProcessGroup } from "../../web/scripts/process.mts";

/** Run the deployable bundle and its asset binding in workerd, without rebuilding it. */
export async function startEdge({
  artifactDirectory,
  apiOrigin,
  originLockToken,
  runDirectory,
  port,
  signal,
  onProcess,
}: {
  artifactDirectory: string;
  apiOrigin: string;
  originLockToken: string;
  runDirectory: string;
  port?: number;
  signal: AbortSignal;
  onProcess?: (child: ChildProcess) => void;
}) {
  signal.throwIfAborted();
  port ??= await findFreePort();
  const artifact = resolve(artifactDirectory);
  const config = JSON.parse(await readFile(join(artifact, "wrangler.json"), "utf8"));
  const localConfig = join(runDirectory, "edge-local.json");
  await writeFile(
    localConfig,
    JSON.stringify({
      ...config,
      main: resolve(artifact, config.main),
      assets: { ...config.assets, directory: resolve(artifact, config.assets.directory) },
      vars: {
        API_ORIGIN: apiOrigin,
        MOMO_ORIGIN_LOCK_TOKEN: originLockToken,
        MOMO_ALLOW_LOCAL_ORIGIN: "true",
      },
    }),
    { flag: "wx", mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("bin/wrangler.js", import.meta.resolve("wrangler/package.json"))),
      "dev",
      "--config",
      localConfig,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--log-level",
      "none",
      "--no-show-interactive-dev-session",
    ],
    {
      cwd: runDirectory,
      detached: true,
      // Wrangler's binding summary and transport errors may contain credentials.
      stdio: "ignore",
      env: childEnvironment({
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
      }),
    },
  );
  let failed = false;
  child.once("error", () => {
    failed = true;
  });
  const close = () => stopProcessGroup(child);
  const origin = `http://127.0.0.1:${port}`;
  try {
    onProcess?.(child);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (failed || child.exitCode !== null || child.signalCode !== null)
        throw new Error("Local edge exited before readiness.");
      try {
        const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(1_000) });
        await response.body?.cancel();
        if (response.ok) return { origin, close };
      } catch {
        // The local listener may still be binding.
      }
      await delay(100, undefined, { signal });
    }
    throw new Error("Local edge did not become ready.");
  } catch (error) {
    await close();
    throw error;
  }
}

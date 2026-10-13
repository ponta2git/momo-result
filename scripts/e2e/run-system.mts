import { fileURLToPath } from "node:url";

import {
  childEnvironment,
  createInterruptionSignal,
  runPlaywrightCommand,
} from "../../apps/web/scripts/e2e/runtime.mts";
import { withSystemEnvironment } from "./system-environment.mts";

const contracts = process.argv.includes("--contracts");
const controlled = contracts || process.argv.includes("--controlled");
const hold = process.argv.includes("--hold");
const args = process.argv
  .slice(2)
  .filter((arg) => arg !== "--controlled" && arg !== "--hold" && arg !== "--contracts");
const signal = createInterruptionSignal("System E2E");
try {
  await withSystemEnvironment({ controlled, signal }, async (metadata, metadataFile) => {
    console.log(`System E2E ready: ${metadataFile}`);
    if (hold) {
      await new Promise<void>((resolveStop) => {
        signal.addEventListener("abort", () => resolveStop(), { once: true });
        if (signal.aborted) resolveStop();
      });
      return;
    }
    const configs = contracts
      ? ["playwright.contracts.config.ts"]
      : controlled
        ? ["playwright.recovery.config.ts", "playwright.contracts.config.ts"]
        : ["playwright.system.config.ts"];
    for (const config of configs) {
      await runPlaywrightCommand(["--config", config, ...args], {
        cwd: fileURLToPath(new URL("../../apps/web/", import.meta.url)),
        env: childEnvironment({
          DOCKER_HOST: process.env["DOCKER_HOST"],
          DOCKER_CONTEXT: process.env["DOCKER_CONTEXT"],
          DOCKER_CERT_PATH: process.env["DOCKER_CERT_PATH"],
          DOCKER_CONFIG: process.env["DOCKER_CONFIG"],
          DOCKER_TLS_VERIFY: process.env["DOCKER_TLS_VERIFY"],
          DOCKER_API_VERSION: process.env["DOCKER_API_VERSION"],
          MOMO_E2E_METADATA: metadataFile,
          PLAYWRIGHT_BASE_URL: metadata.webOrigin,
          PLAYWRIGHT_SKIP_WEB_SERVER: "1",
        }),
        label: controlled ? "Recovery and integration contracts" : "System E2E",
        signal,
      });
    }
  });
} catch (error) {
  if (!signal.aborted) {
    console.error(error instanceof Error ? error.message : "System E2E failed.");
    process.exitCode = 1;
  }
}

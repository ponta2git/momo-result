import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectClientDataPolicyViolations } from "./client-data-policy.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "src");
const violations = collectClientDataPolicyViolations(root);

if (violations.length > 0) {
  console.error("Client data policy check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

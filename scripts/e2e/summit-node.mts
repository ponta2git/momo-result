import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

/** Keep the pinned consumer on its runtime even when the Web runner uses Node 24. */
export async function summitNode(
  executable = process.env["MOMO_E2E_SUMMIT_NODE"] ?? process.execPath,
): Promise<string> {
  if (!isAbsolute(executable))
    throw new Error("MOMO_E2E_SUMMIT_NODE must be an absolute Node.js executable path.");
  const { stdout } = await promisify(execFile)(
    executable,
    [
      "--eval",
      "console.log(JSON.stringify({version:process.versions.node,path:process.execPath}))",
    ],
    { timeout: 10_000 },
  );
  const runtime: { version: string; path: string } = JSON.parse(stdout);
  const [major, minor] = runtime.version.split(".").map(Number);
  if (major !== 26 || minor === undefined || minor < 13)
    throw new Error("Summit E2E requires Node.js 26.13.0 or newer within major 26.");
  return runtime.path;
}

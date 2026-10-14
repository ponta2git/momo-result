import { readFile } from "node:fs/promises";

import type { BrowserContext } from "@playwright/test";

import { test as base } from "../support";

export {
  expect,
  expectGeneratedId,
  expectOk,
  readJsonObject,
  selectControlOption,
} from "../support";

type SessionRole = "admin" | "operator" | "user" | "logout";

export const test = base.extend<{ sessionRole: SessionRole }>({
  sessionRole: ["admin", { option: true }],
  storageState: async ({ sessionRole }, provide) => {
    await provide(await sessionStorageState(sessionRole));
  },
});

/** Read credentials from the runner's private file without attaching that file to reports. */
export async function sessionStorageState(
  role: SessionRole,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const metadataPath = process.env["MOMO_E2E_METADATA"];
  if (!metadataPath) throw new Error("Start system tests through the isolated system runner");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    webOrigin: string;
    sessionsFile: string;
  };
  const fixture = JSON.parse(await readFile(metadata.sessionsFile, "utf8")) as {
    cookieName: string;
    sessions: Record<SessionRole, { accountId: string; cookieValue: string }>;
  };
  const session = fixture.sessions[role];
  if (!session?.cookieValue) throw new Error(`Missing ${role} session fixture`);
  return {
    cookies: [
      {
        name: fixture.cookieName,
        value: session.cookieValue,
        domain: new URL(metadata.webOrigin).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };
}

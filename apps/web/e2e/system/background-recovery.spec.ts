import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { seedConfirmedContext } from "../fixtures/records";
import { waitForAnalysisSettled } from "../support";
import { expect, expectOk, readJsonObject, test } from "./support";

const execute = promisify(execFile);

// This suite runs with one worker. Background processes are restored before fixture cleanup.
test("record editing and reading continue while the Worker and notification receiver are stopped", async ({
  e2eRun,
  page,
  request,
}) => {
  const fixture = await seedConfirmedContext(request, e2eRun);
  // This case tests independent foreground writes, not interruption of an active child.
  await waitForAnalysisSettled(request, fixture.gameTitleId);
  const metadataPath = process.env["MOMO_E2E_METADATA"];
  if (!metadataPath) throw new Error("System runner metadata is required");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    runDir: string;
    workerContainer: string;
    recorderPid: number;
  };
  const owned = JSON.parse(await readFile(join(metadata.runDir, "ownership.json"), "utf8")) as {
    processIds: number[];
    containerIds: string[];
  };
  if (
    !owned.containerIds.includes(metadata.workerContainer) ||
    !Number.isSafeInteger(metadata.recorderPid) ||
    !owned.processIds.includes(metadata.recorderPid)
  ) {
    throw new Error("Background interruption requires resources owned by this runner");
  }

  let receiverStopped = false;
  try {
    await execute("docker", ["pause", metadata.workerContainer], { timeout: 10_000 });
    process.kill(metadata.recorderPid, "SIGSTOP");
    receiverStopped = true;
    await page.goto(`/matches/${fixture.matchId}`);
    await page.getByRole("link", { name: "試合結果を編集" }).click();
    await page.getByLabel("ぽんた 総資産（万円）", { exact: true }).fill("2468");
    await page.getByRole("button", { exact: true, name: "保存" }).click();
    await expect(page).toHaveURL(`/m/${fixture.matchPublicId}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "第1試合の結果" })).toBeVisible();
    const saved = await request.get(`/api/matches/${fixture.matchId}`);
    await expectOk(saved, "record saved independently of background services");
    expect(await readJsonObject(saved)).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({ memberId: "member_ponta", totalAssetsManYen: 2468 }),
      ]),
    });
  } finally {
    await restoreBackground(metadata, receiverStopped);
    await waitForAnalysisSettled(request, fixture.gameTitleId);
  }
});

async function restoreBackground(
  metadata: { workerContainer: string; recorderPid: number },
  receiverStopped: boolean,
) {
  // Attempt both even when one service cannot resume.
  const results = await Promise.allSettled([
    (async () => {
      const state = await execute(
        "docker",
        ["inspect", "--format", "{{.State.Paused}}", metadata.workerContainer],
        { timeout: 10_000 },
      );
      if (state.stdout.trim() === "true") {
        await execute("docker", ["unpause", metadata.workerContainer], { timeout: 10_000 });
      }
    })(),
    Promise.resolve().then(() => {
      if (receiverStopped) process.kill(metadata.recorderPid, "SIGCONT");
      return undefined;
    }),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Could not resume all owned background services after recovery verification");
  }
}

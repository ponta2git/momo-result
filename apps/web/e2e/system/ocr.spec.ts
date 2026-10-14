import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import type { components } from "../../src/shared/api/generated";
import { seedHeldEventContext } from "../fixtures/records";
import { postJson } from "../support";
import {
  expect,
  expectGeneratedId,
  expectOk,
  readJsonObject,
  selectControlOption,
  test,
} from "./support";

test("reads an uploaded image with the native Worker, corrects it and saves the result", async ({
  page,
  request,
  e2eRun,
}) => {
  await enableNotifications(page);
  const fixture = await seedHeldEventContext(request, e2eRun);
  const alias = await postJson(request, e2eRun, "/api/member-aliases", {
    memberId: "member_akane_mami",
    alias: "さくま社長",
  });
  e2eRun.trackAlias(expectGeneratedId(alias["id"], "OCR fixture alias"));
  const expected = JSON.parse(
    await readFile(new URL("../fixtures/ocr/expected.json", import.meta.url), "utf8"),
  ) as {
    players: Array<{ name: string; rank: number; playOrder: number; totalAssetsManYen: number }>;
  };

  await page.goto(`/ocr/new?heldEventId=${fixture.heldEventId}`);
  for (const [name, value] of [
    [/^作品/u, fixture.gameTitleId],
    [/^シーズン/u, fixture.seasonMasterId],
    [/^マップ/u, fixture.mapMasterId],
  ] as const)
    await selectControlOption(page, page.getByRole("combobox", { name }), value);
  await page
    .getByLabel("OCRの画像をアップロード")
    .setInputFiles(fileURLToPath(new URL("../fixtures/ocr/total-assets.png", import.meta.url)));
  await expect(page.getByAltText("総資産プレビュー")).toBeVisible();
  await page.getByRole("button", { name: "1件で読み取りを開始" }).click();
  const admission = page.waitForResponse(
    (response) =>
      response.url().includes("/api/ocr-submissions/") && response.request().method() === "PUT",
  );
  const jobCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/ocr-jobs") && response.request().method() === "POST",
  );
  await page
    .getByRole("dialog", { name: "読み取りを開始しますか？" })
    .getByRole("button", { name: "1件で読み取りを開始" })
    .click();
  const response = await admission;
  await expectOk(response, "admit native OCR operation");
  const body = await readJsonObject(response);
  const draftId = expectGeneratedId(body["matchDraftId"], "native OCR draft");
  e2eRun.trackDraft(draftId);
  const jobResponse = await jobCreated;
  await expectOk(jobResponse, "enqueue native OCR job");
  const jobId = expectGeneratedId((await readJsonObject(jobResponse))["jobId"], "native OCR job");
  let jobStatus = "";
  await expect
    .poll(
      async () => {
        const job = await request.get(`/api/ocr-jobs/${jobId}`);
        await expectOk(job, "read native OCR job status");
        jobStatus = ((await job.json()) as components["schemas"]["OcrJobResponse"]).status;
        return ["succeeded", "needs_review", "failed"].includes(jobStatus);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(["succeeded", "needs_review"]).toContain(jobStatus);
  const reviewPath = `/api/match-drafts/${draftId}/review`;
  const review = (await (
    await request.get(reviewPath)
  ).json()) as components["schemas"]["MatchDraftReviewResponse"];
  const payload = review.ocrDrafts?.find((draft) => draft.requestedScreenType === "total_assets")
    ?.payloadJson as {
    players: Array<{
      raw_player_name: { value: string };
      rank: { value: number };
      play_order: { value: number };
      total_assets_man_yen: { value: number };
    }>;
  };
  expect(
    payload.players.map((player) => ({
      name: player.raw_player_name.value,
      rank: player.rank.value,
      playOrder: player.play_order.value,
      totalAssetsManYen: player.total_assets_man_yen.value,
    })),
  ).toEqual(expected.players);

  const metadataPath = process.env["MOMO_E2E_METADATA"];
  if (!metadataPath) throw new Error("Missing isolated system metadata");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    messagesFile: string;
    webOrigin: string;
  };
  let notificationLink: string | undefined;
  await expect
    .poll(
      async () => {
        const lines = await readFile(metadata.messagesFile, "utf8");
        const messages = lines
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { body: { content: string } })
          .filter((message) => message.body.content.includes(`/review/${draftId}`));
        notificationLink = messages[0]?.body.content
          .match(/https?:\/\/[^\s<>)]+/gu)
          ?.find((link) => new URL(link).pathname === `/review/${draftId}`);
        return messages.length;
      },
      { timeout: 45_000 },
    )
    .toBe(1);
  if (!notificationLink) throw new Error("Notification did not contain a review link");
  expect(new URL(notificationLink).origin).toBe(metadata.webOrigin);
  await page.goto(notificationLink);
  await expect(page.getByLabel("ぽんた 総資産（万円）", { exact: true })).toHaveValue("400");
  await page.getByLabel("ぽんた 総資産（万円）", { exact: true }).fill("450");
  await page.getByRole("button", { name: "確定前の確認へ進む" }).click();
  const confirmation = page.waitForResponse(
    (value) => value.url().endsWith("/api/matches") && value.request().method() === "POST",
  );
  await page
    .getByRole("dialog", { name: "この内容で確定しますか？" })
    .getByRole("button", { name: "確定する" })
    .click();
  const confirmed = await confirmation;
  await expectOk(confirmed, "confirm native OCR result");
  const matchId = expectGeneratedId(
    (await readJsonObject(confirmed))["matchId"],
    "native OCR match",
  );
  e2eRun.trackMatch(matchId);
  await expect(page).toHaveURL(`/matches/${matchId}`);
  await page.reload();
  await expect(page.getByRole("region", { name: "順位・総資産" })).toBeVisible();
  const saved = await request.get(`/api/matches/${matchId}`);
  await expectOk(saved, "read persisted OCR match");
  const result = (await saved.json()) as components["schemas"]["MatchDetailResponse"];
  expect(result.heldEventId).toBe(fixture.heldEventId);
  expect(
    result.players?.map((player) => ({
      memberId: player.memberId,
      rank: player.rank,
      totalAssetsManYen: player.totalAssetsManYen,
    })),
  ).toEqual([
    { memberId: "member_ponta", rank: 1, totalAssetsManYen: 450 },
    { memberId: "member_otaka", rank: 2, totalAssetsManYen: 300 },
    { memberId: "member_eu", rank: 3, totalAssetsManYen: 200 },
    { memberId: "member_akane_mami", rank: 4, totalAssetsManYen: 100 },
  ]);
});

async function enableNotifications(page: Page) {
  await page.goto("/admin/masters");
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "OCR完了", exact: true });
  for (const enabled of [false, true]) {
    if ((await checkbox.isChecked()) === enabled) continue;
    await checkbox.setChecked(enabled);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    if (!enabled)
      await page.getByRole("alertdialog").getByRole("button", { name: "OFFにして保存" }).click();
    await expect(page.getByText("通知設定を保存しました。", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "通知", exact: true }).click();
    await expect(checkbox).toBeChecked({ checked: enabled });
  }
}

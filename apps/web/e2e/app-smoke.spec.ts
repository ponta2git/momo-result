import { readFile } from "node:fs/promises";

import type { Locator, Page, Response } from "@playwright/test";

import { formatDateTimeLong } from "../src/shared/lib/dateTime";
import { withReturnTo } from "../src/shared/navigation/returnTo";
import { seedConfirmedContext, seedHeldEventContext, seedMasterContext } from "./fixtures/records";
import {
  continueWithE2eAuth,
  continueWithE2eNonAdminAuth,
  selectControlOption,
  expect,
  expectGeneratedId,
  expectOk,
  installE2eAuthHeaders,
  readJsonObject,
  test,
} from "./support";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installE2eAuthHeaders(page);
});

test("creates a held event and accepts an OCR upload", async ({ e2eRun, page, request }) => {
  const { gameTitleId, mapMasterId, seasonMasterId } = await seedMasterContext(request, e2eRun);
  let heldEventId = "";
  let heldEventLabelPrefix = "";
  let uploadedDraftId = "";

  await test.step("create a held event after dev login", async () => {
    await page.goto("/held-events");

    await expect(page.getByRole("region", { exact: true, name: "開催履歴" })).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/held-events") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^(?:最初の)?開催を作成$/u }).click();
    const createDialog = page.getByRole("dialog", { name: "新しい開催を作成" });
    await expect(createDialog).toBeVisible();
    const heldEventLocalDateTime = e2eRun.uniqueLocalDateTime();
    await createDialog.getByLabel("開催日時").fill(heldEventLocalDateTime);
    await createDialog.getByRole("button", { exact: true, name: "開催を作成" }).click();

    const response = await createResponse;
    expect(response.ok()).toBe(true);
    const body = await readJsonObject(response);
    heldEventId = expectGeneratedId(body["id"], "held event ID");
    if (typeof body["heldAt"] !== "string") throw new TypeError("Missing held event timestamp");
    heldEventLabelPrefix = formatDateTimeLong(body["heldAt"]);
    e2eRun.trackHeldEvent(heldEventId);
    const heldEventDetailHref = withReturnTo(`/held-events/${heldEventId}`, "/held-events");
    await expect(page).toHaveURL(heldEventDetailHref);
    await expect(page.getByText("確定済み0試合・未確定下書き0件", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, level: 2, name: "第1試合を記録" }),
    ).toBeVisible();

    const manualLink = page.getByRole("link", { exact: true, name: "手入力" });
    await expect(manualLink).toHaveCount(1);
    await expect(manualLink).toHaveAttribute(
      "href",
      withReturnTo(`/matches/new?heldEventId=${heldEventId}`, currentPagePath(page)),
    );
    const ocrLink = page.getByRole("link", { exact: true, name: "OCR取り込み" });
    await expect(ocrLink).toHaveCount(1);
    await expect(ocrLink).toHaveAttribute(
      "href",
      withReturnTo(`/ocr/new?heldEventId=${heldEventId}`, currentPagePath(page)),
    );
  });

  await test.step("open OCR for this run's held event from held-event history", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/held-events");
    await expect(page.getByRole("region", { exact: true, name: "開催履歴" })).toBeVisible();

    const expectedOcrHref = withReturnTo(`/ocr/new?heldEventId=${heldEventId}`, "/held-events");
    const heldEventOcrLink = page.getByRole("link", {
      exact: true,
      name: `${heldEventLabelPrefix}の開催にOCR取り込み`,
    });
    await expect(heldEventOcrLink).toHaveCount(1);
    await expect(heldEventOcrLink).toHaveAttribute("href", expectedOcrHref);
    await expect(heldEventOcrLink).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await expect(heldEventOcrLink).toBeVisible();
    await heldEventOcrLink.click();

    await expect(page).toHaveURL(expectedOcrHref);
    await expect(page.getByRole("region", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await expect(page.getByText(/— 確定済み0試合・未確定下書き0件$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "開催（任意）を変更" })).toBeVisible();
    await expect(page.getByLabel("試合番号")).toHaveValue("1");

    const cancelOcrLink = page.getByRole("link", { exact: true, name: "取り込みをやめる" });
    await expect(cancelOcrLink).toHaveAttribute("href", "/held-events");
    await cancelOcrLink.click();
    await expect(page).toHaveURL("/held-events");
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  await test.step("start an OCR job from an uploaded image", async () => {
    await page.goto(`/ocr/new?heldEventId=${heldEventId}`);

    await expect(page.getByRole("region", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await selectSeedMasters(page, { gameTitleId, mapMasterId, seasonMasterId });

    await page.getByLabel("OCRの画像をアップロード").setInputFiles({
      buffer: png1x1,
      mimeType: "image/png",
      name: "total-assets.png",
    });
    await expect(page.getByAltText("総資産プレビュー")).toBeVisible();
    const trayFeedback = page.getByRole("status", { name: "分類トレイの操作結果" });
    await expect(trayFeedback).toContainText("総資産に画像を配置しました。");
    const startButton = page.getByRole("button", { name: "1件で読み取りを開始" });
    await expect(startButton).toBeEnabled();

    const draftResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/match-drafts") && response.request().method() === "POST",
    );
    const jobResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/ocr-jobs") && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "1件で読み取りを開始" }).click();
    const startDialog = page.getByRole("dialog", { name: "読み取りを開始しますか？" });
    await expect(startDialog).toBeVisible();
    await expect(startDialog.getByText("1件だけで開始します")).toBeVisible();
    await startDialog.getByRole("button", { name: "1件で読み取りを開始" }).click();

    const draftCreateResponse = await draftResponse;
    await expectOk(draftCreateResponse, "create uploaded OCR draft");
    const draftBody = await readJsonObject(draftCreateResponse);
    uploadedDraftId = expectGeneratedId(draftBody["matchDraftId"], "match draft ID");
    expect(draftCreateResponse.request().postDataJSON()).toMatchObject({ heldEventId });
    e2eRun.trackDraft(uploadedDraftId);

    await expectOk(await jobResponse, "create OCR job");
    await expect(page).toHaveURL(`/held-events/${heldEventId}`);
    await expect(page.getByText("確定済み0試合・未確定下書き1件", { exact: true })).toBeVisible();
  });
});

// The dev sample tests review editing and persisted confirmation, not the OCR worker.
test("confirms sample review and reads its persisted match from the held event", async ({
  e2eRun,
  page,
  request,
}) => {
  const {
    gameTitleId,
    gameTitleName,
    mapMasterId,
    seasonMasterId,
    heldEventId,
    heldEventLabelPrefix,
  } = await seedHeldEventContext(request, e2eRun);
  let matchId = "";
  await test.step("confirm the sample review into a match detail", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/review/dev-sample?sample=1");

    await expect(page.getByRole("region", { exact: true, name: "試合内容" })).toBeVisible();
    await expect(page.getByText("サンプルの読み取り結果で表示中")).toBeVisible();
    const reviewRail = page.getByLabel("OCRの確認項目");
    await expect(reviewRail.getByText("未確認2件／全2件")).toBeVisible();
    await page.setViewportSize({ height: 844, width: 390 });
    await reviewRail.getByRole("button", { name: "次の要確認セルへ" }).click();
    const member = page.getByRole("combobox", { name: /^メンバー/u });
    await expect(page.getByLabel("ぽんた 順位", { exact: true })).not.toBeVisible();
    await expect(member).toBeFocused();
    await expect(member).toBeInViewport();
    await reviewRail.getByRole("button", { name: "次の要確認セルへ" }).click();
    await expect(page.getByLabel("あかねまみ 順位", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("おーたか 順位", { exact: true })).toBeInViewport();
    await reviewRail.getByRole("button", { name: "前の要確認セルへ" }).click();
    await expect(member).toBeFocused();
    await expect(member).toBeInViewport();
    await reviewRail.getByRole("button", { name: "この値で確認済み" }).click();
    await expect(reviewRail.getByText("未確認1件／全2件")).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await reviewRail.getByRole("button", { name: "次の要確認セルへ" }).click();
    await expect(page.getByLabel("おーたか 順位")).toBeFocused();
    await expect(page.getByLabel("おーたか 順位", { exact: true })).toBeInViewport();
    await page.setViewportSize({ height: 900, width: 1440 });

    await page.getByRole("button", { name: "開催（必須）を変更" }).click();
    const heldEventDialog = page.getByRole("dialog", { name: "開催を選択" });
    await expect(heldEventDialog.getByRole("group", { name: "開催を選択" })).toBeVisible();
    await selectDialogRadio(heldEventDialog, new RegExp(`^${heldEventLabelPrefix}$`, "u"));
    await expect(page.getByText(new RegExp(`^${heldEventLabelPrefix} —`, "u"))).toBeVisible();
    await selectSeedMasters(page, { gameTitleId, mapMasterId, seasonMasterId });

    const confirmResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/matches") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "確定前の確認へ進む" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "この内容で確定しますか？" }),
    ).toBeVisible();
    const confirmDialog = page.getByRole("dialog", { name: "この内容で確定しますか？" });
    await expect(confirmDialog.getByRole("table", { name: "確定する4人分の結果" })).toBeVisible();
    await expect(confirmDialog.getByText("確認済み1件／全2件")).toBeVisible();
    await expect(confirmDialog.getByText(/未確認の強調項目が1件あります/u)).toBeVisible();
    await page.getByRole("button", { name: "確定する" }).click();

    const response = await confirmResponse;
    await expectOk(response, "confirm reviewed match");
    const body = await readJsonObject(response);
    matchId = expectGeneratedId(body["matchId"], "match ID");
    e2eRun.trackMatch(matchId);

    await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`, "u"));
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
    await expect(page.getByText(gameTitleName, { exact: true })).toBeVisible();
    await page.setViewportSize({ height: 900, width: 1440 });
    const resultLedgerCard = page.getByRole("region", { name: "順位・総資産" });
    await expect(resultLedgerCard).toBeVisible();
    const resultLedger = resultLedgerCard.getByRole("list", { name: "試合の順位と成績" });
    await expect(resultLedger).toBeVisible();
    const firstPlaceLedgerRow = resultLedgerCard
      .getByRole("listitem")
      .filter({ hasText: "ぽんた" });
    await expect(firstPlaceLedgerRow.getByText("1位", { exact: true })).toBeVisible();
    await expect(firstPlaceLedgerRow.getByText("総資産", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "この開催へ戻る" }).click();
    await expect(page).toHaveURL(`/held-events/${heldEventId}`);
    await expect(page.getByRole("heading", { exact: true, name: "この開催の戦績" })).toBeVisible();
    const eventMatchLink = page.getByRole("link", { name: /第\d+試合の結果を見る/u });
    const matchFromHeldEventHref = withReturnTo(`/matches/${matchId}`, currentPagePath(page));
    await expect(eventMatchLink).toHaveAttribute("href", matchFromHeldEventHref);
    await expect(page.getByRole("link", { name: /第\d+試合を戦績比較で見る/u })).toBeVisible();
    await eventMatchLink.click();
    await expect(page).toHaveURL(matchFromHeldEventHref);
  });
});

test("creates a member alias through administration", async ({ e2eRun, page }) => {
  const aliasName = `E2E-${e2eRun.masterIdSuffix}`;

  await page.goto("/admin/masters");
  await page.getByRole("tab", { name: "メンバー名寄せ" }).click();

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/member-aliases") && response.request().method() === "POST",
  );
  const createForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "追加" }) });
  await createForm.locator('input[name="alias"]').fill(aliasName);
  await createForm.getByRole("button", { name: "追加" }).click();

  const response = await createResponse;
  expect(response.ok()).toBe(true);
  const body = await readJsonObject(response);
  e2eRun.trackAlias(expectGeneratedId(body["id"], "member alias ID"));
  await expect(page.getByText(aliasName, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "メンバー名寄せ" }).click();
  await expect(page.getByText(aliasName, { exact: true })).toBeVisible();
});

test("runs analysis administration and enforces access", async ({ e2eRun, page, request }) => {
  const { gameTitleId } = await seedMasterContext(request, e2eRun);

  await test.step("run analysis administration and enforce admin access", async () => {
    await page.goto("/admin/analysis");
    await expect(page.getByRole("region", { exact: true, name: "戦績分析管理" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "全体の実行状況" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "直近10件" })).toBeVisible();

    const titleSelect = page.getByRole("combobox", { name: "対象作品" });
    await selectControlOption(page, titleSelect, gameTitleId);

    const titleResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/series-analysis/recalculations") &&
        !response.url().endsWith("/all") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "この作品を再計算" }).click();
    const acceptedTitleResponse = await titleResponse;
    expect(acceptedTitleResponse.status()).toBe(202);
    expect(acceptedTitleResponse.request().postDataJSON()).toEqual({ gameTitleId });

    await page.getByRole("button", { name: "全作品を再計算" }).click();
    const allDialog = page.getByRole("alertdialog", {
      name: "全作品の再計算を予約しますか？",
    });
    await expect(allDialog).toContainText(/作品を対象として予約します/u);
    const allResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/series-analysis/recalculations/all") &&
        response.request().method() === "POST",
    );
    await allDialog.getByRole("button", { name: "全作品を再計算" }).click();
    const acceptedAllResponse = await allResponse;
    expect(acceptedAllResponse.status()).toBe(202);
    expect(acceptedAllResponse.request().postDataJSON()).toEqual({
      confirmation: "all_titles",
    });

    await page.setViewportSize({ height: 844, width: 390 });

    await page.route("**/api/**", continueWithE2eNonAdminAuth);
    await page.goto("/admin/analysis");
    await expect(page.getByRole("region", { name: "管理者権限が必要です" })).toBeVisible();
    await expect(page.getByRole("button", { name: "この作品を再計算" })).toHaveCount(0);
    await page.unroute("**/api/**", continueWithE2eNonAdminAuth);
    await page.setViewportSize({ height: 900, width: 1440 });
  });
});

test("filters and opens a confirmed match", async ({ e2eRun, page, request }) => {
  const { gameTitleName, heldEventId, heldEventLabelPrefix, matchId } = await seedConfirmedContext(
    request,
    e2eRun,
  );

  await test.step("filter and sort the confirmed match list", async () => {
    expectGeneratedId(heldEventId, "held event ID");
    expectGeneratedId(matchId, "match ID");

    await page.goto("/matches");

    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();

    const statusResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isMatchListResponse(response) &&
        url.searchParams.get("status") === "confirmed" &&
        url.searchParams.get("heldEventId") === null
      );
    });
    const statusSelect = page.getByRole("combobox", { exact: true, name: "確定状況" });
    await expect(statusSelect).toBeEnabled();
    await selectControlOption(page, statusSelect, "confirmed");
    expect((await statusResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]status=confirmed(?:&|$)/u);

    const heldEventResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return isMatchListResponse(response) && url.searchParams.get("heldEventId") === heldEventId;
    });
    await page.getByText("詳細条件", { exact: true }).click();
    const heldEventPicker = page.getByRole("button", { name: "開催を変更" });
    await expect(heldEventPicker).toBeEnabled();
    await heldEventPicker.click();
    await selectDialogRadio(
      page.getByRole("dialog", { name: "開催を選択" }),
      new RegExp(`^${heldEventLabelPrefix}$`, "u"),
    );
    expect((await heldEventResponse).ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`[?&]heldEventId=${heldEventId}(?:&|$)`, "u"));
    const confirmedMatchRow = matchTableRow(page, matchId);
    await expect(confirmedMatchRow).toBeVisible();
    await expect(confirmedMatchRow.getByText(gameTitleName)).toBeVisible();

    const sortResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isMatchListResponse(response) &&
        url.searchParams.get("heldEventId") === heldEventId &&
        url.searchParams.get("sort") === "updated_desc"
      );
    });
    const sortSelect = page.getByRole("combobox", { name: "並び順" });
    await expect(sortSelect).toBeEnabled();
    await selectControlOption(page, sortSelect, "updated_desc");
    expect((await sortResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]sort=updated_desc(?:&|$)/u);

    await selectControlOption(page, sortSelect, "held_desc");
    await expect(sortSelect).toHaveText("開催が新しい順");
    await expect(page).not.toHaveURL(/[?&]sort=/u);
    await expect(confirmedMatchRow).toBeVisible();
  });

  await test.step("open match detail immediately with a loading shell from the list", async () => {
    expectGeneratedId(heldEventId, "held event ID");
    expectGeneratedId(matchId, "match ID");

    let releaseDetailResponse!: () => void;
    let detailApiRequested = false;
    const detailHold = new Promise<void>((resolve) => {
      releaseDetailResponse = resolve;
    });
    const detailUrlPattern = `**/api/matches/${matchId}`;
    await page.route(detailUrlPattern, async (route) => {
      if (route.request().method() !== "GET") {
        await continueWithE2eAuth(route);
        return;
      }

      detailApiRequested = true;
      await detailHold;
      await continueWithE2eAuth(route);
    });

    try {
      await page.goto(`/matches?status=confirmed&heldEventId=${heldEventId}`);

      await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
      const detailLink = matchDetailLink(page, matchId);
      await expect(detailLink).toHaveCount(1);
      await expect(detailLink).toBeVisible();
      const matchFromListHref = withReturnTo(`/matches/${matchId}`, currentPagePath(page));
      await expect(detailLink).toHaveAttribute("href", matchFromListHref);
      await detailLink.click();

      await expect(page).toHaveURL(matchFromListHref);
      await expect(page.getByLabel("試合詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
      await expect(
        page.getByRole("heading", { exact: true, name: "試合結果を読み込み中" }),
      ).toBeVisible();
      await expect.poll(() => detailApiRequested).toBe(true);
    } finally {
      releaseDetailResponse();
      await page.unroute(detailUrlPattern);
    }
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
  });
});

test("downloads a confirmed match export", async ({ e2eRun, page, request }) => {
  const { matchId, mapName, seasonName } = await seedConfirmedContext(request, e2eRun);

  await test.step("download an export for the confirmed match", async () => {
    expectGeneratedId(matchId, "match ID");

    await page.goto(`/exports?matchId=${encodeURIComponent(matchId)}&format=tsv`);

    await expect(page.getByRole("region", { exact: true, name: "出力条件" })).toBeVisible();
    await page.setViewportSize({ height: 812, width: 375 });

    const exportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/exports/matches") && response.request().method() === "GET",
    );
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "この試合をTSVでダウンロード" }).click();

    const response = await exportResponse;
    expect(response.ok()).toBe(true);
    const url = new URL(response.url());
    expect(url.searchParams.get("format")).toBe("tsv");
    expect(url.searchParams.get("matchId")).toBe(matchId);
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toContain(matchId);
    expect(download.suggestedFilename()).toMatch(/\.tsv$/u);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("Export did not produce a local download");
    const [headers, ...rows] = (await readFile(downloadPath, "utf8"))
      .trimEnd()
      .split(/\r?\n/u)
      .map((line) => line.split("\t"));
    if (!headers) throw new Error("Export is missing its header");
    expect(rows).toHaveLength(4);
    const records = rows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index]])),
    );
    expect(
      records.map((record) => ({
        assets: record["総資産"],
        order: record["プレー順"],
        rank: record["順位"],
        revenue: record["収益"],
        season: record["シーズン"],
        map: record["マップ"],
      })),
    ).toEqual(
      [1, 2, 3, 4].map((rank) => ({
        assets: String((5 - rank) * 100),
        order: String(rank),
        rank: String(rank),
        revenue: String((5 - rank) * 10),
        season: seasonName,
        map: mapName,
      })),
    );
    expect(records.map((record) => record["プレーヤー名"])).toEqual([
      "ぽんた",
      "あかねまみ",
      "おーたか",
      "いーゆー",
    ]);
    await expect(
      page.getByRole("heading", { exact: true, name: "ダウンロードを開始しました" }),
    ).toBeVisible();
  });
});

function isMatchListResponse(response: Response): boolean {
  const url = new URL(response.url());
  return url.pathname === "/api/matches" && response.request().method() === "GET";
}

function currentPagePath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
}

function matchDetailLink(page: Page, matchId: string) {
  return page.locator(
    `a[href="/matches/${matchId}"]:visible, a[href^="/matches/${matchId}?"]:visible`,
  );
}

function matchTableRow(page: Page, matchId: string) {
  return page.getByRole("row").filter({ has: matchDetailLink(page, matchId) });
}

async function selectDialogRadio(dialog: Locator, name: string | RegExp): Promise<void> {
  const radio = dialog.getByRole("radio", { name });
  if (await radio.isChecked()) {
    await dialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
  } else {
    await radio.press("Space");
  }
  await expect(dialog).toBeHidden();
}

async function selectSeedMasters(
  page: Page,
  ids: { gameTitleId: string; mapMasterId: string; seasonMasterId: string },
): Promise<void> {
  const gameTitleSelect = page.getByRole("combobox", { name: /^作品/u });
  await expect(gameTitleSelect).toBeEnabled();
  await selectControlOption(page, gameTitleSelect, ids.gameTitleId);

  const seasonSelect = page.getByRole("combobox", { name: /^シーズン/u });
  await expect(seasonSelect).toBeEnabled();
  await selectControlOption(page, seasonSelect, ids.seasonMasterId);

  const mapSelect = page.getByRole("combobox", { name: /^マップ/u });
  await expect(mapSelect).toBeEnabled();
  await selectControlOption(page, mapSelect, ids.mapMasterId);
}

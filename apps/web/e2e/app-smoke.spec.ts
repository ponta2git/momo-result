import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse, Page, Request, Route } from "@playwright/test";

const devAccountId = "account_ponta";
const devUserStorageKey = "momoresult.devUser";
const runId = randomUUID().replaceAll("-", "");
const masterIdSuffix = runId.slice(-18) || "1";
const gameTitleId = `gt_e2e_${masterIdSuffix}`;
const seasonMasterId = `season_e2e_${masterIdSuffix}`;
const mapMasterId = `map_e2e_${masterIdSuffix}`;
const gameTitleName = `桃太郎電鉄2 E2E ${masterIdSuffix}`;
const aliasName = `E2E-${masterIdSuffix}`;
const generatedIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("completes the app smoke workflow with isolated scoped data", async ({ page, request }) => {
  let heldEventId = "";
  let matchId = "";
  let uploadedDraftId = "";

  await test.step("seed scoped masters", async () => {
    await postJson(request, "/api/game-titles", {
      id: gameTitleId,
      name: gameTitleName,
      layoutFamily: "momotetsu_2",
    });
    await postJson(request, "/api/season-masters", {
      id: seasonMasterId,
      gameTitleId,
      name: "E2Eシーズン",
    });
    await postJson(request, "/api/map-masters", {
      id: mapMasterId,
      gameTitleId,
      name: "E2Eマップ",
    });
  });

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [devUserStorageKey, devAccountId],
  );
  await installE2eAuthHeaders(page);

  await test.step("create a held event after dev login", async () => {
    await page.goto("/held-events");

    await expect(page.getByRole("heading", { exact: true, name: "開催履歴" })).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/held-events") && response.request().method() === "POST",
    );
    await page.getByLabel("開催日時").fill(uniqueLocalDateTime());
    await page.getByRole("button", { name: "開催履歴を作成" }).click();

    const response = await createResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { id?: string };
    heldEventId = expectGeneratedId(body.id, "held event ID");
    await expect(page.getByText(/開催履歴（.+）を作成しました。/u)).toBeVisible();
  });

  await test.step("create a member alias through the admin UI", async () => {
    await page.goto("/admin/masters");

    await expect(page.getByRole("heading", { exact: true, name: "設定管理" })).toBeVisible();
    await page.getByRole("tab", { name: "メンバー名寄せ" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "プレーヤー名の別名" }),
    ).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/member-aliases") && response.request().method() === "POST",
    );
    const createForm = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "追加" }) });
    await createForm.locator('input[name="alias"]').fill(aliasName);
    await page.getByRole("button", { name: "追加" }).click();

    const response = await createResponse;
    expect(response.ok()).toBe(true);
    await expect(page.getByText(aliasName)).toBeVisible();
  });

  await test.step("start an OCR job from an uploaded image", async () => {
    await page.goto("/ocr/new");

    await expect(page.getByRole("heading", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await selectSeedMasters(page);

    await page.getByLabel("OCRの画像をアップロード").setInputFiles({
      buffer: png1x1,
      mimeType: "image/png",
      name: "total-assets.png",
    });

    const draftResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/match-drafts") && response.request().method() === "POST",
    );
    const jobResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/ocr-jobs") && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "読み取りを開始して試合一覧へ" }).click();
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "3種類すべての画像は揃っていません。このまま進める場合は、もう一度開始ボタンを押してください。",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "このまま読み取りを開始" }).click();

    const draftCreateResponse = await draftResponse;
    expect(draftCreateResponse.ok()).toBe(true);
    const draftBody = (await draftCreateResponse.json()) as { matchDraftId?: string };
    uploadedDraftId = expectGeneratedId(draftBody.matchDraftId, "match draft ID");

    expect((await jobResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/\/matches(?:\?.*)?$/u);
    await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
  });

  await test.step("confirm the sample OCR review into a match detail", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/review/dev-sample?sample=1");

    await expect(page.getByRole("heading", { exact: true, name: "OCR結果の確認" })).toBeVisible();
    await expect(page.getByText("サンプルの読み取り結果で表示中")).toBeVisible();
    await page.getByLabel(/開催履歴/u).selectOption(heldEventId);
    await expect(page.getByLabel(/開催履歴/u)).toHaveValue(heldEventId);
    await selectSeedMasters(page);

    const confirmResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/matches") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "確定前の確認へ進む" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "この内容で確定しますか？" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "確定する" }).click();

    const response = await confirmResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { matchId?: string };
    matchId = expectGeneratedId(body.matchId, "match ID");

    await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`, "u"));
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
    await expect(page.getByText(gameTitleName, { exact: true })).toBeVisible();
  });

  await test.step("inspect series comparison drilldowns for the confirmed match", async () => {
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ height: 844, width: 390 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);

    const comparisonLink = page.getByRole("link", { name: "戦績の中で見る" });
    await expect(comparisonLink).toHaveAttribute(
      "href",
      `/analytics/series?gameTitleId=${encodeURIComponent(
        gameTitleId,
      )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}&mapMasterId=${encodeURIComponent(
        mapMasterId,
      )}&focusMatchId=${encodeURIComponent(matchId)}&view=flow`,
    );
    await comparisonLink.click();

    await expect(page.getByRole("heading", { exact: true, name: "戦績比較" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]focusMatchId=[^&]+/u);
    const focusedMatch = page.getByRole("region", { name: "選択中の試合" });
    await expect(focusedMatch.getByRole("heading", { name: /1戦目/u })).toBeVisible();
    await expect(focusedMatch.getByRole("link", { name: "この試合の結果" })).toHaveAttribute(
      "href",
      `/matches/${matchId}`,
    );
    await expect(page.getByRole("tab", { name: "分析する" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "推移" })).toHaveAttribute("aria-selected", "true");
    expect(
      await page
        .getByRole("tablist", { name: "分析の切り口" })
        .evaluate((element) => window.getComputedStyle(element).overflowY),
    ).toBe("hidden");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    if (desktopViewport) {
      await page.setViewportSize(desktopViewport);
    }

    await page.getByRole("tab", { name: "今の差" }).click();
    await expect(page.getByRole("heading", { exact: true, name: "順位の地力" })).toBeVisible();
    const rankDrilldownResponse = page.waitForResponse((response) =>
      isSeriesDrilldownResponse(response, "rank.averageHistory"),
    );
    await page.getByRole("button", { name: "履歴" }).click();
    expect((await rankDrilldownResponse).ok()).toBe(true);
    const rankDialog = page.getByRole("dialog", { name: /順位の地力:/u });
    await expect(rankDialog.getByLabel("開催ごとの順位履歴")).toBeVisible();
    await rankDialog.getByRole("button", { name: "試合ごと" }).click();
    await expect(rankDialog.getByLabel("試合ごとの順位履歴")).toBeVisible();
    await expect(rankDialog.getByRole("link", { name: "1戦目の試合結果を見る" })).toHaveAttribute(
      "href",
      `/matches/${matchId}`,
    );
    await rankDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
    await expect(rankDialog).toBeHidden();

    await page.getByRole("tab", { name: "条件別" }).click();
    await expect(page.getByRole("heading", { exact: true, name: "番手別成績" })).toBeVisible();
    const playOrderDrilldownResponse = page.waitForResponse((response) =>
      isSeriesDrilldownResponse(response, "playOrder.rankHistory"),
    );
    await page.getByRole("button", { name: "履歴" }).click();
    expect((await playOrderDrilldownResponse).ok()).toBe(true);
    const playOrderDialog = page.getByRole("dialog", { name: /番手別成績:/u });
    await expect(
      playOrderDialog.getByRole("img", { name: "番手別累積平均順位グラフ" }),
    ).toBeVisible();
    await expect(playOrderDialog.getByLabel("番手別平均順位推移の実データ")).toBeVisible();
    await playOrderDialog.getByRole("button", { name: "番手別集計" }).click();
    await expect(playOrderDialog.getByLabel("番手ごとの成績履歴")).toBeVisible();
    await playOrderDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
    await expect(playOrderDialog).toBeHidden();
  });

  await test.step("filter and sort the confirmed match list", async () => {
    expectGeneratedId(heldEventId, "held event ID");
    expectGeneratedId(matchId, "match ID");

    await page.goto("/matches");

    await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();

    const statusResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isMatchListResponse(response) &&
        url.searchParams.get("status") === "confirmed" &&
        url.searchParams.get("heldEventId") === null
      );
    });
    const confirmedStatusButton = page.getByRole("button", { exact: true, name: "確定済" });
    await expect(confirmedStatusButton).toBeEnabled();
    await confirmedStatusButton.click();
    expect((await statusResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]status=confirmed(?:&|$)/u);

    const heldEventResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return isMatchListResponse(response) && url.searchParams.get("heldEventId") === heldEventId;
    });
    await page.getByText("詳細条件", { exact: true }).click();
    const heldEventSelect = page.getByRole("combobox", { name: "開催" });
    await expect(heldEventSelect).toBeEnabled();
    await heldEventSelect.selectOption(heldEventId);
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
    await sortSelect.selectOption("updated_desc");
    expect((await sortResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]sort=updated_desc(?:&|$)/u);

    await sortSelect.selectOption("held_desc");
    await expect(sortSelect).toHaveValue("held_desc");
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

    await page.goto(`/matches?status=confirmed&heldEventId=${heldEventId}`);

    await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
    const detailLink = matchDetailLink(page, matchId);
    await expect(detailLink).toHaveCount(1);
    await expect(detailLink).toBeVisible();
    await detailLink.click();

    await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`, "u"));
    await expect(page.getByLabel("試合詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
    await expect(
      page.getByRole("heading", { exact: true, name: "試合詳細を読み込み中" }),
    ).toBeVisible();
    await expect.poll(() => detailApiRequested).toBe(true);

    releaseDetailResponse();
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
    await page.unroute(detailUrlPattern);
  });

  await test.step("download an export for the confirmed match", async () => {
    expectGeneratedId(matchId, "match ID");

    await page.goto(`/exports?matchId=${encodeURIComponent(matchId)}&format=tsv`);

    await expect(page.getByRole("heading", { exact: true, name: "CSV/TSV出力" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "試合" })).toHaveValue(matchId);

    const exportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/exports/matches") && response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "TSVをダウンロード" }).click();

    const response = await exportResponse;
    expect(response.ok()).toBe(true);
    const url = new URL(response.url());
    expect(url.searchParams.get("format")).toBe("tsv");
    expect(url.searchParams.get("matchId")).toBe(matchId);
    await expect(
      page.getByRole("heading", { exact: true, name: "ダウンロードを開始しました" }),
    ).toBeVisible();
  });

  await test.step("delete discarded OCR draft and scoped masters after deleting the match", async () => {
    expectGeneratedId(uploadedDraftId, "match draft ID");
    expectGeneratedId(matchId, "match ID");

    const cancelResponse = await postMutation(
      request,
      `/api/match-drafts/${uploadedDraftId}/cancel`,
    );
    await expectOk(cancelResponse, "cancel uploaded draft");

    const draftAfterCancel = await request.get(`/api/match-drafts/${uploadedDraftId}`, {
      headers: {
        "X-Momo-Account-Id": devAccountId,
      },
    });
    expect(draftAfterCancel.status()).toBe(404);

    const blockedMapDelete = await deleteJson(request, `/api/map-masters/${mapMasterId}`);
    expect(blockedMapDelete.status()).toBe(409);

    const matchDelete = await deleteJson(request, `/api/matches/${matchId}`);
    await expectOk(matchDelete, "delete confirmed match");

    await expectDeleted(await deleteJson(request, `/api/map-masters/${mapMasterId}`), mapMasterId);
    await expectDeleted(
      await deleteJson(request, `/api/season-masters/${seasonMasterId}`),
      seasonMasterId,
    );
    await expectDeleted(await deleteJson(request, `/api/game-titles/${gameTitleId}`), gameTitleId);
  });
});

function uniqueLocalDateTime(): string {
  const numericRunId = Number.parseInt(masterIdSuffix.slice(-8), 16);
  const minutes = Number.isFinite(numericRunId) ? numericRunId % (20 * 24 * 60) : 0;
  const value = new Date(Date.UTC(2026, 4, 1, 0, minutes));
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}T${value
    .getUTCHours()
    .toString()
    .padStart(2, "0")}:${value.getUTCMinutes().toString().padStart(2, "0")}`;
}

async function postJson(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request.post(path, {
    data,
    headers: {
      "Idempotency-Key": `e2e-${masterIdSuffix}-${path.split("/").at(-1)}`,
      "X-CSRF-Token": "dev",
      "X-Momo-Account-Id": devAccountId,
    },
  });
  await expectOk(response, path);
  return (await response.json()) as Record<string, unknown>;
}

async function deleteJson(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.delete(path, {
    headers: {
      "Idempotency-Key": `e2e-${masterIdSuffix}-${path.replaceAll(/[^a-z0-9]+/giu, "-")}`,
      "X-CSRF-Token": "dev",
      "X-Momo-Account-Id": devAccountId,
    },
  });
}

async function postMutation(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.post(path, {
    headers: {
      "Idempotency-Key": `e2e-${masterIdSuffix}-${path.replaceAll(/[^a-z0-9]+/giu, "-")}`,
      "X-CSRF-Token": "dev",
      "X-Momo-Account-Id": devAccountId,
    },
  });
}

async function expectDeleted(response: APIResponse, id: string): Promise<void> {
  await expectOk(response, id);
  expect((await response.json()) as { deleted?: boolean; id?: string }).toMatchObject({
    deleted: true,
    id,
  });
}

async function expectOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
}

async function installE2eAuthHeaders(page: Page): Promise<void> {
  // Runtime E2E exercises the built web bundle, where import.meta.env.DEV is false.
  // Inject the dev auth contract at the browser boundary instead of relying on localStorage.
  await page.route("**/api/**", continueWithE2eAuth);
}

async function continueWithE2eAuth(route: Route): Promise<void> {
  await route.continue({ headers: e2eAuthHeaders(route.request()) });
}

function e2eAuthHeaders(request: Request): Record<string, string> {
  const headers = {
    ...request.headers(),
    "X-Momo-Account-Id": devAccountId,
  };
  if (["DELETE", "PATCH", "POST", "PUT"].includes(request.method())) {
    headers["X-CSRF-Token"] = "dev";
  }
  return headers;
}

function expectGeneratedId(value: string | undefined, label: string): string {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${label}, but received ${String(value)}`);
  }
  expect(value).toEqual(expect.stringMatching(generatedIdPattern));
  return value;
}

function isMatchListResponse(response: APIResponse): boolean {
  const url = new URL(response.url());
  return url.pathname === "/api/matches" && response.request().method() === "GET";
}

function isSeriesDrilldownResponse(response: APIResponse, metricId: string): boolean {
  const url = new URL(response.url());
  return (
    url.pathname === "/api/analytics/series-comparison/drilldown" &&
    url.searchParams.get("metricId") === metricId &&
    response.request().method() === "GET"
  );
}

function matchDetailLink(page: Page, matchId: string) {
  return page.locator(`a[href="/matches/${matchId}"]:visible`);
}

function matchTableRow(page: Page, matchId: string) {
  return page.getByRole("row").filter({ has: matchDetailLink(page, matchId) });
}

async function selectSeedMasters(page: Page): Promise<void> {
  const gameTitleSelect = page.getByLabel("作品（必須）");
  await expect(gameTitleSelect).toBeEnabled();
  await gameTitleSelect.selectOption(gameTitleId);
  await expect(gameTitleSelect).toHaveValue(gameTitleId);

  const seasonSelect = page.getByLabel("シーズン（必須）");
  await expect(seasonSelect).toBeEnabled();
  await expect(seasonSelect.locator(`option[value="${seasonMasterId}"]`)).toHaveCount(1);
  await seasonSelect.selectOption(seasonMasterId);
  await expect(seasonSelect).toHaveValue(seasonMasterId);

  const mapSelect = page.getByLabel("マップ（必須）");
  await expect(mapSelect).toBeEnabled();
  await expect(mapSelect.locator(`option[value="${mapMasterId}"]`)).toHaveCount(1);
  await mapSelect.selectOption(mapMasterId);
  await expect(mapSelect).toHaveValue(mapMasterId);
}

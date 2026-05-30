import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

const devAccountId = "account_ponta";
const devUserStorageKey = "momoresult.devUser";
const runId = `${Date.now()}-${process.pid}`;
const masterIdSuffix = runId.replaceAll(/\D/gu, "").slice(-18) || "1";
const gameTitleId = `gt_e2e_${masterIdSuffix}`;
const seasonMasterId = `season_e2e_${masterIdSuffix}`;
const mapMasterId = `map_e2e_${masterIdSuffix}`;
const gameTitleName = `桃太郎電鉄2 E2E ${masterIdSuffix}`;
const aliasName = `E2E-${runId}`;
const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let heldEventId = "";
let matchId = "";
let uploadedDraftId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [devUserStorageKey, devAccountId],
  );
});

test("creates a held event after dev login", async ({ page }) => {
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
  expect(body.id).toBeTruthy();
  heldEventId = body.id ?? "";
  await expect(page.getByText(/開催履歴（.+）を作成しました。/u)).toBeVisible();
});

test("creates a member alias through the admin UI", async ({ page }) => {
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

test("starts an OCR job from an uploaded image", async ({ page }) => {
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
      name: "3種類すべての画像は揃っていません。このまま進める場合は、もう一度開始してください。",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "このまま読み取りを開始" }).click();

  const draftCreateResponse = await draftResponse;
  expect(draftCreateResponse.ok()).toBe(true);
  const draftBody = (await draftCreateResponse.json()) as { matchDraftId?: string };
  expect(draftBody.matchDraftId).toBeTruthy();
  uploadedDraftId = draftBody.matchDraftId ?? "";

  expect((await jobResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/\/matches(?:\?.*)?$/u);
  await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
});

test("confirms the sample OCR review into a match detail", async ({ page }) => {
  expect(heldEventId).toBeTruthy();

  await page.goto("/review/dev-sample?sample=1");

  await expect(page.getByRole("heading", { exact: true, name: "OCR結果の確認" })).toBeVisible();
  await expect(page.getByText("サンプルの読み取り結果で表示中")).toBeVisible();
  await page.getByLabel(/開催履歴/u).selectOption(heldEventId);
  await expect(page.getByLabel(/開催履歴/u)).toHaveValue(heldEventId);
  await selectSeedMasters(page);

  const confirmResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/matches") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "確定前の確認へ進む" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "この内容で確定しますか？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "確定する" }).click();

  const response = await confirmResponse;
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { matchId?: string };
  expect(body.matchId).toBeTruthy();
  matchId = body.matchId ?? "";

  await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`, "u"));
  await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
  await expect(page.getByText(gameTitleName, { exact: true })).toBeVisible();
});

test("filters and sorts the confirmed match list", async ({ page }) => {
  expect(heldEventId).toBeTruthy();
  expect(matchId).toBeTruthy();

  await page.goto("/matches");

  await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
  await expect(page.getByRole("link", { name: "詳細を見る" })).toBeVisible();

  const statusResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      isMatchListResponse(response) &&
      url.searchParams.get("status") === "confirmed" &&
      url.searchParams.get("heldEventId") === null
    );
  });
  await page.getByRole("combobox", { name: "状態" }).selectOption("confirmed");
  expect((await statusResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/[?&]status=confirmed(?:&|$)/u);
  await expect(page.getByRole("table").getByText(gameTitleName)).toBeVisible();
  await expect(page.getByRole("link", { name: "詳細を見る" })).toHaveAttribute(
    "href",
    `/matches/${matchId}`,
  );

  const heldEventResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return isMatchListResponse(response) && url.searchParams.get("heldEventId") === heldEventId;
  });
  await page.getByRole("combobox", { name: "開催" }).selectOption(heldEventId);
  expect((await heldEventResponse).ok()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`[?&]heldEventId=${heldEventId}(?:&|$)`, "u"));
  await expect(page.getByRole("link", { name: "詳細を見る" })).toHaveAttribute(
    "href",
    `/matches/${matchId}`,
  );

  await page.getByRole("combobox", { name: "表の並び順" }).selectOption("updated_desc");
  await expect(page).toHaveURL(/[?&]sort=updated_desc(?:&|$)/u);

  await page.getByRole("button", { name: "開催・試合" }).click();
  await expect(page).toHaveURL(/[?&]sort=held_desc(?:&|$)/u);
});

test("opens match detail immediately with a loading shell from the list", async ({ page }) => {
  expect(matchId).toBeTruthy();

  let releaseDetailResponse!: () => void;
  let detailApiRequested = false;
  const detailHold = new Promise<void>((resolve) => {
    releaseDetailResponse = resolve;
  });
  const detailUrlPattern = `**/api/matches/${matchId}`;
  await page.route(detailUrlPattern, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    detailApiRequested = true;
    await detailHold;
    await route.continue();
  });

  await page.goto("/matches?status=confirmed");

  await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
  const detailLink = page.getByRole("link", { name: "詳細を見る" });
  await expect(detailLink).toHaveAttribute("href", `/matches/${matchId}`);
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

test("downloads an export for the confirmed match", async ({ page }) => {
  expect(matchId).toBeTruthy();

  await page.goto(`/exports?matchId=${encodeURIComponent(matchId)}&format=tsv`);

  await expect(page.getByRole("heading", { exact: true, name: "CSV / TSV 出力" })).toBeVisible();
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

test("deletes discarded OCR draft and scoped masters after deleting the confirmed match", async ({
  request,
}) => {
  expect(uploadedDraftId).toBeTruthy();
  expect(matchId).toBeTruthy();

  const cancelResponse = await postMutation(request, `/api/match-drafts/${uploadedDraftId}/cancel`);
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

function uniqueLocalDateTime(): string {
  const numericRunId = Number(runId.replaceAll(/\D/gu, "").slice(-8));
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

function isMatchListResponse(response: APIResponse): boolean {
  const url = new URL(response.url());
  return url.pathname === "/api/matches" && response.request().method() === "GET";
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

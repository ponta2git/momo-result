import { createDeferred } from "../../src/test/deferred";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, selectControlOption, test } from "./support";

test.beforeEach(async ({ page }) => {
  await installUiAuth(page);
});

test("keeps the mobile search draft through layout changes and applies it only on submission", async ({
  page,
}) => {
  const { heldEventId, gameTitleId, seasonMasterId } = confirmedContext;
  const initialSearch = new URLSearchParams({
    heldEventId,
    gameTitleId,
    seasonMasterId,
  });
  const requests: URLSearchParams[] = [];
  await page.route(/\/api\/matches(?:\?.*)?$/u, async (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    await route.fallback();
  });
  await page.setViewportSize({ height: 844, width: 320 });
  await page.goto(`/matches?${initialSearch.toString()}`);
  const list = page.getByRole("region", { exact: true, name: "確定済みの試合" });
  await expect(list).toContainText("2試合");
  const initialRequests = requests.length;

  const searchTrigger = page.getByRole("button", { name: /^検索条件/u });
  await searchTrigger.click();
  const dialog = page.getByRole("dialog", { exact: true, name: "検索条件" });
  const memo = dialog.getByLabel("メモに含む語句");
  await memo.fill("ボンビー");
  await page.setViewportSize({ height: 900, width: 1280 });
  await expect(memo).toHaveValue("ボンビー");
  await page.setViewportSize({ height: 844, width: 320 });
  await expect(memo).toHaveValue("ボンビー");
  expect(requests).toHaveLength(initialRequests);
  expect(new URL(page.url()).searchParams.get("q")).toBeNull();

  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(searchTrigger).toBeFocused();
  await searchTrigger.press("Enter");
  await expect(memo).toHaveValue("");
  await memo.fill("ボンビー");
  await dialog.getByRole("button", { name: "この条件で検索" }).click();

  await expect(dialog).not.toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("ボンビー");
  await expect(list).toContainText("1試合");
  expect(Object.fromEntries(requests.at(-1) ?? [])).toMatchObject({
    ...Object.fromEntries(initialSearch),
    kind: "match",
    status: "confirmed",
    q: "ボンビー",
  });
  await expect(list.getByRole("link", { name: "第1試合 · 東日本編" })).toBeVisible();
  await expect(list.getByRole("link", { name: "第2試合 · 東日本編" })).toHaveCount(0);

  await list.getByRole("link", { name: "第1試合をCSV/TSV出力" }).click();
  await expect(page).toHaveURL("/exports?matchId=match-1");
  await expect(page.getByRole("region", { name: "出力条件" })).toBeVisible();
  await page.goBack();
  await expect(list).toContainText("1試合");
  expect(new URL(page.url()).searchParams.get("q")).toBe("ボンビー");

  await page.getByRole("button", { name: "メモ「ボンビー」 を解除" }).click();
  await expect(list).toContainText("2試合");
  expect(new URL(page.url()).searchParams.get("q")).toBeNull();
  expect(new URL(page.url()).searchParams.get("heldEventId")).toBe(heldEventId);
});

test("keeps keyboard filtering usable while stale results are protected and the request is retried", async ({
  page,
}) => {
  const { heldEventId, mapMasterId, mapName } = confirmedContext;
  const gate = createDeferred();
  let conditionRequested = false;
  let retryAllowed = false;
  await page.route(/\/api\/matches(?:\?.*)?$/u, async (route) => {
    if (new URL(route.request().url()).searchParams.get("mapMasterId") === mapMasterId) {
      conditionRequested = true;
      await gate.promise;
      if (!retryAllowed) {
        await route.fulfill({
          status: 500,
          json: {
            code: "INTERNAL_ERROR",
            detail: "E2E retry contract",
            status: 500,
            title: "Internal error",
            type: "about:blank",
          },
        });
        return;
      }
    }
    await route.fallback();
  });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`/matches?heldEventId=${encodeURIComponent(heldEventId)}`);
  const list = page.getByRole("region", { exact: true, name: "確定済みの試合" });
  await expect(list).toContainText("2試合");
  const map = page.getByRole("combobox", { exact: true, name: "マップ" });
  const sort = page.getByRole("combobox", { exact: true, name: "並び順" });

  try {
    await selectControlOption(page, map, mapMasterId);
    await expect.poll(() => conditionRequested).toBe(true);
    await expect(map).toBeFocused();
    const previousResult = list.locator('a[href="/matches/match-1"]');
    await expect(previousResult).toBeVisible();
    await previousResult.focus();
    await expect(map).toBeFocused();
    await map.press("Tab");
    await expect(sort).toBeFocused();
  } finally {
    gate.resolve();
  }
  await expect(page.getByText("試合一覧を読み込めません")).toBeVisible();
  await expect(sort).toBeFocused();
  await expect(map).toHaveText(mapName);

  retryAllowed = true;
  await page.getByRole("button", { name: "一覧を再読み込み" }).click();
  await expect(list.getByRole("link", { name: "第1試合 · 東日本編" })).toBeVisible();
  await expect(list.getByRole("link", { name: "第2試合 · 東日本編" })).toBeVisible();
  await expect(page.getByText("試合一覧を読み込めません")).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get("mapMasterId")).toBe(mapMasterId);
});

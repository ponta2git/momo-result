import { createDeferred } from "../../src/test/deferred";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, selectControlOption, test } from "./support";

test.beforeEach(async ({ page }) => {
  await installUiAuth(page);
});

test("keeps the mobile held-event search draft through layout changes and applies it only on submission", async ({
  page,
}) => {
  const { gameTitleId, heldEventId } = confirmedContext;
  const requests: URLSearchParams[] = [];
  await page.route(/\/api\/held-events(?:\?.*)?$/u, async (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    await route.fallback();
  });
  await page.setViewportSize({ height: 844, width: 320 });
  await page.goto(`/held-events?gameTitleId=${encodeURIComponent(gameTitleId)}`);
  const list = page.getByRole("region", { exact: true, name: "開催の一覧" });
  await expect(list).toContainText("1開催");
  await expect(list.getByText("最新")).toBeVisible();
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
  // The list follows the committed URL through a deferred render; wait for its request.
  await expect.poll(() => requests.at(-1)?.get("q")).toBe("ボンビー");
  expect(Object.fromEntries(requests.at(-1) ?? [])).toMatchObject({
    gameTitleId,
    page: "1",
    pageSize: "10",
    q: "ボンビー",
  });
  await expect(list.getByText("第1試合 ·")).toBeVisible();
  await expect(list.locator("mark")).toHaveText("ボンビー");

  await list.getByRole("link", { name: /をCSV出力$/u }).click();
  await expect(page).toHaveURL(
    `/exports?heldEventId=${encodeURIComponent(heldEventId)}&format=csv`,
  );
  await page.goBack();
  await expect(list.locator("mark")).toHaveText("ボンビー");
  expect(new URL(page.url()).searchParams.get("q")).toBe("ボンビー");

  await page.getByRole("button", { name: "メモ「ボンビー」 を解除" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  await expect(list.locator("mark")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("gameTitleId")).toBe(gameTitleId);
});

test("keeps keyboard filtering usable while stale held events are protected and the request is retried", async ({
  page,
}) => {
  const { heldEventId, mapMasterId, mapName } = confirmedContext;
  const gate = createDeferred();
  let conditionRequested = false;
  let retryAllowed = false;
  await page.route(/\/api\/held-events(?:\?.*)?$/u, async (route) => {
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
  await page.goto("/held-events");
  const list = page.getByRole("region", { exact: true, name: "開催の一覧" });
  await expect(list).toContainText("1開催");
  const map = page.getByRole("combobox", { exact: true, name: "マップ" });
  const sort = page.getByRole("combobox", { exact: true, name: "並び順" });

  try {
    await selectControlOption(page, map, mapMasterId);
    await expect.poll(() => conditionRequested).toBe(true);
    await expect(map).toBeFocused();
    // The retained row stays visible, but its link is unavailable until the new search settles.
    const previousResult = list.getByRole("link", {
      includeHidden: true,
      name: /の開催詳細$/u,
    });
    await expect(previousResult).toBeVisible();
    await expect(previousResult).toHaveAttribute("aria-disabled", "true");
    await previousResult.focus();
    await expect(map).toBeFocused();
    await map.press("Tab");
    await expect(sort).toBeFocused();
  } finally {
    gate.resolve();
  }
  await expect(page.getByText("開催履歴を読み込めません")).toBeVisible();
  await expect(sort).toBeFocused();
  await expect(map).toHaveText(mapName);

  retryAllowed = true;
  await page.getByRole("button", { name: "開催履歴を再読み込み" }).click();
  await expect(list.getByRole("link", { name: /の開催詳細$/u })).toHaveAttribute(
    "href",
    `/held-events/${heldEventId}`,
  );
  await expect(page.getByText("開催履歴を読み込めません")).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get("mapMasterId")).toBe(mapMasterId);
});

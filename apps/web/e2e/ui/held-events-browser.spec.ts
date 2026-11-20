import { createDeferred } from "../../src/test/deferred";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, selectControlOption, test } from "./support";

test("keeps keyboard filtering usable while stale held events are protected and the request is retried", async ({
  page,
}) => {
  await installUiAuth(page);
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
  await expect(page.getByText("開催履歴を読み込めません")).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get("mapMasterId")).toBe(mapMasterId);
  await list.getByRole("link", { name: /の開催詳細$/u }).click();
  await expect(page).toHaveURL(`/held-events/${heldEventId}`);
});

import type { Route } from "@playwright/test";

import { createDeferred } from "../../src/test/deferred";
import { installAdjacentNavigationResponses } from "./fixtures/adjacentNavigation";
import { uiContext } from "./fixtures/records";
import { selectControlOption, expect, installUiAuth, test } from "./support";

test.beforeEach(async ({ page }) => {
  await installUiAuth(page);
});

for (const detail of [
  {
    kind: "held-event",
    route: "held-events",
    firstId: "held-layout-first",
    middleId: "held-layout-middle",
    lastId: "held-layout-last",
    navigationName: "開催の前後移動",
    previousLabel: "前の開催",
    nextLabel: "次の開催",
  },
  {
    kind: "match",
    route: "matches",
    firstId: "match-layout-first",
    middleId: "match-layout-middle",
    lastId: "match-layout-last",
    navigationName: "前後の試合",
    previousLabel: "前の試合",
    nextLabel: "後の試合",
  },
] as const) {
  test(`keeps ${detail.kind} destinations and keyboard focus through adjacent navigation`, async ({
    page,
  }) => {
    await installAdjacentNavigationResponses(page);
    const pathFor = (id: string) => `/${detail.route}/${id}`;
    const navigation = page.getByRole("navigation", { name: detail.navigationName });
    const previous = navigation.getByRole("link", {
      name: new RegExp(`^${detail.previousLabel}`, "u"),
    });
    const next = navigation.getByRole("link", { name: new RegExp(`^${detail.nextLabel}`, "u") });
    const heading = page.getByRole("heading", { level: 1 });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(pathFor(detail.middleId));
    await expect(previous).toHaveAttribute("href", pathFor(detail.firstId));
    await expect(next).toHaveAttribute("href", pathFor(detail.lastId));

    await previous.focus();
    await previous.press("Enter");
    await expect(page).toHaveURL(pathFor(detail.firstId));
    await expect(heading).toBeFocused();
    await expect(previous).toHaveCount(0);

    await next.click();
    await expect(page).toHaveURL(pathFor(detail.middleId));
    await next.click();
    await expect(page).toHaveURL(pathFor(detail.lastId));
    await expect(heading).toBeFocused();
    await expect(next).toHaveCount(0);
  });
}

test("keeps an uncommitted select choice when keyboard focus moves to the next dialog field", async ({
  page,
}) => {
  await page.goto("/admin/masters?tab=accounts");
  await page.getByRole("button", { name: "アカウントを追加", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "アカウントを追加" });
  const trigger = dialog.getByRole("combobox", { name: "紐づくプレーヤー" });

  await trigger.click();
  await expect(page.getByRole("option", { selected: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("checkbox", { name: "ログイン許可" })).toBeFocused();
  await expect(trigger).toHaveText("試合参加者に紐づけない");
});

test("preserves keyboard filtering and recovers the match list after a failed request", async ({
  page,
}) => {
  const {
    heldEventId,
    mapMasterId,
    mapName,
    primaryGameTitleId,
    primaryGameTitleName,
    seasonMasterId,
    seasonName,
    secondaryGameTitleId,
  } = uiContext;

  await test.step("keep the complete search contract at mobile and desktop widths", async () => {
    await page.setViewportSize({ height: 844, width: 320 });
    await page.goto(
      `/matches?heldEventId=${encodeURIComponent(heldEventId)}&gameTitleId=${encodeURIComponent(
        primaryGameTitleId,
      )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}`,
    );

    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
    await expect(page.getByRole("button", { name: "検索条件（3）" })).toBeVisible();
    const chips = page.getByRole("list", { name: "適用中の条件" });
    await expect(chips).toContainText(`作品 ${primaryGameTitleName}`);
    await expect(chips).toContainText(`シーズン ${seasonName}`);
    const list = page.getByRole("region", { exact: true, name: "確定済みの試合" });
    await expect(list).toContainText("2試合");
    await expect(list.getByRole("link", { name: "第1試合をCSV/TSV出力" })).toHaveAttribute(
      "href",
      "/exports?matchId=match-1",
    );
    await page.getByRole("button", { name: "検索条件（3）" }).click();
    const searchDialog = page.getByRole("dialog", { name: "検索条件", exact: true });
    await searchDialog.getByLabel("メモに含む語句").fill("ボンビー");
    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(searchDialog.getByLabel("メモに含む語句")).toHaveValue("ボンビー");
    await page.setViewportSize({ height: 844, width: 320 });
    await expect(searchDialog.getByLabel("メモに含む語句")).toHaveValue("ボンビー");
    await searchDialog.press("Escape");
    await expect(searchDialog).not.toBeVisible();

    await page.setViewportSize({ height: 900, width: 1280 });
    const filterBar = page.getByRole("region", { name: "試合の検索条件" });
    await expect(filterBar.getByRole("combobox", { exact: true, name: "作品" })).toHaveText(
      primaryGameTitleName,
    );
    // Visible scope controls own their values on PC; only the held event stays a chip.
    await expect(chips).not.toContainText(`作品 ${primaryGameTitleName}`);
    await expect(chips).toContainText("開催");
  });

  await test.step("continue keyboard filtering while protecting the previous results", async () => {
    const gate = createDeferred();
    let requested = false;
    const pattern = "**/api/matches?**";
    const holdCondition = async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("mapMasterId") === mapMasterId) {
        requested = true;
        await gate.promise;
      }
      await route.fallback();
    };
    await page.route(pattern, holdCondition);
    const map = page.getByRole("combobox", { exact: true, name: "マップ" });
    const sort = page.getByRole("combobox", { exact: true, name: "並び順" });
    const list = page.getByRole("region", { exact: true, name: "確定済みの試合" });
    try {
      await map.focus();
      await selectControlOption(page, map, mapMasterId);
      await expect.poll(() => requested).toBe(true);
      await expect(map).toBeEnabled();
      await expect(map).toBeFocused();
      await expect(list.locator("[inert]")).toHaveCount(1);
      await map.press("Tab");
      await expect(sort).toBeFocused();
    } finally {
      gate.resolve();
    }
    await expect(list.locator("[inert]")).toHaveCount(0);
    await expect(list.getByRole("table").locator("tbody tr")).toHaveCount(2);
    await expect(sort).toBeFocused();
    await expect(map).toHaveText(mapName);
    await page.unroute(pattern, holdCondition);
  });

  await test.step("distinguish update from retry and preserve visible rows while updating", async () => {
    let holdNextListRequest = false;
    let listRequestHeld = false;
    const listRequestGate = createDeferred();
    const listPattern = /\/api\/matches(?:\?.*)?$/u;
    const holdListRequest = async (route: Route) => {
      const url = new URL(route.request().url());
      if (
        holdNextListRequest &&
        url.pathname === "/api/matches" &&
        url.searchParams.get("heldEventId") === heldEventId
      ) {
        holdNextListRequest = false;
        listRequestHeld = true;
        await listRequestGate.promise;
      }
      await route.fallback();
    };
    await page.route(listPattern, holdListRequest);

    const visibleMatchRow = page
      .getByRole("row")
      .filter({ hasText: mapName })
      .filter({ hasText: "第1試合" });
    await expect(visibleMatchRow).toHaveCount(1);
    holdNextListRequest = true;
    try {
      await page.getByRole("button", { name: "最新情報に更新" }).click();
      await expect.poll(() => listRequestHeld).toBe(true);
      await expect(page.getByRole("button", { name: "一覧を更新中" })).toBeDisabled();
      await expect(page.getByRole("region", { name: "試合の検索条件" })).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
      const updatingStatus = page
        .getByRole("region", { name: "確定済みの試合" })
        .getByRole("status")
        .filter({ hasText: "一覧を更新中" });
      await expect(updatingStatus).toBeVisible();
      await expect(visibleMatchRow).toBeVisible();
      await expect(page.getByRole("button", { name: "一覧を再読み込み" })).toHaveCount(0);
    } finally {
      listRequestGate.resolve();
    }
    await expect(page.getByRole("button", { name: "最新情報に更新" })).toBeEnabled();
    await page.unroute(listPattern, holdListRequest);

    let retryAllowed = false;
    const failUncachedScope = async (route: Route) => {
      const url = new URL(route.request().url());
      if (
        !retryAllowed &&
        url.pathname === "/api/matches" &&
        url.searchParams.get("gameTitleId") === secondaryGameTitleId
      ) {
        await route.fulfill({
          json: {
            code: "INTERNAL_ERROR",
            detail: "E2E retry contract",
            status: 500,
            title: "Internal error",
            type: "about:blank",
          },
          status: 500,
        });
        return;
      }
      await route.fallback();
    };
    await page.route(listPattern, failUncachedScope);
    try {
      await page.goto(
        `/matches?q=${encodeURIComponent("該当なし")}&gameTitleId=${encodeURIComponent(secondaryGameTitleId)}`,
      );
      await expect(page.getByText("試合一覧を読み込めません")).toBeVisible();
      await expect(page.getByRole("button", { name: "一覧を再読み込み" })).toBeVisible();
      await expect(page.getByRole("button", { name: "最新情報に更新" })).toBeVisible();

      retryAllowed = true;
      await page.getByRole("button", { name: "一覧を再読み込み" }).click();
      await expect(page.getByText("条件に合う試合はありません")).toBeVisible();
    } finally {
      retryAllowed = true;
      await page.unroute(listPattern, failUncachedScope);
    }
  });
});

test("changes an export choice by keyboard and restores focus", async ({ page }) => {
  const { heldEventId, matchIds } = uiContext;
  // Keep the keyboard candidate order explicit for this browser scenario.
  // Candidate records and their directory scope are controlled.
  await page.route(/\/api\/matches(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("heldEventId", heldEventId);
    await route.fallback({ url: url.toString() });
  });

  await test.step("keep export choices native and restore focus after keyboard selection", async () => {
    const selectedMatchId = matchIds[0];
    if (!selectedMatchId) throw new Error("export conformance requires a match fixture");

    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto(`/exports?matchId=${encodeURIComponent(selectedMatchId)}`);
    await expect(page.getByRole("region", { exact: true, name: "出力条件" })).toBeVisible();

    const changeMatch = page.getByRole("button", { name: "試合を変更" });
    await changeMatch.click();
    const dialog = page.getByRole("dialog", { name: "試合を選択" });
    await expect(dialog).toBeVisible();

    const radios = dialog.getByRole("radio");
    const radioValues = await radios.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
    expect(radioValues).toHaveLength(2);
    expect(radioValues).toEqual(expect.arrayContaining(matchIds));
    const nextMatchId = matchIds[1];
    if (!nextMatchId) throw new Error("export conformance requires a next owned candidate");

    const selectedRadio = dialog.locator(`input[type="radio"][value="${selectedMatchId}"]`);
    await expect(selectedRadio).toBeChecked();
    await selectedRadio.focus();
    await selectedRadio.press(" ");
    await selectedRadio.press("ArrowDown");

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("matchId")).toBe(nextMatchId);
    await expect(changeMatch).toBeFocused();
  });
});

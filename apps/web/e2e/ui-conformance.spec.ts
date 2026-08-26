import type { Route } from "@playwright/test";

import {
  devAccountId,
  devUserStorageKey,
  expect,
  expectGeneratedId,
  expectNoHorizontalPageOverflow,
  installE2eAuthHeaders,
  postJson,
  test,
} from "./support";

const resetAccessibleName = "確定状況・並び順・詳細条件を初期状態に戻す";

test("keeps shared UI operation contracts across responsive application flows", async ({
  e2eRun,
  page,
  request,
}) => {
  const suffix = e2eRun.masterIdSuffix;
  const primaryGameTitleId = `gt_ui_a_${suffix}`;
  const secondaryGameTitleId = `gt_ui_b_${suffix}`;
  const seasonMasterId = `season_ui_${suffix}`;
  const mapMasterId = `map_ui_${suffix}`;
  const primaryGameTitleName = `UI確認作品A ${suffix}`;
  const secondaryGameTitleName = `UI確認作品B ${suffix}`;
  const seasonName = `UI確認シーズン ${suffix}`;
  const mapName = `UI確認マップ ${suffix}`;
  // The history screen exposes creation shortcuts only for the latest event. Keep this
  // conformance fixture deliberately historical so parallel smoke runs retain that contract.
  const localDateTime = e2eRun.uniqueLocalDateTime(2000);
  const playedAt = new Date(`${localDateTime}:00+09:00`).toISOString();
  let heldEventId = "";
  const matchIds: string[] = [];

  await test.step("seed run-owned filter and choice candidates", async () => {
    await postJson(request, e2eRun, "/api/game-titles", {
      id: primaryGameTitleId,
      layoutFamily: "momotetsu_2",
      name: primaryGameTitleName,
    });
    e2eRun.trackGameTitle(primaryGameTitleId);

    await postJson(request, e2eRun, "/api/game-titles", {
      id: secondaryGameTitleId,
      layoutFamily: "momotetsu_2",
      name: secondaryGameTitleName,
    });
    e2eRun.trackGameTitle(secondaryGameTitleId);

    await postJson(request, e2eRun, "/api/season-masters", {
      gameTitleId: primaryGameTitleId,
      id: seasonMasterId,
      name: seasonName,
    });
    e2eRun.trackSeasonMaster(seasonMasterId);

    await postJson(request, e2eRun, "/api/map-masters", {
      gameTitleId: primaryGameTitleId,
      id: mapMasterId,
      name: mapName,
    });
    e2eRun.trackMapMaster(mapMasterId);

    const heldEvent = await postJson(request, e2eRun, "/api/held-events", { heldAt: playedAt });
    heldEventId = expectGeneratedId(heldEvent["id"] as string | undefined, "held event ID");
    e2eRun.trackHeldEvent(heldEventId);

    for (const matchNoInEvent of [1, 2]) {
      const match = await postJson(request, e2eRun, "/api/matches", {
        draftIds: {},
        gameTitleId: primaryGameTitleId,
        heldEventId,
        mapMasterId,
        matchNoInEvent,
        ownerMemberId: "member_ponta",
        playedAt,
        players: makePlayers(matchNoInEvent),
        seasonMasterId,
      });
      const matchId = expectGeneratedId(match["matchId"] as string | undefined, "match ID");
      matchIds.push(matchId);
      e2eRun.trackMatch(matchId);
    }
  });

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [devUserStorageKey, devAccountId],
  );
  await installE2eAuthHeaders(page);

  await test.step("keep the complete match filter contract at mobile and desktop widths", async () => {
    await page.setViewportSize({ height: 844, width: 320 });
    await page.goto(
      `/matches?heldEventId=${encodeURIComponent(heldEventId)}&gameTitleId=${encodeURIComponent(
        primaryGameTitleId,
      )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}`,
    );

    await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
    const filterBar = page.getByRole("region", { name: "試合の表示条件" });
    const statusFilter = filterBar.getByLabel("確定状況");
    await expect(statusFilter).toBeVisible();
    await expect(statusFilter).toHaveValue("all");
    await expect(statusFilter.getByRole("option")).toHaveCount(6);
    await expect(statusFilter.getByRole("option", { name: /未確定すべて（\d+件）/u })).toHaveCount(
      1,
    );
    await expect(filterBar).not.toContainText("確定状況 すべて");
    await expect(filterBar).not.toContainText("並び順 開催が新しい順");
    await expect(filterBar).toContainText(`作品 ${primaryGameTitleName}`);
    await expect(filterBar).toContainText(`シーズン ${seasonName}`);
    await expect(filterBar).not.toContainText("選択中");
    await expect(page.getByRole("region", { name: "登録済みの試合" })).toContainText("2件");
    await expect(page.getByRole("button", { name: resetAccessibleName })).toHaveCount(1);
    await expectNoHorizontalPageOverflow(page);

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(filterBar).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
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
      await expect(page.getByRole("region", { name: "試合の表示条件" })).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(page.getByRole("region", { name: "登録済みの試合" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(visibleMatchRow).toBeVisible();
      await expect(page.getByRole("button", { name: "一覧を再読み込み" })).toHaveCount(0);
    } finally {
      listRequestGate.resolve();
      await page.unroute(listPattern, holdListRequest);
    }
    await expect(page.getByRole("button", { name: "最新情報に更新" })).toBeEnabled();

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
        `/matches?status=needs_review&gameTitleId=${encodeURIComponent(secondaryGameTitleId)}`,
      );
      await expect(page.getByText("試合一覧を読み込めません")).toBeVisible();
      await expect(page.getByRole("button", { name: "一覧を再読み込み" })).toBeVisible();
      await expect(page.getByRole("button", { name: "最新情報に更新" })).toBeVisible();

      retryAllowed = true;
      await page.getByRole("button", { name: "一覧を再読み込み" }).click();
      await expect(page.getByText("該当する試合はありません")).toBeVisible();
    } finally {
      retryAllowed = true;
      await page.unroute(listPattern, failUncachedScope);
    }
  });

  await test.step("keep export choices native and restore focus after keyboard selection", async () => {
    const selectedMatchId = matchIds[0];
    if (!selectedMatchId) throw new Error("export conformance requires a seeded match");

    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto(`/exports?matchId=${encodeURIComponent(selectedMatchId)}`);
    await expect(page.getByRole("heading", { exact: true, name: "CSV/TSV出力" })).toBeVisible();

    const changeMatch = page.getByRole("button", { name: "試合を変更" });
    await changeMatch.click();
    const dialog = page.getByRole("dialog", { name: "試合を選択" });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalPageOverflow(page);

    const radios = dialog.getByRole("radio");
    const radioValues = await radios.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
    expect(radioValues.length).toBeGreaterThanOrEqual(2);
    const selectedIndex = radioValues.indexOf(selectedMatchId);
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    const nextMatchId = radioValues[(selectedIndex + 1) % radioValues.length];
    if (!nextMatchId) throw new Error("export conformance requires a next radio candidate");

    const selectedRadio = dialog.locator(`input[type="radio"][value="${selectedMatchId}"]`);
    await expect(selectedRadio).toBeChecked();
    expect(
      await selectedRadio.evaluate((element) => ({
        tagName: element.tagName,
        type: (element as HTMLInputElement).type,
      })),
    ).toEqual({ tagName: "INPUT", type: "radio" });
    await selectedRadio.focus();
    await selectedRadio.press("ArrowDown");

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("matchId")).toBe(nextMatchId);
    await expect(changeMatch).toBeFocused();
  });

  await test.step("keep game-title choices native and keyboard-selectable", async () => {
    await page.setViewportSize({ height: 900, width: 1280 });
    await page.goto("/admin/masters");
    await expect(page.getByRole("heading", { exact: true, name: "設定管理" })).toBeVisible();

    const choices = page.getByRole("group", { name: "編集する作品" });
    const primaryRadio = choices.getByRole("radio", {
      exact: true,
      name: primaryGameTitleName,
    });
    const secondaryRadio = choices.getByRole("radio", {
      exact: true,
      name: secondaryGameTitleName,
    });
    for (const radio of [primaryRadio, secondaryRadio]) {
      expect(
        await radio.evaluate((element) => ({
          tagName: element.tagName,
          type: (element as HTMLInputElement).type,
        })),
      ).toEqual({ tagName: "INPUT", type: "radio" });
    }

    const radioValues = await choices
      .getByRole("radio")
      .evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));
    const primaryIndex = radioValues.indexOf(primaryGameTitleId);
    expect(primaryIndex).toBeGreaterThanOrEqual(0);
    const nextGameTitleId = radioValues[(primaryIndex + 1) % radioValues.length];
    if (!nextGameTitleId) {
      throw new Error("game-title conformance requires a next radio candidate");
    }
    const nextRadio = choices.locator(`input[type="radio"][value="${nextGameTitleId}"]`);

    await primaryRadio.focus();
    await primaryRadio.press("Space");
    await expect(primaryRadio).toBeChecked();
    await primaryRadio.press("ArrowDown");
    await expect(nextRadio).toBeChecked();
    await expect(nextRadio).toBeFocused();
    await expectNoHorizontalPageOverflow(page);
  });
});

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function makePlayers(seed: number) {
  const memberIds = ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"];
  return memberIds.map((memberId, index) => ({
    incidents: {
      cardShop: 0,
      cardStation: 0,
      destination: 0,
      minusStation: 0,
      plusStation: 0,
      suriNoGinji: 0,
    },
    memberId,
    playOrder: index + 1,
    rank: index + 1,
    revenueManYen: seed * 100 + (4 - index) * 10,
    totalAssetsManYen: seed * 1_000 + (4 - index) * 100,
  }));
}

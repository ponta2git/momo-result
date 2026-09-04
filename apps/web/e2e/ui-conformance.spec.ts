import type { APIRequestContext, Locator, Route } from "@playwright/test";

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
import type { E2eRun } from "./support";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [devUserStorageKey, devAccountId],
  );
  await installE2eAuthHeaders(page);
});

test("keeps match rows usable through responsive update and retry states", async ({
  e2eRun,
  page,
  request,
}) => {
  const {
    heldEventId,
    mapName,
    matchIds,
    primaryGameTitleId,
    primaryGameTitleName,
    seasonMasterId,
    seasonName,
    secondaryGameTitleId,
  } = await seedUiContext(request, e2eRun);

  await test.step("preserve the query-known sample context through loading", async () => {
    const directoryGate = createDeferred();
    let directoryRequested = false;
    const directoryPattern = /\/api\/held-events(?:\?.*)?$/u;
    const holdDirectory = async (route: Route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET" && url.pathname === "/api/held-events") {
        directoryRequested = true;
        await directoryGate.promise;
      }
      await route.fallback();
    };
    const loadingSurfaceTops = new Map<number, number>();
    await page.route(directoryPattern, holdDirectory);

    try {
      await page.setViewportSize({ height: 844, width: 320 });
      await page.goto("/review/dev-sample?sample=1");
      await expect.poll(() => directoryRequested).toBe(true);
      await expect(page.getByText("サンプルの読み取り結果で表示中", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);

      for (const width of [320, 375]) {
        await page.setViewportSize({ height: 844, width });
        await expectNoHorizontalPageOverflow(page);
        loadingSurfaceTops.set(
          width,
          await page
            .locator('[data-page-content-surface=""]')
            .evaluate((surface) => surface.getBoundingClientRect().top),
        );
      }
    } finally {
      directoryGate.resolve();
      await page.unroute(directoryPattern, holdDirectory);
    }

    await expect(page.getByRole("region", { name: "試合内容" })).toBeVisible();
    await expect(page.getByText("サンプルの読み取り結果で表示中", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    for (const width of [320, 375]) {
      await page.setViewportSize({ height: 844, width });
      await expectNoHorizontalPageOverflow(page);
      const readySurfaceTop = await page
        .locator('[data-page-content-surface=""]')
        .evaluate((surface) => surface.getBoundingClientRect().top);
      const loadingSurfaceTop = loadingSurfaceTops.get(width);
      expect(loadingSurfaceTop).toBeDefined();
      expect(
        Math.abs(readySurfaceTop - (loadingSurfaceTop ?? readySurfaceTop)),
      ).toBeLessThanOrEqual(2);
    }

    await page.getByRole("button", { name: "一覧にない開催を追加する" }).click();
    const heldEventCreationFields = page.locator('[data-held-event-creation-fields=""]');
    await expect(heldEventCreationFields).toBeVisible();
    expect(
      await heldEventCreationFields.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderBottomWidth: style.borderBottomWidth,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
          borderTopWidth: style.borderTopWidth,
        };
      }),
    ).toEqual({
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      borderRightWidth: "0px",
      borderTopWidth: "0px",
    });
  });

  await test.step("contain held-event detail loading at the narrow viewport", async () => {
    const detailGate = createDeferred();
    let detailRequested = false;
    let loadingSurfaceTopAt320: number | undefined;
    let loadingSurfaceTop: number | undefined;
    const detailPattern = `**/api/held-events/${heldEventId}`;
    const holdDetail = async (route: Route) => {
      if (route.request().method() === "GET") {
        detailRequested = true;
        await detailGate.promise;
      }
      await route.fallback();
    };
    await page.route(detailPattern, holdDetail);

    try {
      await page.setViewportSize({ height: 844, width: 320 });
      await page.goto(`/held-events/${heldEventId}?returnTo=%2Fheld-events`);

      await expect(page.getByLabel("開催詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => detailRequested).toBe(true);
      await expectNoHorizontalPageOverflow(page);
      loadingSurfaceTopAt320 = await page
        .getByRole("region", { name: "開催内容" })
        .evaluate((surface) => surface.getBoundingClientRect().top);
      await expectResponsiveLeadActionGeometry(
        page.locator('[data-page-header-actions="responsive-lead"]'),
        2,
      );
      const navigationGeometry = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>("[data-nav-scroll]");
        const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!scroller || !active) throw new Error("expected active global navigation item");
        const scrollerRect = scroller.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        return {
          activeLeft: activeRect.left,
          activeRight: activeRect.right,
          pageScrollX: window.scrollX,
          scrollerLeft: scrollerRect.left,
          scrollerRight: scrollerRect.right,
          scrollerScrollLeft: scroller.scrollLeft,
        };
      });
      expect(navigationGeometry.pageScrollX).toBe(0);
      expect(navigationGeometry.scrollerScrollLeft).toBeGreaterThan(0);
      expect(navigationGeometry.activeLeft).toBeGreaterThanOrEqual(
        navigationGeometry.scrollerLeft - 1,
      );
      expect(navigationGeometry.activeRight).toBeLessThanOrEqual(
        navigationGeometry.scrollerRight + 1,
      );

      await page.setViewportSize({ height: 844, width: 375 });
      loadingSurfaceTop = await page
        .getByRole("region", { name: "開催内容" })
        .evaluate((surface) => surface.getBoundingClientRect().top);
      await expectResponsiveLeadActionGeometry(
        page.locator('[data-page-header-actions="responsive-lead"]'),
        2,
      );
    } finally {
      detailGate.resolve();
      await page.unroute(detailPattern, holdDetail);
    }

    await expect(page.getByText("確定済み2試合・未確定下書き0件", { exact: true })).toBeVisible();
    const readySurfaceTop = await page
      .getByRole("region", { name: "開催内容" })
      .evaluate((surface) => surface.getBoundingClientRect().top);
    await expectResponsiveLeadActionGeometry(
      page.locator('[data-page-header-actions="responsive-lead"]'),
      3,
    );
    expect(loadingSurfaceTop).toBeDefined();
    expect(Math.abs(readySurfaceTop - (loadingSurfaceTop ?? readySurfaceTop))).toBeLessThanOrEqual(
      2,
    );

    await page.setViewportSize({ height: 844, width: 320 });
    await expectNoHorizontalPageOverflow(page);
    const readySurfaceTopAt320 = await page
      .getByRole("region", { name: "開催内容" })
      .evaluate((surface) => surface.getBoundingClientRect().top);
    await expectResponsiveLeadActionGeometry(
      page.locator('[data-page-header-actions="responsive-lead"]'),
      3,
    );
    expect(loadingSurfaceTopAt320).toBeDefined();
    expect(
      Math.abs(readySurfaceTopAt320 - (loadingSurfaceTopAt320 ?? readySurfaceTopAt320)),
    ).toBeLessThanOrEqual(2);

    await page.route(detailPattern, fulfillHeldEventNotFound);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "開催が見つかりません" })).toBeVisible();
      for (const width of [320, 375]) {
        await page.setViewportSize({ height: 844, width });
        await expectNoHorizontalPageOverflow(page);
        await expectResponsiveLeadActionGeometry(
          page.locator('[data-page-header-actions="responsive-lead"]'),
          2,
        );
      }
    } finally {
      await page.unroute(detailPattern, fulfillHeldEventNotFound);
    }
  });

  await test.step("stack match-result loading rows without narrow-width collisions", async () => {
    const matchId = matchIds[0];
    if (!matchId) throw new Error("expected a seeded match");
    const matchGate = createDeferred();
    let matchRequested = false;
    const detailPattern = `**/api/matches/${matchId}`;
    const holdMatch = async (route: Route) => {
      if (route.request().method() === "GET") {
        matchRequested = true;
        await matchGate.promise;
      }
      await route.fallback();
    };
    await page.route(detailPattern, holdMatch);

    try {
      await page.setViewportSize({ height: 844, width: 320 });
      await page.goto(`/matches/${matchId}?returnTo=%2Fheld-events%2F${heldEventId}`);
      await expect(page.getByLabel("試合詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => matchRequested).toBe(true);

      for (const width of [320, 375]) {
        await page.setViewportSize({ height: 844, width });
        await expectNoHorizontalPageOverflow(page);
        await expectStackedRowGeometry(page.locator("[data-match-result-loading-row]").first());
      }
    } finally {
      matchGate.resolve();
      await page.unroute(detailPattern, holdMatch);
    }

    await expect(page.getByRole("heading", { name: "第1試合の結果" })).toBeVisible();
    for (const width of [320, 375]) {
      await page.setViewportSize({ height: 844, width });
      await expectNoHorizontalPageOverflow(page);
      await expectStackedRowGeometry(
        page.getByRole("list", { name: "試合の順位と成績" }).getByRole("listitem").first(),
      );
    }
  });

  await test.step("keep the complete match filter contract at mobile and desktop widths", async () => {
    await page.setViewportSize({ height: 844, width: 320 });
    await page.goto(
      `/matches?heldEventId=${encodeURIComponent(heldEventId)}&gameTitleId=${encodeURIComponent(
        primaryGameTitleId,
      )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}`,
    );

    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
    const filterBar = page.getByRole("region", { name: "試合の表示条件" });
    const statusFilter = filterBar.getByRole("combobox", { exact: true, name: "確定状況" });
    await expect(statusFilter).toBeVisible();
    await expect(statusFilter).toHaveValue("all");
    await expect(filterBar).toContainText(`作品 ${primaryGameTitleName}`);
    await expect(filterBar).toContainText(`シーズン ${seasonName}`);
    await expect(page.getByRole("region", { name: "登録済みの試合" })).toContainText("2件");
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
});

async function expectResponsiveLeadActionGeometry(group: Locator, expectedCount: number) {
  await expect(group).toBeVisible();
  const directChildren = group.locator(":scope > *");
  await expect(directChildren).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    await expect(directChildren.nth(index)).toBeVisible();
  }

  const geometry = await group.evaluate((element) => {
    const groupBox = element.getBoundingClientRect();
    return {
      children: Array.from(element.children, (child) => {
        const box = child.getBoundingClientRect();
        return {
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          top: box.top,
          height: box.height,
          width: box.width,
        };
      }),
      group: {
        bottom: groupBox.bottom,
        left: groupBox.left,
        right: groupBox.right,
        top: groupBox.top,
        height: groupBox.height,
        width: groupBox.width,
      },
    };
  });
  const first = geometry.children[0];
  const second = geometry.children[1];
  if (!first || !second) throw new Error("expected at least two header actions");

  expect(geometry.group.height).toBeGreaterThan(0);
  expect(geometry.group.width).toBeGreaterThan(0);
  expect(Math.abs(first.left - geometry.group.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(first.right - geometry.group.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(first.width - geometry.group.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(second.top - first.bottom - 8)).toBeLessThanOrEqual(1);

  for (let leftIndex = 0; leftIndex < geometry.children.length; leftIndex += 1) {
    const child = geometry.children[leftIndex];
    if (!child) throw new Error("expected header action geometry");
    expect(child.height).toBeGreaterThan(0);
    expect(child.width).toBeGreaterThan(0);
    expect(child.left).toBeGreaterThanOrEqual(geometry.group.left - 1);
    expect(child.right).toBeLessThanOrEqual(geometry.group.right + 1);
    expect(child.top).toBeGreaterThanOrEqual(geometry.group.top - 1);
    expect(child.bottom).toBeLessThanOrEqual(geometry.group.bottom + 1);

    for (let rightIndex = leftIndex + 1; rightIndex < geometry.children.length; rightIndex += 1) {
      const left = geometry.children[leftIndex];
      const right = geometry.children[rightIndex];
      if (!left || !right) throw new Error("expected header action geometry");
      const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      expect(horizontalOverlap > 1 && verticalOverlap > 1).toBe(false);
    }
  }
}

async function fulfillHeldEventNotFound(route: Route) {
  await route.fulfill({
    contentType: "application/problem+json",
    json: {
      code: "NOT_FOUND",
      detail: "E2E held-event terminal layout",
      status: 404,
      title: "Not found",
      type: "about:blank",
    },
    status: 404,
  });
}

async function expectStackedRowGeometry(row: Locator) {
  await expect(row).toBeVisible();
  const directChildren = row.locator(":scope > *");
  await expect(directChildren).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(directChildren.nth(index)).toBeVisible();
  }

  const geometry = await row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect();
    const childRects = Array.from(element.children, (child) => {
      const rect = child.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    });
    return {
      childRects,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      rowRect: {
        bottom: rowRect.bottom,
        height: rowRect.height,
        left: rowRect.left,
        right: rowRect.right,
        top: rowRect.top,
        width: rowRect.width,
      },
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(geometry.rowRect.height).toBeGreaterThan(0);
  expect(geometry.rowRect.width).toBeGreaterThan(0);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  for (const child of geometry.childRects) {
    expect(child.height).toBeGreaterThan(0);
    expect(child.width).toBeGreaterThan(0);
    expect(child.left).toBeGreaterThanOrEqual(geometry.rowRect.left - 1);
    expect(child.right).toBeLessThanOrEqual(geometry.rowRect.right + 1);
    expect(child.top).toBeGreaterThanOrEqual(geometry.rowRect.top - 1);
    expect(child.bottom).toBeLessThanOrEqual(geometry.rowRect.bottom + 1);
  }
  for (let index = 1; index < geometry.childRects.length; index += 1) {
    const previous = geometry.childRects[index - 1];
    const current = geometry.childRects[index];
    if (!previous || !current) throw new Error("expected result-row geometry");
    expect(Math.abs(current.top - previous.bottom - 12)).toBeLessThanOrEqual(1);
  }
  const last = geometry.childRects.at(-1);
  if (!last) throw new Error("expected result-row geometry");
  expect(last.bottom).toBeLessThanOrEqual(geometry.rowRect.bottom + 1);
}

test("changes an export choice by keyboard and restores focus", async ({
  e2eRun,
  page,
  request,
}) => {
  const { matchIds } = await seedUiContext(request, e2eRun);

  await test.step("keep export choices native and restore focus after keyboard selection", async () => {
    const selectedMatchId = matchIds[0];
    if (!selectedMatchId) throw new Error("export conformance requires a seeded match");

    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto(`/exports?matchId=${encodeURIComponent(selectedMatchId)}`);
    await expect(page.getByRole("region", { exact: true, name: "出力条件" })).toBeVisible();

    const changeMatch = page.getByRole("button", { name: "試合を変更" });
    await changeMatch.click();
    const dialog = page.getByRole("dialog", { name: "試合を選択" });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalPageOverflow(page);

    const radios = dialog.getByRole("radio");
    const radioValues = await radios.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
    const selectedIndex = radioValues.indexOf(selectedMatchId);
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    const nextMatchId = radioValues[(selectedIndex + 1) % radioValues.length];
    if (!nextMatchId) throw new Error("export conformance requires a next radio candidate");

    const selectedRadio = dialog.locator(`input[type="radio"][value="${selectedMatchId}"]`);
    await expect(selectedRadio).toBeChecked();
    await selectedRadio.focus();
    await selectedRadio.press("ArrowDown");

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("matchId")).toBe(nextMatchId);
    await expect(changeMatch).toBeFocused();
  });
});

async function seedUiContext(request: APIRequestContext, e2eRun: E2eRun) {
  const suffix = e2eRun.masterIdSuffix;
  const primaryGameTitleId = `gt_ui_a_${suffix}`;
  const secondaryGameTitleId = `gt_ui_b_${suffix}`;
  const seasonMasterId = `season_ui_${suffix}`;
  const mapMasterId = `map_ui_${suffix}`;
  const primaryGameTitleName = `UI確認作品A ${suffix}`;
  const seasonName = `UI確認シーズン ${suffix}`;
  const mapName = `UI確認マップ ${suffix}`;
  // Keep the fixture historical so a parallel smoke run can own the latest-event shortcuts.
  const localDateTime = e2eRun.uniqueLocalDateTime(2000);
  const playedAt = new Date(`${localDateTime}:00+09:00`).toISOString();

  await postJson(request, e2eRun, "/api/game-titles", {
    id: primaryGameTitleId,
    layoutFamily: "momotetsu_2",
    name: primaryGameTitleName,
  });
  e2eRun.trackGameTitle(primaryGameTitleId);
  await postJson(request, e2eRun, "/api/game-titles", {
    id: secondaryGameTitleId,
    layoutFamily: "momotetsu_2",
    name: `UI確認作品B ${suffix}`,
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
  const heldEventId = expectGeneratedId(heldEvent["id"] as string | undefined, "held event ID");
  e2eRun.trackHeldEvent(heldEventId);
  const matchIds: string[] = [];
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

  return {
    heldEventId,
    mapName,
    matchIds,
    primaryGameTitleId,
    primaryGameTitleName,
    seasonMasterId,
    seasonName,
    secondaryGameTitleId,
  };
}

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

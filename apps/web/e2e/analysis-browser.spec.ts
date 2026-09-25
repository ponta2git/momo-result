import type { Locator, Page } from "@playwright/test";

import { withReturnTo } from "../src/shared/navigation/returnTo";
import { installAnalysisResponses } from "./fixtures/analysis";
import { seedConfirmedContext } from "./fixtures/records";
import {
  expect,
  expectNoHorizontalPageOverflow,
  installE2eAuthHeaders,
  selectControlOption,
  test as base,
} from "./support";

type AnalysisContext = Awaited<ReturnType<typeof seedConfirmedContext>> &
  Awaited<ReturnType<typeof installAnalysisResponses>>;
// Analysis payloads are controlled; match detail links and persisted records use the real API.
// These tests do not validate calculation-worker output.
const test = base.extend<{ analysis: AnalysisContext }>({
  analysis: async ({ e2eRun, page, request }, provide) => {
    await installE2eAuthHeaders(page);
    const records = await seedConfirmedContext(request, e2eRun);
    const responses = await installAnalysisResponses(page, records);
    await provide({ ...records, ...responses });
  },
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
});

test("opens the selected match in saved analysis and retains it after a failed refresh", async ({
  analysis,
  page,
}) => {
  const { gameTitleId, mapMasterId, matchId, seasonMasterId, analysisScope } = analysis;
  await page.goto(`/matches/${encodeURIComponent(matchId)}`);
  await page.setViewportSize({ height: 844, width: 390 });
  const comparisonLink = page.getByRole("link", { name: "前後の戦績を見る" });
  const comparisonHref = withReturnTo(
    `/analytics/series?gameTitleId=${encodeURIComponent(
      gameTitleId,
    )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}&mapMasterId=${encodeURIComponent(
      mapMasterId,
    )}&focusMatchId=${encodeURIComponent(matchId)}&view=flow`,
    currentPagePath(page),
  );
  await expect(comparisonLink).toHaveAttribute("href", comparisonHref);
  await comparisonLink.click();

  await expect(page.getByRole("region", { exact: true, name: "戦績比較" })).toBeVisible();
  await expect(page.getByRole("table", { name: "直近の試合順位" })).toBeVisible();
  const purposeTabs = page.getByRole("tablist", { name: "戦績比較の目的" });
  const analysisTabs = page.getByRole("tablist", { name: "分析の切り口" });
  await expect(purposeTabs.getByRole("tab", { name: "分析する" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(analysisTabs.getByRole("tab", { name: "推移" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect
    .poll(async () => {
      const activeTab = await analysisTabs
        .getByRole("tab", { name: "推移", exact: true })
        .boundingBox();
      const underline = await analysisTabs
        .locator('[role="presentation"] > [aria-hidden="true"]')
        .boundingBox();
      return Boolean(
        activeTab &&
        underline &&
        underline.width > 0 &&
        Math.abs(activeTab.x - underline.x) < 1 &&
        Math.abs(activeTab.width - underline.width) < 1,
      );
    })
    .toBe(true);
  const scopeSurface = page.getByRole("region", { name: "比較条件" });
  await expect(scopeSurface).toContainText(`${analysisScope.matchCount}戦`);
  await expect(page.getByText("新しい戦績データを計算中です")).toBeVisible();
  await expect(page.getByText(/更新のデータを表示します/u)).toBeVisible();
  const selectedMatch = page.getByRole("region", { name: "選択中の試合" });
  const selectedMatchHref = withReturnTo(
    `/matches/${encodeURIComponent(matchId)}`,
    currentPagePath(page),
  );
  await expect(selectedMatch.getByRole("link", { name: "第1戦の試合結果を見る" })).toHaveAttribute(
    "href",
    selectedMatchHref,
  );
  analysis.failCalculation();
  const failedStatusResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/v2/status"),
  );
  await page.getByRole("button", { name: "表示を更新" }).click();
  expect((await failedStatusResponse).ok()).toBe(true);
  await expect(page.getByText("分析データを再計算できませんでした")).toBeVisible();
  await expect(page.getByText(/更新のデータを表示しています/u)).toBeVisible();

  await expect(page.getByRole("table", { name: "直近の試合順位" })).toBeVisible();
  await expect(selectedMatch).toBeVisible();
});

test("keeps recent ranks distinguishable and scrollable at narrow and wide widths", async ({
  analysis,
  page,
}) => {
  const { matchId } = analysis;
  const selectedMatch = page.getByRole("region", { name: "選択中の試合" });
  await page.setViewportSize({ height: 844, width: 390 });
  await openAnalysis(page, analysis);
  const selectedMatchHref = withReturnTo(
    `/matches/${encodeURIComponent(matchId)}`,
    currentPagePath(page),
  );
  const secondRankTile = page.getByRole("link", { name: /、2位.*試合結果を見る/u }).first();
  const thirdRankTile = page.getByRole("link", { name: /、3位.*試合結果を見る/u }).first();
  await expect(secondRankTile).toBeVisible();
  await expect(thirdRankTile).toBeVisible();
  const [secondRankTilePaint, thirdRankTilePaint] = await Promise.all(
    [secondRankTile, thirdRankTile].map((tile) =>
      tile.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      }),
    ),
  );
  if (!secondRankTilePaint || !thirdRankTilePaint) throw new Error("Missing rank tile paint");
  expect(secondRankTilePaint.backgroundColor).not.toBe(thirdRankTilePaint.backgroundColor);
  expect(secondRankTilePaint.color).not.toBe(thirdRankTilePaint.color);
  const recentRankTile = page.getByRole("link", {
    name: /ぽんた、第1戦、1位、この試合。試合結果を見る/u,
  });
  await expect(recentRankTile).toHaveAttribute("href", selectedMatchHref);
  const recentRankScroller = page.getByRole("region", { exact: true, name: "直近順位" });
  const recentRankScrollbar = page.getByRole("slider", {
    name: "直近順位を横スクロール",
  });
  await expect(recentRankScrollbar).toBeEnabled();
  const recentRankPlayerLinks = page
    .getByRole("table", { name: "直近の試合順位" })
    .getByRole("row")
    .nth(1)
    .getByRole("link");
  await expect(recentRankPlayerLinks.first()).toHaveAttribute(
    "href",
    /\/matches\/e2e-recent-01\?returnTo=/u,
  );
  await expect(recentRankPlayerLinks.last()).toHaveAttribute("href", selectedMatchHref);
  const recentRankMetrics = await recentRankScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
  }));
  expect(recentRankMetrics.scrollWidth).toBeGreaterThan(recentRankMetrics.clientWidth);
  expect(recentRankMetrics.scrollLeft).toBeGreaterThanOrEqual(
    recentRankMetrics.scrollWidth - recentRankMetrics.clientWidth - 1,
  );

  const latestScrollbarValue = Number(await recentRankScrollbar.inputValue());
  await recentRankScrollbar.focus();
  await recentRankScrollbar.press("ArrowLeft");
  await expect
    .poll(async () => Number(await recentRankScrollbar.inputValue()))
    .toBeLessThan(latestScrollbarValue);

  await recentRankScrollbar.press("Home");
  const scrollbarBox = await recentRankScrollbar.boundingBox();
  if (!scrollbarBox) throw new Error("recent rank scrollbar must have a bounding box");
  await recentRankScrollbar.click({
    position: { x: scrollbarBox.width * 0.75, y: scrollbarBox.height / 2 },
  });
  await expect.poll(async () => Number(await recentRankScrollbar.inputValue())).toBeGreaterThan(0);

  await recentRankScrollbar.press("Home");
  await recentRankScroller.hover();
  await page.mouse.wheel(120, 0);
  await expect
    .poll(async () => recentRankScroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expectNoHorizontalPageOverflow(page);

  await page.setViewportSize({ height: 1080, width: 1920 });
  await expect(recentRankScrollbar).toBeVisible();
  await expect(recentRankScrollbar).toBeDisabled();
  await expect(recentRankScrollbar).toHaveAttribute("aria-valuetext", "すべて表示");
  const fittedRecentRankMetrics = await recentRankScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(fittedRecentRankMetrics.scrollWidth).toBe(fittedRecentRankMetrics.clientWidth);
  await expectNoHorizontalPageOverflow(page);
  await page.setViewportSize({ height: 844, width: 390 });

  await page.getByRole("tab", { name: "今の差" }).click();
  const overviewRegion = page.getByRole("region", { exact: true, name: "順位と基礎比較" });
  await expect(overviewRegion).toBeVisible();
  const rankDistribution = overviewRegion.getByRole("group", { name: "ぽんたの順位分布" });
  const secondRankSegment = rankDistribution.getByRole("img", { name: /^2位 /u });
  const thirdRankSegment = rankDistribution.getByRole("img", { name: /^3位 /u });
  const [secondRankSegmentPaint, thirdRankSegmentPaint] = await Promise.all(
    [secondRankSegment, thirdRankSegment].map((segment) =>
      segment.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
      }),
    ),
  );
  if (!secondRankSegmentPaint || !thirdRankSegmentPaint)
    throw new Error("Missing rank segment paint");
  expect(secondRankSegmentPaint.backgroundColor).not.toBe(thirdRankSegmentPaint.backgroundColor);
  expect(thirdRankSegmentPaint.boxShadow).not.toBe("none");
  await expectNoHorizontalPageOverflow(page);
  await expect(selectedMatch).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`focusMatchId=${encodeURIComponent(matchId)}`, "u"));
  await page.getByRole("button", { name: "順位推移を見る" }).first().click();
  const rankDialog = page.getByRole("dialog", { name: "平均順位の推移" });
  const rankHistoryMatchHref = withReturnTo(
    `/matches/${encodeURIComponent(matchId)}`,
    currentPagePath(page),
  );
  await expect(rankDialog.getByRole("link", { name: "第1戦の試合結果を見る" })).toHaveAttribute(
    "href",
    rankHistoryMatchHref,
  );
  await rankDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
});

test("preserves owner metrics, focus and horizontal position through selection and history", async ({
  analysis,
  page,
}) => {
  const { matchId } = analysis;
  const selectedMatch = page.getByRole("region", { name: "選択中の試合" });
  await openAnalysis(page, analysis);
  await page.getByRole("tab", { name: "条件別" }).click();
  await expect(page.getByRole("table", { name: "番手別成績" })).toBeVisible();
  const ownerMetric = page.getByRole("combobox", { name: "オーナー比較の指標" });
  const averageOwnerTable = page.getByRole("table", { name: "オーナー別の平均順位" });
  await expectOwnerColumn(page, averageOwnerTable, "ぽんた", ["2位", "1.5位", "3.5位", "3位"]);
  await expect(averageOwnerTable.getByRole("columnheader", { name: /ぽんた/u })).toContainText(
    "2戦",
  );
  await expect(averageOwnerTable.getByRole("columnheader", { name: /ぽんた/u })).toContainText(
    "参考値",
  );
  await expect(averageOwnerTable.getByRole("columnheader", { name: /おたか/u })).toContainText(
    "対象なし",
  );
  await page.setViewportSize({ height: 844, width: 390 });
  const ownerScroller = page.getByRole("region", { name: "オーナー別の平均順位の表" });
  await ownerScroller.focus();
  await ownerScroller.press("ArrowRight");
  let ownerScrollLeft = 0;
  await expect
    .poll(async () => {
      const current = await ownerScroller.evaluate((element) => element.scrollLeft);
      const settled = current > 0 && current === ownerScrollLeft;
      ownerScrollLeft = current;
      return settled;
    })
    .toBe(true);
  await selectControlOption(page, ownerMetric, "rank.distribution");
  await expect(ownerMetric).toBeFocused();
  await expect(page).toHaveURL(/ownerMetric=rank.distribution/u);
  await expect(page).toHaveURL(new RegExp(`focusMatchId=${encodeURIComponent(matchId)}`, "u"));
  const distributionOwnerTable = page.getByRole("table", { name: "オーナー別の順位分布" });
  await expectOwnerColumn(page, distributionOwnerTable, "ぽんた");
  await expect(distributionOwnerTable.getByRole("listitem").first()).toContainText("1位 1回");
  await expect
    .poll(() =>
      page
        .getByRole("region", { name: "オーナー別の順位分布の表" })
        .evaluate((element) => element.scrollLeft),
    )
    .toBe(ownerScrollLeft);
  await expectNoHorizontalPageOverflow(page);
  await page.setViewportSize({ height: 900, width: 1280 });
  await expectOwnerColumn(page, distributionOwnerTable, "ぽんた");
  await expectNoHorizontalPageOverflow(page);
  const ownerComparisonUrl = page.url();
  await selectedMatch.getByRole("link", { name: "第1戦の試合結果を見る" }).click();
  await expect(page.getByRole("link", { name: "前後の戦績を見る" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(ownerComparisonUrl);
  await expectOwnerColumn(page, distributionOwnerTable, "ぽんた");
  await expect(selectedMatch).toBeVisible();

  await selectedMatch.getByRole("button", { name: "この試合の選択を解除" }).click();
  await expect(selectedMatch).toHaveCount(0);
  await expect(page).not.toHaveURL(/focusMatchId=/u);
  await expect(distributionOwnerTable).toBeVisible();
  await expect(distributionOwnerTable.getByText("この試合のオーナー")).toHaveCount(0);
  await expect(distributionOwnerTable.locator('[data-highlighted="true"]')).toHaveCount(0);
});

test("exposes readable chart values and linked evidence", async ({ analysis, page }) => {
  const { matchId } = analysis;
  await openAnalysis(page, analysis);
  await page.getByRole("tab", { name: "勝因候補" }).click();
  await expect(page.getByRole("table", { name: "ぽんたの物件収益順位と最終順位" })).toBeVisible();
  const assetHistogram = page.getByLabel("4人の総資産分布");
  const nonpositiveAxisLabel = assetHistogram
    .locator("svg text")
    .filter({ hasText: /^-2万円〜0円$/u });
  await expect(nonpositiveAxisLabel).toBeVisible();
  await expect(
    assetHistogram.locator("rect title").filter({ hasText: /^-2万円〜0円、1戦$/u }),
  ).toHaveText("-2万円〜0円、1戦");
  const scatterMatchHref = withReturnTo(
    `/matches/${encodeURIComponent(matchId)}`,
    currentPagePath(page),
  );
  await page
    .getByRole("button", {
      name: "物件収益比率と総資産の散布図の数値を表で見る",
    })
    .click();
  const scatterValues = page.getByRole("table", { name: "物件収益比率と総資産の散布図の数値" });
  await expect(scatterValues).toBeVisible();
  await expect(
    scatterValues.getByRole("link", { name: "ぽんた、第1戦、1位の試合結果を見る" }),
  ).toHaveAttribute("href", scatterMatchHref);
  const scatterRow = scatterValues
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "ぽんた、第1戦、1位の試合結果を見る" }) });
  await expect(scatterRow).toContainText("12%");
  await expect(scatterRow).toContainText("21億円");
  await page.getByRole("button", { name: "検証範囲を見る" }).click();
  const rankSignalDialog = page.getByRole("dialog", { name: "順位を読む手掛かり" });
  await rankSignalDialog.getByRole("button", { name: "別開催テストと採用基準" }).click();
  const eventValuesDisclosure = rankSignalDialog.getByRole("button", {
    name: "物件収益の開催別の数値",
  });
  await eventValuesDisclosure.click();
  await expect(eventValuesDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(rankSignalDialog.getByRole("button", { name: "ダイアログを閉じる" })).toBeVisible();
  await rankSignalDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
});

test("keeps review actions stable across widths and restores disclosure and focus from evidence", async ({
  analysis,
  page,
}) => {
  const { expandedReviewHypothesis } = analysis;
  await openAnalysis(page, analysis);
  const selectedMatch = page.getByRole("region", { name: "選択中の試合" });
  const purposeTabs = page.getByRole("tablist", { name: "戦績比較の目的" });
  const reviewPurposeTab = purposeTabs.getByRole("tab", { name: "次戦に備える" });
  await reviewPurposeTab.click();
  await expect(reviewPurposeTab).toHaveAttribute("aria-selected", "true");
  const nextMatchReview = page.getByRole("tabpanel", { name: "次戦に備える" });
  await expect(nextMatchReview).toBeVisible();
  await expect(reviewPurposeTab).toBeFocused();
  await expect(selectedMatch).toBeVisible();

  const reviewPlayerNames = ["いーゆー", "ぽんた", "あかねまみ", "おーたか"] as const;
  const [firstPlayerSection, secondPlayerSection, thirdPlayerSection, fourthPlayerSection] =
    reviewPlayerNames.map((name) =>
      nextMatchReview.getByRole("heading", { exact: true, name }).locator(".."),
    );
  if (!firstPlayerSection || !secondPlayerSection || !thirdPlayerSection || !fourthPlayerSection) {
    throw new Error("review layout requires four player sections");
  }
  const reviewPlayers = [
    { name: "いーゆー", section: firstPlayerSection },
    { name: "ぽんた", section: secondPlayerSection },
    { name: "あかねまみ", section: thirdPlayerSection },
    { name: "おーたか", section: fourthPlayerSection },
  ] as const;
  const firstDisclosure = firstPlayerSection.getByRole("button", {
    name: "いーゆーのほかの仮説",
  });
  const secondPlayerHeading = nextMatchReview.getByRole("heading", {
    exact: true,
    name: "ぽんた",
  });

  const headingTops = await Promise.all(
    reviewPlayerNames.map((name) =>
      locatorPageTop(nextMatchReview.getByRole("heading", { exact: true, name })),
    ),
  );
  expect(Math.max(...headingTops) - Math.min(...headingTops)).toBeLessThanOrEqual(1);
  const desktopBefore = await Promise.all(
    reviewPlayers.map(({ name, section }) => reviewPlayerGeometry(section, name)),
  );

  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(
    nextMatchReview.getByRole("heading", {
      exact: true,
      name: expandedReviewHypothesis.actionHypothesis,
    }),
  ).toBeVisible();
  const desktopAfter = await Promise.all(
    reviewPlayers.map(({ name, section }) => reviewPlayerGeometry(section, name)),
  );
  for (const [index, before] of desktopBefore.entries()) {
    const after = desktopAfter[index];
    if (!after) throw new Error(`missing desktop geometry for player ${index}`);
    expectStableReviewGeometry(before, after);
  }
  await expectNoHorizontalPageOverflow(page);

  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ height: 900, width: 1024 });
  const tabletFirstBefore = await reviewPlayerGeometry(firstPlayerSection, "いーゆー");
  const tabletNeighborBefore = await reviewPlayerGeometry(secondPlayerSection, "ぽんた");
  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
  expectStableReviewGeometry(
    tabletFirstBefore,
    await reviewPlayerGeometry(firstPlayerSection, "いーゆー"),
  );
  expectStableReviewGeometry(
    tabletNeighborBefore,
    await reviewPlayerGeometry(secondPlayerSection, "ぽんた"),
  );
  await expectNoHorizontalPageOverflow(page);

  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ height: 844, width: 390 });
  const mobileDisclosureTop = await locatorPageTop(firstDisclosure);
  const mobileNextPlayerTop = await locatorPageTop(secondPlayerHeading);
  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
  expect(
    Math.abs((await locatorPageTop(firstDisclosure)) - mobileDisclosureTop),
  ).toBeLessThanOrEqual(1);
  await expect
    .poll(() => locatorPageTop(secondPlayerHeading))
    .toBeGreaterThan(mobileNextPlayerTop + 100);
  await expectNoHorizontalPageOverflow(page);

  const evidenceLink = firstPlayerSection
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        exact: true,
        name: expandedReviewHypothesis.actionHypothesis,
      }),
    })
    .getByRole("link", { exact: true, name: "目的地の根拠を見る" });
  await expect(evidenceLink).toHaveAttribute(
    "href",
    /[?&]view=drivers(?:&[^#]*)?#metric-destination-outcome$/u,
  );
  await evidenceLink.scrollIntoViewIfNeeded();
  const reviewUrl = page.url();
  const reviewScroll = await page.evaluate(() => window.scrollY);
  await evidenceLink.click();
  const evidenceHeading = page.getByRole("heading", { name: "目的地到着と順位", exact: true });
  await expect(evidenceHeading).toBeFocused();
  await expectPageTargetInView(evidenceHeading);
  await page.goBack();
  await expect(page).toHaveURL(reviewUrl);
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(evidenceLink).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - reviewScroll)).toBeLessThanOrEqual(
    1,
  );

  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => Math.abs((await locatorPageTop(secondPlayerHeading)) - mobileNextPlayerTop))
    .toBeLessThanOrEqual(1);
  await page.setViewportSize({ height: 900, width: 1440 });
});

async function openAnalysis(page: Page, context: AnalysisContext) {
  const params = new URLSearchParams({
    gameTitleId: context.gameTitleId,
    seasonMasterId: context.seasonMasterId,
    mapMasterId: context.mapMasterId,
    focusMatchId: context.matchId,
    view: "flow",
  });
  await page.goto(`/analytics/series?${params}`);
  await expect(page.getByRole("table", { name: "直近の試合順位" })).toBeVisible();
}

type ReviewPlayerGeometry = {
  disclosureTop: number;
  primaryActionTop: number;
};

async function expectOwnerColumn(
  page: Page,
  table: Locator,
  ownerName: string,
  values?: readonly string[],
): Promise<void> {
  const header = table.getByRole("columnheader", { name: new RegExp(ownerName, "u") });
  await expect(header).toContainText("この試合のオーナー");
  await expectOwnerBorder(header, [true, true, true, true]);
  const columnIndex = await header.evaluate(
    (element) => (element as HTMLTableCellElement).cellIndex,
  );
  for (const [index, playerName] of ["ぽんた", "あかねまみ", "おたか", "EU"].entries()) {
    const row = table
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { exact: true, name: playerName }) });
    const cell = row.getByRole("cell").nth(columnIndex - 1);
    await expect(cell).toHaveAttribute("data-highlighted", "true");
    await expectOwnerBorder(cell, [false, true, true, true]);
    if (values) {
      const expectedValue = values[index];
      if (expectedValue === undefined) throw new Error(`Missing owner value for ${playerName}`);
      await expect(cell).toHaveText(expectedValue);
    }
  }
  await expect(table.getByText("この試合のオーナー", { exact: true })).toHaveCount(1);
}

async function expectOwnerBorder(cell: Locator, edges: readonly boolean[]): Promise<void> {
  const border = await cell.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return {
      widths: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      content: style.content,
      pointerEvents: style.pointerEvents,
    };
  });
  expect(border.widths.map((width) => width !== "0px")).toEqual(edges);
  expect(border.content).not.toBe("none");
  expect(border.pointerEvents).toBe("none");
}

async function locatorPageTop(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
}

async function reviewPlayerGeometry(
  section: Locator,
  playerName: string,
): Promise<ReviewPlayerGeometry> {
  return {
    disclosureTop: await locatorPageTop(
      section.getByRole("button", { name: `${playerName}のほかの仮説` }),
    ),
    primaryActionTop: await locatorPageTop(
      section.getByRole("button", { name: "根拠・注意・試合後の確認" }).first(),
    ),
  };
}

function expectStableReviewGeometry(
  before: ReviewPlayerGeometry,
  after: ReviewPlayerGeometry,
): void {
  expect(Math.abs(after.disclosureTop - before.disclosureTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.primaryActionTop - before.primaryActionTop)).toBeLessThanOrEqual(1);
}

function currentPagePath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
}

async function expectPageTargetInView(locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const geometry = await locator.evaluate((element) => {
    const label = (element as HTMLInputElement).labels?.[0] ?? element;
    return {
      bottom: label.getBoundingClientRect().bottom,
      navigationBottom:
        document.getElementById("global-navigation")?.getBoundingClientRect().bottom ?? 0,
      top: label.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.navigationBottom);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
}

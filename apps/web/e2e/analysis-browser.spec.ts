import type { Page } from "@playwright/test";

import { withReturnTo } from "../src/shared/navigation/returnTo";
import { installAnalysisResponses } from "./fixtures/analysis";
import { seedConfirmedContext } from "./fixtures/records";
import { expect, installE2eAuthHeaders, test as base } from "./support";

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

test("reaches recent ranks by keyboard and opens their saved match", async ({ analysis, page }) => {
  const { matchId } = analysis;
  await page.setViewportSize({ height: 844, width: 390 });
  await openAnalysis(page, analysis);
  const recentRankScrollbar = page.getByRole("slider", { name: "直近順位を横スクロール" });
  const recentRankPlayerLinks = page
    .getByRole("table", { name: "直近の試合順位" })
    .getByRole("row")
    .nth(1)
    .getByRole("link");
  await recentRankScrollbar.focus();
  await recentRankScrollbar.press("Home");
  await expect(recentRankPlayerLinks.first()).toBeInViewport();
  await recentRankScrollbar.press("End");
  await expect(recentRankPlayerLinks.last()).toBeInViewport();
  await expect(recentRankPlayerLinks.last()).toHaveAttribute(
    "href",
    withReturnTo(`/matches/${encodeURIComponent(matchId)}`, currentPagePath(page)),
  );
  await recentRankPlayerLinks.last().click();
  await expect(page.getByRole("heading", { name: "第1試合の結果" })).toBeVisible();
});

test("restores review disclosure and keyboard focus after returning from evidence", async ({
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

  await page.setViewportSize({ height: 844, width: 390 });
  const firstPlayerSection = nextMatchReview
    .getByRole("heading", { exact: true, name: "いーゆー" })
    .locator("..");
  const firstDisclosure = firstPlayerSection.getByRole("button", { name: "いーゆーのほかの仮説" });
  await firstDisclosure.click();
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(
    nextMatchReview.getByRole("heading", {
      exact: true,
      name: expandedReviewHypothesis.actionHypothesis,
    }),
  ).toBeVisible();

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
  await evidenceLink.click();
  const evidenceHeading = page.getByRole("heading", { name: "目的地到着と順位", exact: true });
  await expect(evidenceHeading).toBeFocused();
  await expect(evidenceHeading).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(reviewUrl);
  await expect(firstDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(evidenceLink).toBeFocused();
  await expect(evidenceLink).toBeInViewport();
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

function currentPagePath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
}

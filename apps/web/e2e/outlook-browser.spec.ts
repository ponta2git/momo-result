import type { Locator } from "@playwright/test";

import { installOutlookResponses } from "./fixtures/outlook";
import { seedConfirmedContext } from "./fixtures/records";
import { expect, installE2eAuthHeaders, test as base } from "./support";

type OutlookContext = Awaited<ReturnType<typeof seedConfirmedContext>> &
  Awaited<ReturnType<typeof installOutlookResponses>>;

// Analysis uses owner-derived controlled responses; records and authentication use the API.
// This covers browser integration, not calculation-worker publication.
const test = base.extend<{ outlook: OutlookContext }>({
  outlook: async ({ e2eRun, page, request }, provide) => {
    await installE2eAuthHeaders(page);
    const records = await seedConfirmedContext(request, e2eRun);
    const responses = await installOutlookResponses(page, records);
    await provide({ ...records, ...responses });
  },
});

test("retains an edited outlook through personal review and real match-list navigation", async ({
  outlook,
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(outlookPath(outlook));
  const average = page.getByRole("textbox", { name: "ぽんたのこれからの平均順位" });
  const slider = page.getByRole("slider", { name: "ぽんたの平均順位を動かす" });
  const recent = outlook.summary.recent.players.find(
    (player) => player.memberId === "member_ponta",
  );
  if (!recent) throw new Error("Outlook fixture is missing the focus player");
  const originalMean = recent.rankSum / outlook.summary.recent.matchCount;
  const editedMean = (originalMean + 0.01).toFixed(2);
  await expect(average).toHaveValue(originalMean.toFixed(2));
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(average).toHaveValue(editedMean);
  await expect(page.getByRole("heading", { name: "平均どおりに進むと" })).toBeVisible();

  const charts = page.getByRole("img", { name: /。この先100戦の2人の総合平均順位。/u });
  await expect(charts).toHaveCount(4);
  await expect(charts.locator("path")).toHaveCount(8);
  await expect(page.getByRole("table", { name: "現在と20戦後の総合平均順位" })).toBeVisible();
  const patternPaths = await chartPaths(charts);
  const performanceTab = page.getByRole("tab", { name: "成績から試す" });
  const goalTab = page.getByRole("tab", { name: "戦数から考える" });
  await goalTab.click();
  await expect(charts).toHaveCount(0);

  const outlookUrl = page.url();
  await page.getByRole("link", { name: "ぽんたの行動仮説を見る" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/analytics/series" &&
      !url.searchParams.has("view") &&
      url.searchParams.get("seasonMasterId") === outlook.seasonMasterId &&
      !url.searchParams.has("mapMasterId") &&
      url.hash === "#review-member-member_ponta",
  );
  const personalHeading = page
    .locator("#review-member-member_ponta")
    .getByRole("heading", { name: "ぽんた", exact: true });
  await expect(personalHeading).toBeFocused();
  await expect(personalHeading).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(outlookUrl);
  await expect(goalTab).toHaveAttribute("aria-selected", "true");
  await performanceTab.click();
  await expect(average).toHaveValue(editedMean);
  await expect(charts).toHaveCount(4);
  // Geometry captures both players in every pattern; returning keeps the same outcomes.
  await expect.poll(() => chartPaths(charts)).toEqual(patternPaths);

  await goalTab.click();
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/matches" &&
      url.searchParams.get("gameTitleId") === outlook.gameTitleId
    );
  });
  await page.getByRole("link", { name: "このシーズンの確定戦績を見る" }).click();
  expect((await listResponse).ok()).toBe(true);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/matches" &&
      url.searchParams.get("status") === "confirmed" &&
      url.searchParams.get("gameTitleId") === outlook.gameTitleId &&
      url.searchParams.get("seasonMasterId") === outlook.seasonMasterId &&
      !url.searchParams.has("mapMasterId") &&
      !url.searchParams.has("memberId"),
  );
  await expect(
    page
      .getByRole("region", { name: "試合一覧", exact: true })
      .getByRole("link", { name: `第1試合 ${outlook.mapName}の試合結果を見る` }),
  ).toHaveAttribute("href", new RegExp(`^/matches/${outlook.matchId}\\?`, "u"));
  await page.goBack();
  await expect(page).toHaveURL(outlookUrl);
  await expect(goalTab).toHaveAttribute("aria-selected", "true");
  await performanceTab.click();
  await expect(average).toHaveValue(editedMean);
  await expect(charts).toHaveCount(4);
  await expect.poll(() => chartPaths(charts)).toEqual(patternPaths);
});

test("keeps the season when explicitly leaving a map filter at mobile width", async ({
  outlook,
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`${outlookPath(outlook)}&mapMasterId=${encodeURIComponent(outlook.mapMasterId)}`);
  await expect(
    page.getByText("見通しは全マップの総合成績で試します", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("mapMasterId") === outlook.mapMasterId,
  );
  const charts = page.getByRole("img", { name: /。この先100戦の2人の総合平均順位。/u });
  await expect(charts).toHaveCount(0);
  const summaryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/v1/outlook-summary"),
  );
  await page.getByRole("button", { name: "全マップで試す" }).click();
  const response = await summaryResponse;
  expect(response.ok()).toBe(true);
  const query = new URL(response.url()).searchParams;
  expect(query.get("artifactId")).toBe(outlook.artifact.artifactId);
  expect(query.get("seasonMasterId")).toBe(outlook.seasonMasterId);
  expect(query.has("mapMasterId")).toBe(false);
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("view") === "outlook" &&
      url.searchParams.get("seasonMasterId") === outlook.seasonMasterId &&
      !url.searchParams.has("mapMasterId"),
  );
  const slider = page.getByRole("slider", { name: "ぽんたの平均順位を動かす" });
  await expect(slider).toBeVisible();
  await expect(charts).toHaveCount(4);
  await expect(charts.locator("path")).toHaveCount(8);
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
});

function outlookPath(context: OutlookContext): string {
  return `/analytics/series?${new URLSearchParams({
    gameTitleId: context.gameTitleId,
    seasonMasterId: context.seasonMasterId,
    focusMemberId: "member_ponta",
    rivalMemberId: "member_eu",
    view: "outlook",
  })}`;
}

async function chartPaths(chart: Locator) {
  return chart.locator("path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
}

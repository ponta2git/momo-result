import type { Locator, Page } from "@playwright/test";

import { installOutlookResponses } from "./fixtures/outlook";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, test as base } from "./support";

type OutlookContext = typeof confirmedContext & Awaited<ReturnType<typeof installOutlookResponses>>;

// Analysis uses owner-derived controlled responses; records and authentication are controlled.
// This covers browser integration, not calculation-worker publication.
const test = base.extend<{ outlook: OutlookContext }>({
  outlook: async ({ page }, provide) => {
    await installUiAuth(page);
    const records = confirmedContext;
    const responses = await installOutlookResponses(page, records);
    await provide({ ...records, ...responses });
  },
});

const charts = (page: Page) => page.getByRole("slider", { name: /差の推移|必要なこれからの平均/u });

test("retains an edited outlook within comparison and resets it after match-list navigation", async ({
  outlook,
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(outlookPath(outlook));
  const average = page.getByRole("textbox", { name: "ぽんたのこれからの平均順位" });
  const slider = page.getByRole("slider", { name: "ぽんたの平均順位を動かす" });
  const originalMean = recentMean(outlook);
  const editedMean = (originalMean + 0.01).toFixed(2);
  await expect(average).toHaveValue(originalMean.toFixed(2));
  await expect(page.getByRole("region", { name: "この平均が続くと" })).toBeVisible();
  await expect(charts(page)).toHaveCount(2);
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(average).toHaveValue(editedMean);
  await expect(page.getByRole("button", { name: "ぽんたを直近の成績に戻す" })).toBeVisible();

  const goal = page.getByRole("textbox", { name: "目標の戦数", exact: true });
  await goal.fill("75");
  await goal.press("Enter");

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
  await expect(goal).toHaveValue("75");
  await expect(average).toHaveValue(editedMean);
  await expect(charts(page)).toHaveCount(2);

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
      !url.searchParams.has("status") &&
      url.searchParams.get("gameTitleId") === outlook.gameTitleId &&
      url.searchParams.get("seasonMasterId") === outlook.seasonMasterId &&
      !url.searchParams.has("mapMasterId") &&
      !url.searchParams.has("memberId"),
  );
  await expect(
    page
      .getByRole("region", { name: "試合一覧", exact: true })
      .getByRole("link", { name: `第1試合・${outlook.mapName}` }),
  ).toHaveAttribute("href", `/matches/${outlook.matchId}`);
  await page.goBack();
  await expect(page).toHaveURL(outlookUrl);
  await expect(average).toHaveValue(originalMean.toFixed(2));
  await expect(page.getByRole("button", { name: "ぽんたを直近の成績に戻す" })).toHaveCount(0);
  await expect(goal).toHaveValue("100");
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
  await expect(charts(page)).toHaveCount(0);
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
  // The range input is visually hidden inside its thumb; the thumb is what a reader reaches.
  const thumb = page.getByRole("slider", { name: "ぽんたの平均順位を動かす" }).locator("..");
  await expect(charts(page)).toHaveCount(2);
  await thumb.scrollIntoViewIfNeeded();
  await expect(thumb).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } });

  test("moves a mean only by dragging its thumb, and keeps both answers in view while editing", async ({
    outlook,
    page,
  }) => {
    await page.goto(outlookPath(outlook));
    const average = page.getByRole("textbox", { name: "ぽんたのこれからの平均順位" });
    const original = recentMean(outlook).toFixed(2);
    await expect(average).toHaveValue(original);
    const slider = page.getByRole("slider", { name: "ぽんたの平均順位を動かす" });
    const thumb = slider.locator("..");
    await thumb.scrollIntoViewIfNeeded();
    const touch = await page.context().newCDPSession(page);
    const initial = await centerOf(thumb);
    const scrolled = await page.evaluate(() => window.scrollY);
    // The control around the track: the thumb sits inside it, so this is its full width.
    const track = await centerOf(
      slider.locator("xpath=ancestor::*[contains(@class,'touch-pan-y')][1]"),
    );

    // A touch that only presses the thumb does not snap the exact value.
    await touchPath(touch, [initial, initial]);
    await expect(average).toHaveValue(original);
    // A vertical touch on the track is scrolling, not a value change.
    const away = { x: track.x - 80, y: track.y };
    await touchPath(touch, [away, { x: away.x, y: away.y - 40 }, { x: away.x, y: away.y - 80 }]);
    await expect(average).toHaveValue(original);
    await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(scrolled);
    await settledScroll(page);
    // A fling can leave the thumb offscreen or under the fixed answer strip.
    await thumb.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await thumb.tap({ trial: true });
    const moved = await centerOf(thumb);
    await touchPath(touch, [
      moved,
      { x: moved.x + 20, y: moved.y },
      { x: moved.x + 40, y: moved.y },
      { x: moved.x + 60, y: moved.y },
    ]);
    await expect(average).not.toHaveValue(original);
    // The fixed strip keeps both answers above the inputs.
    const strip = page.locator("[aria-hidden=true]", { hasText: "この平均が続くと" }).first();
    await expect(strip).toBeInViewport();
    await expect(strip).toContainText(/目標100戦後：/u);
  });
});

function recentMean(context: OutlookContext) {
  const recent = context.summary.recent.players.find(
    (player) => player.memberId === "member_ponta",
  );
  if (!recent) throw new Error("Outlook fixture is missing the focus player");
  return recent.rankSum / context.summary.recent.matchCount;
}

/** Waits until a touch scroll, including any fling, has come to rest. */
async function settledScroll(page: Page) {
  let previous = -1;
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.scrollY);
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
}

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element must be laid out.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real touch input through the browser's input pipeline, which Playwright's tap cannot drag. */
async function touchPath(
  session: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>,
  points: ReadonlyArray<{ x: number; y: number }>,
) {
  const [first, ...rest] = points;
  if (!first) return;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: first.x, y: first.y }],
  });
  for (const point of rest)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y }],
    });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

function outlookPath(context: OutlookContext): string {
  return `/analytics/series?${new URLSearchParams({
    gameTitleId: context.gameTitleId,
    seasonMasterId: context.seasonMasterId,
    focusMemberId: "member_ponta",
    rivalMemberId: "member_eu",
    view: "outlook",
  })}`;
}

import {
  makeFourPlayerResults,
  makeHeldEventDetailResponse,
  makeHeldEventResponse,
  makeMatchDetail,
} from "../src/test/factories";
import { mswState } from "../src/test/msw/fixtures";
import { expect, expectNoHorizontalPageOverflow, installE2eAuthHeaders, test } from "./support";

test.beforeEach(async ({ page }) => {
  await installE2eAuthHeaders(page);
});

test("announces the new page through its title and landmark without disturbing condition focus", async ({
  page,
}) => {
  await page.goto("/matches");
  await expect(page.getByRole("region", { name: "試合一覧", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("試合一覧 | 桃鉄戦績台帳");
  await page.getByRole("link", { name: "出力", exact: true }).click();
  await expect(page.getByRole("region", { name: "出力条件" })).toBeVisible();
  await expect(page).toHaveTitle("戦績を出力 | 桃鉄戦績台帳");
  await expect(page.getByRole("main")).toBeFocused();
  const format = page.getByRole("tab", { name: "TSV", exact: true });
  await format.click();
  await expect(format).toBeFocused();
  await expect(format).toHaveAttribute("aria-selected", "true");
  await page.goto("/unknown-page?from=bookmark#section");
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expect(page).toHaveURL(/\/unknown-page\?from=bookmark#section$/u);
  await page.getByRole("link", { name: "試合一覧へ戻る" }).click();
  await expect(page.getByRole("region", { name: "試合一覧", exact: true })).toBeVisible();
});

test("preserves an unfinished numeric edit across responsive layouts and refuses to save the old value", async ({
  page,
}) => {
  const detail = makeMatchDetail({ matchId: "page-edit", players: makeFourPlayerResults() });
  const responses: Record<string, unknown> = {
    "/api/game-titles": { items: mswState.gameTitles },
    "/api/map-masters": { items: mswState.mapMasters },
    "/api/season-masters": { items: mswState.seasonMasters },
    "/api/member-aliases": { items: [] },
    "/api/held-events": { items: [makeHeldEventResponse()] },
    "/api/held-events/held-1": makeHeldEventDetailResponse(),
    "/api/held-events/held-1/summary": makeHeldEventResponse(),
    "/api/matches/page-edit": detail,
  };
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/matches/page-edit" && request.method() === "PUT") {
      writes += 1;
      await route.fulfill({ json: detail });
    } else if (request.method() === "GET" && path in responses) {
      await route.fulfill({ json: responses[path] });
    } else {
      await route.fallback();
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/matches/page-edit/edit");
  await expect(page.getByRole("button", { name: "開催（必須）を変更" })).toBeEnabled();
  const revenue = page.getByRole("textbox", { name: "ぽんた 収益（万円）", exact: true });
  await revenue.fill("-");
  await revenue.press("Tab");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(revenue).toHaveValue("-");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "入力内容を確認してください" })).toBeVisible();
  await expect(revenue).toHaveAttribute("aria-invalid", "true");
  await expect(revenue).toBeFocused();
  await expect(revenue).toHaveValue("-");
  expect(writes).toBe(0);
  await expectNoHorizontalPageOverflow(page);
});

test("asks before discarding an OCR image and retains it when navigation is canceled", async ({
  page,
}) => {
  await page.goto("/ocr/new");
  const exit = page.getByRole("link", { name: "取り込みをやめる" });
  const surface = page.getByRole("region", { name: "OCR取り込み", exact: true });
  const expectLeadingExit = async () => {
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await exit.scrollIntoViewIfNeeded();
      const exitBox = await exit.boundingBox();
      const surfaceBox = await surface.boundingBox();
      if (!exitBox || !surfaceBox) throw new Error("expected visible OCR navigation and content");
      expect(Math.abs(exitBox.x - surfaceBox.x)).toBeLessThanOrEqual(1);
      expect(exitBox.y + exitBox.height).toBeLessThan(surfaceBox.y);
      await expect(surface.getByRole("link", { name: "取り込みをやめる" })).toHaveCount(0);
      await expectNoHorizontalPageOverflow(page);
    }
  };
  await test.step(
    "keep exit navigation outside and before the content at every width",
    expectLeadingExit,
  );
  await page.getByRole("button", { name: "カメラが使えない場合" }).click();
  await page.getByLabel("OCRの画像をアップロード").setInputFiles("public/station.png");
  await expect(page.getByText(/配置済み\s*1\s*件/u)).toBeVisible();
  await exit.click();
  const confirmation = page.getByRole("alertdialog", { name: "未保存の変更を破棄しますか？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "キャンセル" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(exit).toBeFocused();
  await expect(page.getByText(/配置済み\s*1\s*件/u)).toBeVisible();
  await test.step("retain the leading navigation after canceling image discard", expectLeadingExit);
  await exit.click();
  await confirmation.getByRole("button", { name: "破棄して移動" }).click();
  await expect(page.getByRole("region", { name: "試合一覧", exact: true })).toBeVisible();
});

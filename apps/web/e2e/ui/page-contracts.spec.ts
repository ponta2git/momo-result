import type { UpdateMatchResponse } from "../../src/shared/api/matches";
import { makeFourPlayerResults, makeMatchDetail } from "../../src/test/factories";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, test } from "./support";

test.beforeEach(async ({ page }) => {
  await installUiAuth(page);
});

test("announces the new page through its title and landmark without disturbing condition focus", async ({
  page,
}) => {
  await page.goto("/matches");
  await expect(page.getByRole("region", { name: "試合一覧", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("試合一覧 | 桃鉄戦績台帳");
  await page.getByRole("link", { name: "まとめて出力", exact: true }).click();
  await expect(page.getByRole("region", { name: "出力条件" })).toBeVisible();
  await expect(page).toHaveTitle("戦績を出力 | 桃鉄戦績台帳");
  await expect(page.getByRole("main")).toBeFocused();
  const format = page.getByRole("tab", { name: "TSV", exact: true });
  await format.click();
  await expect(format).toBeFocused();
  await expect(format).toHaveAttribute("aria-selected", "true");
});

test("retains an unfinished score across layouts and submits the corrected value once", async ({
  page,
}) => {
  const matchPath = `/matches/${confirmedContext.matchId}`;
  const submissions: unknown[] = [];
  const updated = makeMatchDetail({
    ...confirmedContext,
    layoutFamily: "momotetsu_2",
    players: makeFourPlayerResults([{ revenueManYen: -42 }]),
    version: "1",
  });
  await page.route(`**/api${matchPath}`, async (route) => {
    if (route.request().method() === "PUT") {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          matchId: confirmedContext.matchId,
          heldEventId: confirmedContext.heldEventId,
          matchNoInEvent: 1,
        } satisfies UpdateMatchResponse,
      });
    } else if (route.request().method() === "GET" && submissions.length > 0) {
      await route.fulfill({ json: updated });
    } else await route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${matchPath}/edit`);
  const revenue = page.getByRole("textbox", { name: "ぽんた 収益（万円）", exact: true });
  await revenue.fill("-");
  await revenue.press("Tab");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(revenue).toHaveValue("-");
  await page.getByRole("button", { name: /^ぽんた.*閉じる/u }).click();
  await expect(revenue).toHaveCount(0);
  const save = page.getByRole("button", { name: "保存", exact: true });
  await save.click();
  await expect(page.getByRole("heading", { name: "入力内容を確認してください" })).toBeVisible();
  await expect(revenue).toHaveAttribute("aria-invalid", "true");
  await expect(revenue).toBeFocused();
  await expect(revenue).toHaveValue("-");
  expect(submissions).toHaveLength(0);
  await revenue.fill("-42");
  await save.click();
  await expect(page).toHaveURL(matchPath);
  expect(submissions).toEqual([
    expect.objectContaining({
      players: expect.arrayContaining([
        expect.objectContaining({ memberId: "member_ponta", revenueManYen: -42 }),
      ]),
    }),
  ]);
});

test("asks before discarding an OCR image and retains it when navigation is canceled", async ({
  page,
}) => {
  await page.goto("/ocr/new");
  const exit = page.getByRole("link", { name: "取り込みをやめる" });
  await page.getByRole("button", { name: "カメラが使えない場合" }).click();
  await page
    .getByLabel("OCRの画像をアップロード")
    .setInputFiles("e2e/fixtures/ocr/total-assets.png");
  await expect(page.getByText(/配置済み\s*1\s*件/u)).toBeVisible();
  await exit.click();
  const confirmation = page.getByRole("alertdialog", { name: "未保存の変更を破棄しますか？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "キャンセル" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(exit).toBeFocused();
  await expect(page.getByText(/配置済み\s*1\s*件/u)).toBeVisible();
  await exit.click();
  await confirmation.getByRole("button", { name: "破棄して移動" }).click();
  await expect(page.getByRole("region", { name: "試合一覧", exact: true })).toBeVisible();
});

// Review warning decisions belong to component tests. At mobile width, the
// browser must also reveal and scroll the target editor into the usable viewport.
test("reveals each review warning's editor and scrolls keyboard focus into view on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/review/dev-sample?sample=1");
  const review = page.getByLabel("OCRの確認項目");
  const member = page.getByRole("combobox", { name: /^(?:あかねまみ )?メンバー$/u });
  const rank = page.getByLabel("おーたか 順位", { exact: true });
  await review.getByRole("button", { name: "次の要確認セルへ" }).click();
  await expect(member).toBeFocused();
  await expect(member).toBeInViewport();
  await review.getByRole("button", { name: "次の要確認セルへ" }).click();
  await expect(rank).toBeFocused();
  await expect(rank).toBeInViewport();
  await review.getByRole("button", { name: "前の要確認セルへ" }).click();
  await expect(member).toBeFocused();
  await expect(member).toBeInViewport();
  await review.getByRole("button", { name: "この値で確認済み" }).click();
  await review.getByRole("button", { name: "次の要確認セルへ" }).click();
  await expect(rank).toBeFocused();
  await expect(rank).toBeInViewport();
});

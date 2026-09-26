import type { components } from "../src/shared/api/generated";
import { expect, installE2eAuthHeaders, test } from "./support";

test("moves skip-link focus into the ready page and resumes keyboard navigation there", async ({
  page,
}) => {
  await installE2eAuthHeaders(page);
  await page.goto("/admin/masters?tab=accounts");
  await expect(page.getByRole("heading", { name: "ログインと権限" })).toBeVisible();

  const skip = page.getByRole("link", { name: "メインコンテンツへスキップ" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  const main = page.getByRole("main");
  await expect(main).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await main.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test("exposes overflowing account data to the keyboard only while it needs scrolling", async ({
  page,
}) => {
  await installE2eAuthHeaders(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin/masters?tab=accounts");

  const name = "登録アカウントとログイン・管理者権限";
  const table = page.getByRole("table", { name });
  const scrollArea = page.getByRole("region", { name });
  await expect(table).toBeVisible();
  await expect(scrollArea).toHaveAccessibleDescription("表は左右にスクロールできます。");
  await scrollArea.focus();
  await expect(scrollArea).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => scrollArea.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(scrollArea).toHaveCount(0);
  await expect(table).toBeVisible();
});

test("starts document login navigation when its action becomes pending", async ({ page }) => {
  // Verify the native document-navigation boundary without contacting the OAuth provider.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      json: {
        type: "about:blank",
        status: 401,
        title: "Unauthorized",
        code: "UNAUTHORIZED",
        detail: "A signed-in account is required.",
      } satisfies components["schemas"]["ProblemDetails"],
    }),
  );
  let loginUrl: URL | undefined;
  await page.route("**/api/auth/login?*", async (route) => {
    loginUrl = new URL(route.request().url());
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<main>ログインへの移動を確認</main>",
    });
  });
  await page.goto("/login?next=%2Fmatches%3Fstatus%3Dconfirmed");
  const login = page.getByRole("link", { name: "Discordでログインする" });
  await expect(login).toBeVisible();
  await login.click();
  await expect(page.getByRole("main")).toHaveText("ログインへの移動を確認");
  expect(loginUrl?.searchParams.get("next")).toBe("/matches?status=confirmed");
  expect(loginUrl?.searchParams.get("silent")).toBe("1");
});

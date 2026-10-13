import { seedMasterContext } from "../fixtures/records";
import { expect, test } from "./support";

test.describe("session logout", () => {
  test.use({ sessionRole: "logout" });

  test("logout revokes the session and protected pages require login again", async ({
    page,
    request,
  }) => {
    await page.goto("/matches");
    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
    // The built application has no logout control; exercise its session endpoint in the browser.
    const status = await page.evaluate(async () => {
      const me = (await fetch("/api/auth/me").then((response) => response.json())) as {
        csrfToken: string;
      };
      const logout = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": me.csrfToken },
      });
      return logout.status;
    });
    expect(status).toBe(204);
    await page.reload();
    await expect(page.getByRole("region", { exact: true, name: "ログイン" })).toBeVisible();
    // This independent request context still has the original cookie: revocation must be server-side.
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(401);
    await page.goto("/matches/new");
    await expect(page.getByRole("region", { exact: true, name: "ログイン" })).toBeVisible();
  });
});

test.describe("member permissions", () => {
  test.use({ sessionRole: "user" });

  test("a member can read records but cannot enter operations administration", async ({
    e2eRun,
    page,
    request,
  }) => {
    const { gameTitleId } = await seedMasterContext(request, e2eRun);
    await page.goto("/matches");
    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
    const writeStatus = await page.evaluate(async (id) => {
      const me = (await fetch("/api/auth/me").then((response) => response.json())) as {
        csrfToken: string;
      };
      const response = await fetch("/api/admin/series-analysis/recalculations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ gameTitleId: id }),
      });
      return response.status;
    }, gameTitleId);
    expect(writeStatus).toBe(403);
    await page.goto("/admin/analysis");
    await expect(page.getByRole("region", { name: "運用担当の権限が必要です" })).toBeVisible();
    await expect(page.getByRole("button", { name: "この作品を再計算" })).toHaveCount(0);
    expect((await request.get("/api/admin/login-accounts")).status()).toBe(403);
    await page.getByRole("link", { exact: true, name: "試合" }).click();
    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
  });
});

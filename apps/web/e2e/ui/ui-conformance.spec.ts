import { installAdjacentNavigationResponses } from "./fixtures/adjacentNavigation";
import { confirmedContext, confirmedMatchIds } from "./fixtures/records";
import { expect, installUiAuth, test } from "./support";

test.beforeEach(async ({ page }) => {
  await installUiAuth(page);
});

for (const detail of [
  {
    kind: "held-event",
    route: "held-events",
    firstId: "held-layout-first",
    middleId: "held-layout-middle",
    lastId: "held-layout-last",
    navigationName: "開催の前後移動",
    previousLabel: "前の開催",
    nextLabel: "次の開催",
  },
  {
    kind: "match",
    route: "matches",
    firstId: "match-layout-first",
    middleId: "match-layout-middle",
    lastId: "match-layout-last",
    navigationName: "前後の試合",
    previousLabel: "前の試合",
    nextLabel: "後の試合",
  },
] as const) {
  test(`keeps ${detail.kind} destinations and keyboard focus through adjacent navigation`, async ({
    page,
  }) => {
    await installAdjacentNavigationResponses(page);
    const pathFor = (id: string) => `/${detail.route}/${id}`;
    const navigation = page.getByRole("navigation", { name: detail.navigationName });
    const previous = navigation.getByRole("link", {
      name: new RegExp(`^${detail.previousLabel}`, "u"),
    });
    const next = navigation.getByRole("link", { name: new RegExp(`^${detail.nextLabel}`, "u") });
    const heading = page.getByRole("heading", { level: 1 });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(pathFor(detail.middleId));
    await expect(previous).toHaveAttribute("href", pathFor(detail.firstId));
    await expect(next).toHaveAttribute("href", pathFor(detail.lastId));

    await previous.focus();
    await previous.press("Enter");
    await expect(page).toHaveURL(pathFor(detail.firstId));
    await expect(heading).toBeFocused();
    await expect(previous).toHaveCount(0);

    await next.click();
    await expect(page).toHaveURL(pathFor(detail.middleId));
    await next.click();
    await expect(page).toHaveURL(pathFor(detail.lastId));
    await expect(heading).toBeFocused();
    await expect(next).toHaveCount(0);
  });
}

test("keeps an uncommitted select choice when keyboard focus moves to the next dialog field", async ({
  page,
}) => {
  await page.goto("/admin/masters?tab=accounts");
  await page.getByRole("button", { name: "アカウントを追加", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "アカウントを追加" });
  const trigger = dialog.getByRole("combobox", { name: "紐づくプレーヤー" });

  await trigger.click();
  await expect(page.getByRole("option", { selected: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("checkbox", { name: "ログイン許可" })).toBeFocused();
  await expect(trigger).toHaveText("試合参加者に紐づけない");
});

test("changes an export choice by keyboard and restores focus", async ({ page }) => {
  const { heldEventId } = confirmedContext;
  // Keep the keyboard candidate order explicit for this browser scenario.
  // Candidate records and their directory scope are controlled.
  await page.route(/\/api\/matches(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("heldEventId", heldEventId);
    await route.fallback({ url: url.toString() });
  });

  await test.step("keep export choices native and restore focus after keyboard selection", async () => {
    const selectedMatchId = confirmedMatchIds[0];

    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto(`/exports?matchId=${encodeURIComponent(selectedMatchId)}`);
    await expect(page.getByRole("region", { exact: true, name: "出力条件" })).toBeVisible();

    const changeMatch = page.getByRole("button", { name: "試合を変更" });
    await changeMatch.click();
    const dialog = page.getByRole("dialog", { name: "試合を選択" });
    await expect(dialog).toBeVisible();

    const radios = dialog.getByRole("radio");
    const radioValues = await radios.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
    expect(radioValues).toHaveLength(2);
    expect(radioValues).toEqual(expect.arrayContaining([...confirmedMatchIds]));
    const nextMatchId = confirmedMatchIds[1];

    const selectedRadio = dialog.locator(`input[type="radio"][value="${selectedMatchId}"]`);
    await expect(selectedRadio).toBeChecked();
    await selectedRadio.focus();
    await selectedRadio.press(" ");
    await selectedRadio.press("ArrowDown");

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("matchId")).toBe(nextMatchId);
    await expect(changeMatch).toBeFocused();
  });
});

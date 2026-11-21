import { createDeferred } from "../../src/test/deferred";
import { makeHeldEventDetailResponse } from "../../src/test/factories";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, selectControlOption, test } from "./support";

test("opens the latest event and starts manual and OCR records with its current defaults", async ({
  page,
}) => {
  await installUiAuth(page);
  await page.goto("/");
  await expect(page).toHaveURL(`/held-events/${confirmedContext.heldEventId}`);
  await page.getByRole("link", { name: "手入力", exact: true }).click();
  await expect(page.getByLabel("試合番号", { exact: true })).toHaveValue("5");
  await expect(page.getByRole("combobox", { name: "マップ（必須）" })).toHaveText(
    confirmedContext.mapName,
  );
  await page.goBack();
  await page.getByRole("link", { name: "OCR取り込み", exact: true }).click();
  await expect(page.getByLabel("試合番号", { exact: true })).toHaveValue("5");
  await expect(page.getByRole("combobox", { name: "マップ", exact: true })).toHaveText(
    confirmedContext.mapName,
  );
});

test("keeps keyboard filtering usable while stale held events are protected and the request is retried", async ({
  page,
}) => {
  await installUiAuth(page);
  const { heldEventId, mapMasterId, mapName } = confirmedContext;
  const gate = createDeferred();
  let conditionRequested = false;
  let retryAllowed = false;
  await page.route(/\/api\/held-events(?:\?.*)?$/u, async (route) => {
    if (new URL(route.request().url()).searchParams.get("mapMasterId") === mapMasterId) {
      conditionRequested = true;
      await gate.promise;
      if (!retryAllowed) {
        await route.fulfill({
          status: 500,
          json: {
            code: "INTERNAL_ERROR",
            detail: "E2E retry contract",
            status: 500,
            title: "Internal error",
            type: "about:blank",
          },
        });
        return;
      }
    }
    await route.fallback();
  });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/held-events");
  const list = page.getByRole("region", { exact: true, name: "開催の一覧" });
  await expect(list).toContainText("1開催");
  const map = page.getByRole("combobox", { exact: true, name: "マップ" });
  const sort = page.getByRole("combobox", { exact: true, name: "並び順" });

  try {
    await selectControlOption(page, map, mapMasterId);
    await expect.poll(() => conditionRequested).toBe(true);
    await expect(map).toBeFocused();
    // The retained row stays visible, but its link is unavailable until the new search settles.
    const previousResult = list.getByRole("link", {
      includeHidden: true,
      name: /の開催詳細$/u,
    });
    await expect(previousResult).toBeVisible();
    await expect(previousResult).toHaveAttribute("aria-disabled", "true");
    await previousResult.focus();
    await expect(map).toBeFocused();
    await map.press("Tab");
    await expect(sort).toBeFocused();
  } finally {
    gate.resolve();
  }
  await expect(page.getByText("開催履歴を読み込めません")).toBeVisible();
  await expect(sort).toBeFocused();
  await expect(map).toHaveText(mapName);

  retryAllowed = true;
  await page.getByRole("button", { name: "開催履歴を再読み込み" }).click();
  await expect(page.getByText("開催履歴を読み込めません")).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get("mapMasterId")).toBe(mapMasterId);
  await list.getByRole("link", { name: /の開催詳細$/u }).click();
  await expect(page).toHaveURL(`/held-events/${heldEventId}`);
});

test("a public event checks OCR using its resolved ID and leaves an adjacent event alone after navigation", async ({
  page,
}) => {
  await installUiAuth(page);
  const checkStarted = createDeferred<void>();
  const releaseCheck = createDeferred<void>();
  const checkFinished = createDeferred<void>();
  let fullReads = 0;
  await page.route("**/api/public/held-events/42", async (route) => {
    fullReads += 1;
    await route.fulfill({
      json: makeHeldEventDetailResponse({
        id: "event-with-ocr",
        publicId: "42",
        draftCount: 1,
        drafts: [
          { matchDraftId: "waiting", status: "ocr_running", updatedAt: "2026-01-01T01:00:00Z" },
        ],
        navigation: { next: { id: "next-event", publicId: "43", heldAt: "2026-02-01T00:00:00Z" } },
      }),
    });
  });
  await page.route("**/api/held-events/event-with-ocr/draft-statuses", async (route) => {
    checkStarted.resolve();
    await releaseCheck.promise;
    try {
      await route.fulfill({ json: [{ matchDraftId: "waiting", status: "draft_ready" }] });
    } finally {
      checkFinished.resolve();
    }
  });
  await page.route("**/api/public/held-events/43", (route) =>
    route.fulfill({
      json: makeHeldEventDetailResponse({
        id: "next-event",
        publicId: "43",
        heldAt: "2026-02-01T00:00:00Z",
      }),
    }),
  );
  try {
    await page.goto("/e/42");
    await expect(page.getByRole("button", { name: "読み取り中" })).toBeDisabled();
    await checkStarted.promise;
    await page.getByRole("link", { name: /次の開催/u }).click();
    await expect(page).toHaveURL("/e/43");
    await expect(page.getByRole("heading", { name: "2026/02/01 09:00" })).toBeVisible();
  } finally {
    releaseCheck.resolve();
  }
  await checkFinished.promise;
  expect(fullReads).toBe(1);
  await expect(page.getByRole("link", { name: "内容を確認" })).toHaveCount(0);
});

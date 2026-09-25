import type { Page } from "@playwright/test";

import { devAccountId, devUserStorageKey, expect, installE2eAuthHeaders, test } from "./support";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const noop = () => undefined;

function createDeferred(): Deferred {
  let resolve = noop;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const heldEvents = Array.from({ length: 41 }, (_, index) => ({
  draftCount: 0,
  heldAt: new Date(Date.UTC(2026, 1, 11 - index)).toISOString(),
  id: `held-continuity-${index + 1}`,
  matchCount: index + 1,
  nextMatchNo: index + 2,
}));
const firstHeldEvent = heldEvents[0];
if (!firstHeldEvent) throw new Error("pagination continuity requires a held-event fixture");

async function installHeldEventDirectory(page: Page, pageTwoGate: Deferred): Promise<void> {
  await page.route(/\/api\/held-events(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "10");
    if (pageNumber === 2) await pageTwoGate.promise;
    const offset = (pageNumber - 1) * pageSize;
    await route.fulfill({
      json: {
        items: heldEvents.slice(offset, offset + pageSize),
        pagination: {
          hasNextPage: pageNumber * pageSize < heldEvents.length,
          hasPreviousPage: pageNumber > 1,
          page: pageNumber,
          pageSize,
          totalItems: heldEvents.length,
          totalPages: Math.ceil(heldEvents.length / pageSize),
        },
        totalMatchCount: heldEvents.reduce((sum, event) => sum + event.matchCount, 0),
      },
    });
  });
  await page.route(/\/api\/held-events\/[^/?]+(?:\?.*)?$/u, async (route) => {
    const eventId = new URL(route.request().url()).pathname.split("/").at(-1);
    const event = heldEvents.find((candidate) => candidate.id === eventId) ?? firstHeldEvent;
    const position = heldEvents.findIndex((candidate) => candidate.id === event.id);
    await route.fulfill({
      json: {
        ...event,
        drafts: [],
        matches: [],
        navigation: {
          previous: heldEvents[position + 1],
          next: position > 0 ? heldEvents[position - 1] : undefined,
        },
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [devUserStorageKey, devAccountId],
  );
  await installE2eAuthHeaders(page);
});

test("keeps held-event rows visible and blocks stale actions while the next page loads", async ({
  page,
}) => {
  const pageTwoGate = createDeferred();
  await installHeldEventDirectory(page, pageTwoGate);
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/held-events");

  const history = page.getByRole("region", { name: "開催履歴" });
  // The preserved page becomes inert until the requested page arrives.
  const pager = page.getByRole("navigation", { includeHidden: true, name: "ページネーション" });
  const visibleEventLink = history
    .getByRole("link", { includeHidden: true, name: /の開催詳細$/u })
    .first();
  const nextPage = page.getByRole("button", { includeHidden: true, name: "次のページへ" });
  await expect(visibleEventLink).toBeVisible();

  await nextPage.click();
  await expect(history.getByRole("button", { name: "更新中…", exact: true })).toBeDisabled();
  await expect(history.getByRole("status")).toHaveCount(0);
  await expect(history.getByLabel("開催履歴を読み込み中")).toHaveCount(0);
  await expect(visibleEventLink).toBeVisible();
  await expect(visibleEventLink).toHaveAttribute("aria-disabled", "true");
  await expect(visibleEventLink).not.toHaveAttribute("href");
  await expect(pager).toBeVisible();
  await expect(nextPage).toBeDisabled();

  pageTwoGate.resolve();
  await expect(page.getByText("2／5")).toBeVisible();
  await expect(history.getByRole("button", { name: "更新", exact: true })).toBeEnabled();
  await expect(visibleEventLink).toHaveAttribute("href", /held-continuity-11\?/u);
  await expect(nextPage).toBeEnabled();
  await expect(nextPage).toBeFocused();
  await expect(history.getByRole("status")).toHaveCount(0);
});

test("keeps export choices usable and restores paging focus on mobile", async ({ page }) => {
  const pageTwoGate = createDeferred();
  await installHeldEventDirectory(page, pageTwoGate);
  await page.setViewportSize({ height: 812, width: 375 });
  await page.goto(`/exports?heldEventId=${encodeURIComponent(firstHeldEvent.id)}&format=csv`);

  await page.getByRole("button", { name: "開催を変更" }).click();
  const dialog = page.getByRole("dialog", { name: "開催を選択" });
  const pager = dialog.getByRole("navigation", {
    includeHidden: true,
    name: "開催候補のページネーション",
  });
  const choices = dialog.getByRole("group", { includeHidden: true, name: "開催を選択" });
  const nextPage = dialog.getByRole("button", { name: "次のページへ" });
  const selectedCandidate = dialog.getByRole("radio").first();
  await expect(selectedCandidate).toBeChecked();
  const readyLayout = await Promise.all([choices.boundingBox(), pager.boundingBox()]);

  await nextPage.focus();
  await nextPage.click();
  await expect(dialog.getByRole("status")).toHaveText("更新中");
  await expect(dialog).toHaveAccessibleName("開催を選択");
  expect(await Promise.all([choices.boundingBox(), pager.boundingBox()])).toEqual(readyLayout);
  await expect(dialog.getByRole("button", { name: "ダイアログを閉じる" })).toBeEnabled();
  await expect(selectedCandidate).toBeVisible();
  await expect(pager).toBeVisible();
  await expect(page.getByText("出力対象を確認しています。")).toHaveCount(0);

  pageTwoGate.resolve();
  await expect(dialog.getByText("2／3")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "次のページへ" })).toBeFocused();
});

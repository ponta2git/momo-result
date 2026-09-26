import type { Locator, Page, Route } from "@playwright/test";

import { createDeferred } from "../src/test/deferred";
import { installAdjacentNavigationResponses } from "./fixtures/adjacentNavigation";
import { seedUiContext } from "./fixtures/records";
import {
  selectControlOption,
  expect,
  expectNoHorizontalPageOverflow,
  installE2eAuthHeaders,
  test,
} from "./support";

function readRowPaint(row: Locator) {
  return row.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function expectAdjacentGeometry(
  navigation: Locator,
  previousLabel: string,
  nextLabel: string,
) {
  const readDestination = (label: string) =>
    navigation.getByText(label, { exact: true }).evaluate((element) => {
      const labelRow = element.parentElement;
      const destination = labelRow?.parentElement;
      const description = labelRow?.nextElementSibling;
      const icon = labelRow?.querySelector("svg");
      if (!destination || !labelRow || !description || !icon) {
        throw new Error("expected a direction label, arrow and complete destination");
      }
      // This helper is serialized with the browser callback, outside the test process.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const rect = (target: Element) => {
        const box = target.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          height: box.height,
          width: box.width,
        };
      };
      const style = getComputedStyle(destination);
      const box = rect(destination);
      const range = document.createRange();
      range.selectNodeContents(description);
      return {
        box,
        contentLeft:
          box.left +
          Number(style.borderLeftWidth.replace("px", "")) +
          Number(style.paddingLeft.replace("px", "")),
        contentRight:
          box.right -
          Number(style.borderRightWidth.replace("px", "")) -
          Number(style.paddingRight.replace("px", "")),
        description: rect(description),
        descriptionLines: Array.from(range.getClientRects(), (line) => ({
          left: line.left,
          right: line.right,
        })),
        icon: rect(icon),
        label: rect(element),
        labelRow: rect(labelRow),
      };
    });
  const previous = await readDestination(previousLabel);
  const next = await readDestination(nextLabel);
  expect(Math.abs(previous.box.width - next.box.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(previous.box.top - next.box.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(previous.box.height - next.box.height)).toBeLessThanOrEqual(1);
  expect(next.box.left).toBeGreaterThan(previous.box.right);
  expect(Math.abs(previous.labelRow.top - next.labelRow.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(previous.description.top - next.description.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(previous.labelRow.left - previous.contentLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(next.labelRow.right - next.contentRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(previous.description.left - previous.contentLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(next.description.right - next.contentRight)).toBeLessThanOrEqual(1);
  expect(previous.icon.right).toBeLessThan(previous.label.left);
  expect(next.icon.left).toBeGreaterThan(next.label.right);
  for (const line of previous.descriptionLines) {
    expect(Math.abs(line.left - previous.contentLeft)).toBeLessThanOrEqual(1);
  }
  for (const line of next.descriptionLines) {
    expect(Math.abs(line.right - next.contentRight)).toBeLessThanOrEqual(1);
  }
  for (const destination of [previous, next]) {
    expect(destination.box.height).toBeGreaterThanOrEqual(44);
    expect(destination.description.top).toBeGreaterThanOrEqual(
      destination.labelRow.top + destination.labelRow.height,
    );
  }
  for (const label of [previousLabel, nextLabel]) {
    await expectTextContained(
      navigation.getByText(label, { exact: true }).locator("..").locator(".."),
    );
  }
}

/** Constrain actual component allocation without changing the desktop viewport breakpoints. */
async function withConstrainedParent(subject: Locator, width: number, verify: () => Promise<void>) {
  await subject.evaluate((element, availableWidth) => {
    const parent = document.createElement("div");
    parent.dataset["e2eWidthBoundary"] = "";
    parent.style.width = `${availableWidth}px`;
    element.replaceWith(parent);
    parent.append(element);
  }, width);
  try {
    await verify();
  } finally {
    await subject.evaluate((element) => {
      const parent = element.parentElement;
      if (parent?.dataset["e2eWidthBoundary"] === undefined)
        throw new Error("expected width boundary");
      parent.replaceWith(element);
    });
  }
}

async function expectTextContained(subject: Locator) {
  const geometry = await subject.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const textRects: Array<{
      text: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
    }> = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (
        text &&
        parent &&
        !parent.closest('[aria-hidden="true"]') &&
        getComputedStyle(parent).visibility === "visible"
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) {
            textRects.push({
              text,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            });
          }
        }
      }
      node = walker.nextNode();
    }
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      textRects,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.textRects.length).toBeGreaterThan(0);
  for (const rect of geometry.textRects) {
    expect(rect.left, rect.text).toBeGreaterThanOrEqual(geometry.left - 1);
    expect(rect.right, rect.text).toBeLessThanOrEqual(geometry.right + 1);
    expect(rect.top, rect.text).toBeGreaterThanOrEqual(geometry.top - 1);
    expect(rect.bottom, rect.text).toBeLessThanOrEqual(geometry.bottom + 1);
  }
}

async function expectControlsContained(subject: Locator) {
  const geometry = await subject.evaluate((element) => {
    const parent = element.getBoundingClientRect();
    return {
      left: parent.left,
      right: parent.right,
      controls: Array.from(element.querySelectorAll("button, a")).map((control) => {
        const rect = control.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    };
  });
  expect(geometry.controls.length).toBeGreaterThan(0);
  for (const control of geometry.controls) {
    expect(control.left).toBeGreaterThanOrEqual(geometry.left - 1);
    expect(control.right).toBeLessThanOrEqual(geometry.right + 1);
  }
  for (let index = 1; index < geometry.controls.length; index += 1) {
    const previous = geometry.controls[index - 1];
    const current = geometry.controls[index];
    if (!previous || !current) throw new Error("expected visible controls");
    expect(current.top >= previous.bottom || current.left >= previous.right).toBe(true);
  }
}

test.beforeEach(async ({ page }) => {
  await installE2eAuthHeaders(page);
});

for (const detail of [
  {
    kind: "held-event",
    route: "held-events",
    firstId: "held-layout-first",
    middleId: "held-layout-middle",
    lastId: "held-layout-last",
    returnTo: "/held-events?page=2",
    navigationName: "開催の前後移動",
    previousLabel: "前の開催",
    nextLabel: "次の開催",
    firstDescription: "最初の開催です",
    lastDescription: "最後の開催です",
    previousDescription: "2024/11/30 12:00",
    nextDescription: "2024/12/01 12:00（同日時の次の開催）",
  },
  {
    kind: "match",
    route: "matches",
    firstId: "match-layout-first",
    middleId: "match-layout-middle",
    lastId: "match-layout-last",
    returnTo: "/matches?status=confirmed",
    navigationName: "前後の試合",
    previousLabel: "前の試合",
    nextLabel: "後の試合",
    firstDescription: "前の試合はありません",
    lastDescription: "後の試合はありません",
    previousDescription: "2024/12/01 12:00:00.000・第1試合",
    nextDescription: "2024/12/01 12:00:00.200・第3試合（開催 2024/11/30 12:00）",
  },
] as const) {
  test(`keeps ${detail.kind} directions, complete destinations and focus across narrow layouts`, async ({
    page,
  }) => {
    await installAdjacentNavigationResponses(page);
    const pathFor = (id: string) =>
      `/${detail.route}/${id}?returnTo=${encodeURIComponent(detail.returnTo)}`;
    const navigation = page.getByRole("navigation", { name: detail.navigationName });
    const previous = navigation.getByRole("link", {
      name: new RegExp(`^${detail.previousLabel}`, "u"),
    });
    const next = navigation.getByRole("link", { name: new RegExp(`^${detail.nextLabel}`, "u") });
    const heading = page.getByRole("heading", { level: 1 });

    for (const width of [1440, 375, 320]) {
      await test.step(`${width}px: align both directions and preserve navigation at known ends`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(pathFor(detail.middleId));
        await expect(previous).toHaveAttribute("href", pathFor(detail.firstId));
        await expect(next).toHaveAttribute("href", pathFor(detail.lastId));
        await expect(
          navigation.getByText(detail.previousDescription, { exact: true }),
        ).toBeVisible();
        await expect(navigation.getByText(detail.nextDescription, { exact: true })).toBeVisible();
        await expectAdjacentGeometry(navigation, detail.previousLabel, detail.nextLabel);
        await expectNoHorizontalPageOverflow(page);

        await previous.focus();
        await previous.press("Enter");
        await expect(page).toHaveURL(pathFor(detail.firstId));
        await expect(heading).toBeFocused();
        await expect(previous).toHaveCount(0);
        await expect(navigation.getByText(detail.firstDescription, { exact: true })).toBeVisible();
        await expectAdjacentGeometry(navigation, detail.previousLabel, detail.nextLabel);

        await next.click();
        await expect(page).toHaveURL(pathFor(detail.middleId));
        await expect(heading).toBeFocused();
        await next.click();
        await expect(page).toHaveURL(pathFor(detail.lastId));
        await expect(heading).toBeFocused();
        await expect(next).toHaveCount(0);
        await expect(navigation.getByText(detail.lastDescription, { exact: true })).toBeVisible();
        await expectAdjacentGeometry(navigation, detail.previousLabel, detail.nextLabel);
        await expectNoHorizontalPageOverflow(page);
      });
    }

    if (detail.kind === "match") {
      await test.step("fit headings, actions and facts to their assigned width on a wide screen", async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(pathFor(detail.middleId));
        const header = page.getByRole("main").locator("header").filter({ has: heading });
        const actions = header.getByRole("navigation", { name: "この試合の関連操作" });
        const facts = page.getByRole("region", { name: "第2試合の開催条件" });
        await expect(actions).toBeVisible();
        await expect(facts.getByRole("definition")).toHaveCount(4);

        for (const width of [375, 320]) {
          await withConstrainedParent(header, width, async () => {
            await expectTextContained(header);
            const description = await header.getByText(/^対戦日時/u).boundingBox();
            const actionBox = await actions.boundingBox();
            if (!description || !actionBox) throw new Error("expected visible header content");
            expect(actionBox.y).toBeGreaterThanOrEqual(description.y + description.height);
            await expectControlsContained(header);
          });
          await withConstrainedParent(facts, width, async () => {
            await expectTextContained(facts);
            const terms = await facts.getByRole("term").evaluateAll((elements) =>
              elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.x, y: rect.y, bottom: rect.bottom };
              }),
            );
            for (let index = 1; index < terms.length; index += 1) {
              const previousTerm = terms[index - 1];
              const term = terms[index];
              if (!previousTerm || !term) throw new Error("expected all four facts");
              expect(Math.abs(term.x - previousTerm.x)).toBeLessThanOrEqual(1);
              expect(term.y).toBeGreaterThan(previousTerm.bottom);
            }
          });
        }
      });
    }
  });
}

test("keeps dialog select navigation and outside presses within their own layer", async ({
  page,
}) => {
  await page.goto("/admin/masters?tab=accounts");
  await page.getByRole("button", { name: "アカウントを追加", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "アカウントを追加" });
  const trigger = dialog.getByRole("combobox", { name: "紐づくプレーヤー" });

  await trigger.click();
  await expect(page.getByRole("option", { selected: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("textbox", { name: "表示名", exact: true })).toBeFocused();
  await expect(trigger).toHaveText("試合参加者に紐づけない");

  await trigger.click();
  await expect(page.getByRole("option", { selected: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("checkbox", { name: "ログイン許可" })).toBeFocused();
  await expect(trigger).toHaveText("試合参加者に紐づけない");

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await trigger.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
    const close = await dialog.getByRole("button", { name: "ダイアログを閉じる" }).boundingBox();
    if (!close) throw new Error("Dialog close control is not visible");
    // The pointer must land on the select's transparent backdrop, not the button below it.
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(dialog).toBeVisible();
  }
});

test.describe("touch selection", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 667 } });

  test("opens options without scrolling their field out of view", async ({ page }) => {
    await page.goto("/matches");
    await page.getByRole("button", { name: /詳細条件/u }).tap();
    const trigger = page.getByRole("combobox", { name: "作品", exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const before = await trigger.boundingBox();
    if (!before) throw new Error("Select field is not visible");
    await trigger.tap();
    const popup = page.getByRole("listbox");
    await expect(popup).toBeVisible();
    await expect
      .poll(async () => {
        const rect = await popup.boundingBox();
        return Boolean(rect && rect.y >= 0 && rect.y + rect.height <= 667);
      })
      .toBe(true);
    const after = await trigger.boundingBox();
    expect(Math.abs((after?.y ?? Infinity) - before.y)).toBeLessThanOrEqual(2);
    await expectNoHorizontalPageOverflow(page);
    expect(
      await popup
        .getByRole("option")
        .first()
        .evaluate((row) => row.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
  });
});

test("preserves sample context and geometry while the held-event directory loads", async ({
  page,
}) => {
  await test.step("preserve the query-known sample context through loading", async () => {
    const directoryGate = createDeferred();
    let directoryRequested = false;
    const directoryPattern = /\/api\/held-events(?:\?.*)?$/u;
    const holdDirectory = async (route: Route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET" && url.pathname === "/api/held-events") {
        directoryRequested = true;
        await directoryGate.promise;
      }
      await route.fallback();
    };
    const loadingSurfaceTops = new Map<number, number>();
    await page.route(directoryPattern, holdDirectory);

    try {
      await page.setViewportSize({ height: 844, width: 320 });
      await page.goto("/review/dev-sample?sample=1");
      await expect.poll(() => directoryRequested).toBe(true);
      await expect(page.getByText("サンプルの読み取り結果で表示中", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);

      for (const width of [320, 375]) {
        await page.setViewportSize({ height: 844, width });
        await expectNoHorizontalPageOverflow(page);
        loadingSurfaceTops.set(
          width,
          await page
            .locator('[data-page-content-surface=""]')
            .evaluate((surface) => surface.getBoundingClientRect().top),
        );
      }
    } finally {
      directoryGate.resolve();
      await page.unroute(directoryPattern, holdDirectory);
    }

    await expect(page.getByRole("region", { name: "試合内容" })).toBeVisible();
    await expect(page.getByText("サンプルの読み取り結果で表示中", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    for (const width of [320, 375]) {
      await page.setViewportSize({ height: 844, width });
      await expectNoHorizontalPageOverflow(page);
      const readySurfaceTop = await page
        .locator('[data-page-content-surface=""]')
        .evaluate((surface) => surface.getBoundingClientRect().top);
      const loadingSurfaceTop = loadingSurfaceTops.get(width);
      expect(loadingSurfaceTop).toBeDefined();
      expect(
        Math.abs(readySurfaceTop - (loadingSurfaceTop ?? readySurfaceTop)),
      ).toBeLessThanOrEqual(2);
    }

    await page.getByRole("button", { name: "一覧にない開催を追加する" }).click();
    await expect(page.getByLabel("開催日時", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "作成して選択", exact: true })).toBeEnabled();
  });
});

test("keeps held-event loading, ready and missing states usable at narrow widths", async ({
  e2eRun,
  page,
  request,
}) => {
  const { heldEventId } = await seedUiContext(request, e2eRun);
  await test.step("contain held-event detail loading at the narrow viewport", async () => {
    const detailGate = createDeferred();
    let detailRequested = false;
    let loadingSurfaceTopAt320: number | undefined;
    let loadingSurfaceTop: number | undefined;
    const loadingActionHeights = new Map<number, number>();
    const readLoadingActionHeight = () =>
      page.getByRole("region", { name: "開催内容" }).evaluate((surface) => {
        const actions = surface.firstElementChild?.lastElementChild;
        if (!actions) throw new Error("expected placeholders for the next match actions");
        return actions.getBoundingClientRect().height;
      });
    const detailPattern = `**/api/held-events/${heldEventId}`;
    const holdDetail = async (route: Route) => {
      if (route.request().method() === "GET") {
        detailRequested = true;
        await detailGate.promise;
      }
      await route.fallback();
    };
    await page.route(detailPattern, holdDetail);

    try {
      await page.setViewportSize({ height: 844, width: 320 });
      await page.goto(`/held-events/${heldEventId}?returnTo=%2Fheld-events`);

      await expect(page.getByLabel("開催詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => detailRequested).toBe(true);
      await expectNoHorizontalPageOverflow(page);
      loadingSurfaceTopAt320 = await page
        .getByRole("region", { name: "開催内容" })
        .evaluate((surface) => surface.getBoundingClientRect().top);
      loadingActionHeights.set(320, await readLoadingActionHeight());
      const navigationGeometry = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>("[data-nav-scroll]");
        const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!scroller || !active) throw new Error("expected active global navigation item");
        const scrollerRect = scroller.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        return {
          activeLeft: activeRect.left,
          activeRight: activeRect.right,
          pageScrollX: window.scrollX,
          scrollerLeft: scrollerRect.left,
          scrollerRight: scrollerRect.right,
          scrollerScrollLeft: scroller.scrollLeft,
        };
      });
      expect(navigationGeometry.pageScrollX).toBe(0);
      expect(navigationGeometry.scrollerScrollLeft).toBeGreaterThan(0);
      expect(navigationGeometry.activeLeft).toBeGreaterThanOrEqual(
        navigationGeometry.scrollerLeft - 1,
      );
      expect(navigationGeometry.activeRight).toBeLessThanOrEqual(
        navigationGeometry.scrollerRight + 1,
      );

      await page.setViewportSize({ height: 844, width: 375 });
      loadingSurfaceTop = await page
        .getByRole("region", { name: "開催内容" })
        .evaluate((surface) => surface.getBoundingClientRect().top);
      loadingActionHeights.set(375, await readLoadingActionHeight());
    } finally {
      detailGate.resolve();
      await page.unroute(detailPattern, holdDetail);
    }

    await expect(page.getByText("確定済み2試合・未確定下書き0件", { exact: true })).toBeVisible();
    const readySurfaceTop = await page
      .getByRole("region", { name: "開催内容" })
      .evaluate((surface) => surface.getBoundingClientRect().top);
    await expectHeldEventActionsUsable(page, true);
    expect(loadingSurfaceTop).toBeDefined();
    expect(Math.abs(readySurfaceTop - (loadingSurfaceTop ?? readySurfaceTop))).toBeLessThanOrEqual(
      2,
    );

    await page.setViewportSize({ height: 844, width: 320 });
    await expectNoHorizontalPageOverflow(page);
    const readySurfaceTopAt320 = await page
      .getByRole("region", { name: "開催内容" })
      .evaluate((surface) => surface.getBoundingClientRect().top);
    await expectHeldEventActionsUsable(page, true);
    expect(loadingSurfaceTopAt320).toBeDefined();
    expect(
      Math.abs(readySurfaceTopAt320 - (loadingSurfaceTopAt320 ?? readySurfaceTopAt320)),
    ).toBeLessThanOrEqual(2);

    for (const width of [375, 320]) {
      await page.setViewportSize({ height: 844, width });
      const readyActionHeight = await page
        .getByRole("region", { name: "開催内容" })
        .getByRole("link", { name: "OCR取り込み", exact: true })
        .locator("..")
        .evaluate((actions) => actions.getBoundingClientRect().height);
      const loadingActionHeight = loadingActionHeights.get(width);
      expect(loadingActionHeight).toBeDefined();
      expect(Math.abs(readyActionHeight - (loadingActionHeight ?? 0))).toBeLessThanOrEqual(1);
    }

    await page.route(detailPattern, fulfillHeldEventNotFound);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "開催が見つかりません" })).toBeVisible();
      for (const width of [320, 375]) {
        await page.setViewportSize({ height: 844, width });
        await expectNoHorizontalPageOverflow(page);
        await expectHeldEventActionsUsable(page, false);
      }
    } finally {
      await page.unroute(detailPattern, fulfillHeldEventNotFound);
    }
  });

  await test.step("fit full pagination into a narrow parent on a wide screen", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/held-events");
    const pagination = page.getByRole("navigation", { name: "ページネーション" });
    const pageSize = pagination.getByRole("combobox", { name: "表示件数" });
    await expect(pageSize).toBeVisible();
    for (const width of [375, 320]) {
      await withConstrainedParent(pagination, width, async () => {
        await expectTextContained(pagination);
        await expectControlsContained(pagination);
        const field = await pageSize.boundingBox();
        const arrows = await pagination.getByRole("button").evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right };
          }),
        );
        if (!field) throw new Error("expected visible page-size field");
        expect(arrows).toHaveLength(4);
        for (let index = 0; index < arrows.length; index += 1) {
          const arrow = arrows[index];
          if (!arrow) throw new Error("expected pagination arrow");
          expect(arrow.y).toBeGreaterThan(field.y + field.height);
          const previousArrow = arrows[index - 1];
          if (previousArrow) {
            expect(Math.abs(arrow.y - previousArrow.y)).toBeLessThanOrEqual(1);
            expect(arrow.x).toBeGreaterThan(previousArrow.right);
          }
        }
      });
    }
  });
});

test("keeps match-result loading and ready rows within narrow viewports", async ({
  e2eRun,
  page,
  request,
}) => {
  const { heldEventId, matchIds } = await seedUiContext(request, e2eRun);
  await test.step("stack match-result loading rows without narrow-width collisions", async () => {
    const matchId = matchIds[0];
    if (!matchId) throw new Error("expected a seeded match");
    const matchGate = createDeferred();
    let matchRequested = false;
    const detailPattern = `**/api/matches/${matchId}`;
    const holdMatch = async (route: Route) => {
      if (route.request().method() === "GET") {
        matchRequested = true;
        await matchGate.promise;
      }
      await route.fallback();
    };
    await page.route(detailPattern, holdMatch);

    try {
      await page.setViewportSize({ height: 844, width: 320 });
      await page.goto(`/matches/${matchId}?returnTo=%2Fheld-events%2F${heldEventId}`);
      await expect(page.getByLabel("試合詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => matchRequested).toBe(true);

      for (const width of [320, 375]) {
        await page.setViewportSize({ height: 844, width });
        await expectNoHorizontalPageOverflow(page);
        await expectStackedRowGeometry(page.locator("[data-match-result-loading-row]").first());
      }
    } finally {
      matchGate.resolve();
      await page.unroute(detailPattern, holdMatch);
    }

    await expect(page.getByRole("heading", { name: "第1試合の結果" })).toBeVisible();
    for (const width of [320, 375]) {
      await page.setViewportSize({ height: 844, width });
      await expectNoHorizontalPageOverflow(page);
      await expectStackedRowGeometry(
        page.getByRole("list", { name: "試合の順位と成績" }).getByRole("listitem").first(),
      );
    }
  });
});

test("keeps match rows usable through responsive update and retry states", async ({
  e2eRun,
  page,
  request,
}) => {
  const {
    heldEventId,
    mapName,
    primaryGameTitleId,
    primaryGameTitleName,
    seasonMasterId,
    seasonName,
    secondaryGameTitleId,
  } = await seedUiContext(request, e2eRun);

  await test.step("keep the complete match filter contract at mobile and desktop widths", async () => {
    await page.setViewportSize({ height: 844, width: 320 });
    await page.goto(
      `/matches?heldEventId=${encodeURIComponent(heldEventId)}&gameTitleId=${encodeURIComponent(
        primaryGameTitleId,
      )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}`,
    );

    await expect(page.getByRole("region", { exact: true, name: "試合一覧" })).toBeVisible();
    const filterBar = page.getByRole("region", { name: "試合の表示条件" });
    const statusFilter = filterBar.getByRole("combobox", { exact: true, name: "確定状況" });
    await expect(statusFilter).toBeVisible();
    await expect(statusFilter).toHaveText("すべて");
    await expect(filterBar).toContainText(`作品 ${primaryGameTitleName}`);
    await expect(filterBar).toContainText(`シーズン ${seasonName}`);
    await expect(page.getByRole("region", { name: "登録済みの試合" })).toContainText("2件");
    await expectNoHorizontalPageOverflow(page);

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(filterBar).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  });

  await test.step("continue keyboard filtering while protecting the previous results", async () => {
    const gate = createDeferred();
    let requested = false;
    const pattern = "**/api/matches?**";
    const holdCondition = async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("status") === "confirmed") {
        requested = true;
        await gate.promise;
      }
      await route.fallback();
    };
    await page.route(pattern, holdCondition);
    const status = page.getByRole("combobox", { exact: true, name: "確定状況" });
    const sort = page.getByRole("combobox", { exact: true, name: "並び順" });
    const list = page.getByRole("region", { exact: true, name: "登録済みの試合" });
    try {
      await status.focus();
      await selectControlOption(page, status, "confirmed");
      await expect.poll(() => requested).toBe(true);
      await expect(status).toBeEnabled();
      await expect(status).toBeFocused();
      await expect(list.locator("[inert]")).toHaveCount(1);
      await status.press("Tab");
      await expect(sort).toBeFocused();
    } finally {
      gate.resolve();
      await page.unroute(pattern, holdCondition);
    }
    await expect(list.locator("[inert]")).toHaveCount(0);
    await expect(list.getByRole("table").locator("tbody tr")).toHaveCount(2);
    await expect(sort).toBeFocused();
    await expect(status).toHaveText("確定済み");
  });

  await test.step("keep surface feedback readable and honor a changed motion preference", async () => {
    const action = page.getByRole("link", { exact: true, name: "手入力で作成" });
    const paint = () => action.evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.mouse.move(0, 0);
    const restingPaint = await paint();
    const restingBox = await action.boundingBox();
    await action.hover();
    await expect.poll(paint).not.toBe(restingPaint);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Media change handlers run at the rendering boundary after the protocol call returns.
    // Capture the settled paint, not an arbitrary in-flight hover frame.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const hoverPaint = await paint();
    await expect(action).toHaveCSS("opacity", "1");
    expect(await action.boundingBox()).toEqual(restingBox);
    await page.mouse.move(0, 0);
    await expect.poll(paint).toBe(restingPaint);

    try {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await action.hover();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(paint).toBe(hoverPaint);
      await action.focus();
      await expect(action).toBeFocused();
      await expect(action).not.toHaveCSS("outline-style", "none");
    } finally {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.mouse.move(0, 0);
    }
  });

  await test.step("connect keyboard actions to their row without overriding pointer context", async () => {
    const rows = page.getByRole("table", { name: "登録済みの試合" }).locator("tbody tr");
    const firstRow = rows.first();
    const secondRow = rows.nth(1);
    const result = firstRow.getByRole("link", { name: /の試合結果を見る$/u });
    await page.mouse.move(0, 0);
    const restingPaint = await readRowPaint(firstRow);
    await result.focus();
    await result.press("Tab");
    await expect(firstRow.locator(":focus-visible")).toHaveCount(1);
    await expect(firstRow).not.toHaveAttribute("tabindex");
    const focusPaint = await readRowPaint(firstRow);
    expect(focusPaint).not.toBe(restingPaint);
    await expect(firstRow.locator(":focus-visible")).not.toHaveCSS("outline-style", "none");

    await secondRow.hover();
    await expect.poll(() => readRowPaint(secondRow)).not.toBe(restingPaint);
    expect(await readRowPaint(firstRow)).toBe(focusPaint);
    await firstRow.hover();
    expect(await readRowPaint(firstRow)).toBe(focusPaint);

    await page.mouse.move(0, 0);
    await page.keyboard.press("Shift+Tab");
    await expect(result).toBeFocused();
    expect(await readRowPaint(firstRow)).toBe(focusPaint);
    await page.getByRole("link", { exact: true, name: "手入力で作成" }).focus();
    await expect(firstRow.locator(":focus-visible")).toHaveCount(0);
    await expect.poll(() => readRowPaint(firstRow)).toBe(restingPaint);
  });

  await test.step("distinguish update from retry and preserve visible rows while updating", async () => {
    let holdNextListRequest = false;
    let listRequestHeld = false;
    const listRequestGate = createDeferred();
    const listPattern = /\/api\/matches(?:\?.*)?$/u;
    const holdListRequest = async (route: Route) => {
      const url = new URL(route.request().url());
      if (
        holdNextListRequest &&
        url.pathname === "/api/matches" &&
        url.searchParams.get("heldEventId") === heldEventId
      ) {
        holdNextListRequest = false;
        listRequestHeld = true;
        await listRequestGate.promise;
      }
      await route.fallback();
    };
    await page.route(listPattern, holdListRequest);

    const visibleMatchRow = page
      .getByRole("row")
      .filter({ hasText: mapName })
      .filter({ hasText: "第1試合" });
    await expect(visibleMatchRow).toHaveCount(1);
    holdNextListRequest = true;
    try {
      await page.getByRole("button", { name: "最新情報に更新" }).click();
      await expect.poll(() => listRequestHeld).toBe(true);
      await expect(page.getByRole("button", { name: "一覧を更新中" })).toBeDisabled();
      await expect(page.getByRole("region", { name: "試合の表示条件" })).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(
        await visibleMatchRow.evaluate((row) => Boolean(row.closest('[aria-busy="true"]'))),
      ).toBe(true);
      const updatingStatus = page
        .getByRole("region", { name: "登録済みの試合" })
        .getByRole("status")
        .filter({ hasText: "一覧を更新中" });
      await expect(updatingStatus).toBeVisible();
      expect(
        await updatingStatus.evaluate((status) => status.closest('[aria-busy="true"]')),
      ).toBeNull();
      await expect(visibleMatchRow).toBeVisible();
      await expect(page.getByRole("button", { name: "一覧を再読み込み" })).toHaveCount(0);
    } finally {
      listRequestGate.resolve();
      await page.unroute(listPattern, holdListRequest);
    }
    await expect(page.getByRole("button", { name: "最新情報に更新" })).toBeEnabled();

    let retryAllowed = false;
    const failUncachedScope = async (route: Route) => {
      const url = new URL(route.request().url());
      if (
        !retryAllowed &&
        url.pathname === "/api/matches" &&
        url.searchParams.get("gameTitleId") === secondaryGameTitleId
      ) {
        await route.fulfill({
          json: {
            code: "INTERNAL_ERROR",
            detail: "E2E retry contract",
            status: 500,
            title: "Internal error",
            type: "about:blank",
          },
          status: 500,
        });
        return;
      }
      await route.fallback();
    };
    await page.route(listPattern, failUncachedScope);
    try {
      await page.goto(
        `/matches?status=needs_review&gameTitleId=${encodeURIComponent(secondaryGameTitleId)}`,
      );
      await expect(page.getByText("試合一覧を読み込めません")).toBeVisible();
      await expect(page.getByRole("button", { name: "一覧を再読み込み" })).toBeVisible();
      await expect(page.getByRole("button", { name: "最新情報に更新" })).toBeVisible();

      retryAllowed = true;
      await page.getByRole("button", { name: "一覧を再読み込み" }).click();
      await expect(page.getByText("該当する試合はありません")).toBeVisible();
    } finally {
      retryAllowed = true;
      await page.unroute(listPattern, failUncachedScope);
    }
  });
});

async function expectHeldEventActionsUsable(page: Page, refreshAvailable: boolean) {
  const back = page.getByRole("link", { exact: true, name: "開催履歴へ戻る" });
  const actions = page.getByRole("navigation", { name: "この開催の関連操作" });
  const exportLink = actions.getByRole("link", { exact: true, name: "CSV出力" });
  const refresh = actions.getByRole("button", { name: "開催詳細を更新" });

  await expect(back).toHaveAttribute("href", "/held-events");
  await back.click({ trial: true });
  await exportLink.click({ trial: true });
  await back.focus();
  await back.press("Tab");
  await expect(exportLink).toBeFocused();

  if (refreshAvailable) {
    await expect(refresh).toBeEnabled();
    await refresh.click({ trial: true });
    await exportLink.press("Tab");
    await expect(refresh).toBeFocused();
  } else {
    await expect(refresh).toHaveCount(0);
  }
}

async function fulfillHeldEventNotFound(route: Route) {
  await route.fulfill({
    contentType: "application/json",
    json: {
      code: "NOT_FOUND",
      detail: "E2E held-event terminal layout",
      status: 404,
      title: "Not found",
      type: "about:blank",
    },
    status: 404,
  });
}

async function expectStackedRowGeometry(row: Locator) {
  await expect(row).toBeVisible();

  const geometry = await row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect();
    const childRects = Array.from(element.children, (child) => {
      const rect = child.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    });
    return {
      childRects,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      rowRect: {
        bottom: rowRect.bottom,
        height: rowRect.height,
        left: rowRect.left,
        right: rowRect.right,
        top: rowRect.top,
        width: rowRect.width,
      },
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(geometry.rowRect.height).toBeGreaterThan(0);
  expect(geometry.rowRect.width).toBeGreaterThan(0);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  for (const child of geometry.childRects) {
    expect(child.height).toBeGreaterThan(0);
    expect(child.width).toBeGreaterThan(0);
    expect(child.left).toBeGreaterThanOrEqual(geometry.rowRect.left - 1);
    expect(child.right).toBeLessThanOrEqual(geometry.rowRect.right + 1);
    expect(child.top).toBeGreaterThanOrEqual(geometry.rowRect.top - 1);
    expect(child.bottom).toBeLessThanOrEqual(geometry.rowRect.bottom + 1);
  }
  for (let index = 1; index < geometry.childRects.length; index += 1) {
    const previous = geometry.childRects[index - 1];
    const current = geometry.childRects[index];
    if (!previous || !current) throw new Error("expected result-row geometry");
    expect(current.top).toBeGreaterThanOrEqual(previous.bottom);
  }
  const last = geometry.childRects.at(-1);
  if (!last) throw new Error("expected result-row geometry");
  expect(last.bottom).toBeLessThanOrEqual(geometry.rowRect.bottom + 1);
}

test("changes an export choice by keyboard and restores focus", async ({
  e2eRun,
  page,
  request,
}) => {
  const { heldEventId, matchIds } = await seedUiContext(request, e2eRun);
  // Keep the keyboard candidate order owned by this test, even when other cases seed matches.
  // The API still supplies real candidate records; only its directory scope is controlled.
  await page.route(/\/api\/matches(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("heldEventId", heldEventId);
    await route.fallback({ url: url.toString() });
  });

  await test.step("keep export choices native and restore focus after keyboard selection", async () => {
    const selectedMatchId = matchIds[0];
    if (!selectedMatchId) throw new Error("export conformance requires a seeded match");

    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto(`/exports?matchId=${encodeURIComponent(selectedMatchId)}`);
    await expect(page.getByRole("region", { exact: true, name: "出力条件" })).toBeVisible();

    const changeMatch = page.getByRole("button", { name: "試合を変更" });
    await changeMatch.click();
    const dialog = page.getByRole("dialog", { name: "試合を選択" });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalPageOverflow(page);

    const radios = dialog.getByRole("radio");
    const radioValues = await radios.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
    );
    expect(radioValues).toHaveLength(2);
    expect(radioValues).toEqual(expect.arrayContaining(matchIds));
    const nextMatchId = matchIds[1];
    if (!nextMatchId) throw new Error("export conformance requires a next owned candidate");

    const selectedRadio = dialog.locator(`input[type="radio"][value="${selectedMatchId}"]`);
    await expect(selectedRadio).toBeChecked();
    await selectedRadio.focus();
    await selectedRadio.press(" ");
    const visibleChoice = selectedRadio.locator("..");
    await expect(visibleChoice).toHaveCSS("outline-style", "solid");
    await expect(selectedRadio).toHaveCSS("outline-style", "none");
    try {
      await page.emulateMedia({ forcedColors: "active" });
      await expect(selectedRadio).toBeFocused();
      await expect(visibleChoice).toHaveCSS("outline-style", "solid");
    } finally {
      await page.emulateMedia({ forcedColors: "none" });
    }
    await selectedRadio.press("ArrowDown");

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("matchId")).toBe(nextMatchId);
    await expect(changeMatch).toBeFocused();
  });
});

import type { Page } from "@playwright/test";

import { installRadarResponses } from "./fixtures/radar";
import { expect, installE2eAuthHeaders, selectControlOption, test as base } from "./support";

type RadarContext = Awaited<ReturnType<typeof installRadarResponses>>;
const test = base.extend<{ radar: RadarContext }>({
  radar: async ({ page }, provide) => {
    await installE2eAuthHeaders(page);
    const radar = await installRadarResponses(page);
    try {
      await provide(radar);
    } finally {
      radar.finishWithdrawal();
    }
  },
});

async function openEditor(page: Page, radar: RadarContext) {
  await page.goto(`/admin/analysis?gameTitleId=${radar.gameTitleId}&tab=radar`);
  await page.getByRole("button", { name: "調整を始める" }).click();
  await expect(page.getByRole("table", { name: "採点基準変更前後の比較" })).toBeVisible();
  return page.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
}

async function prepareManualChange(page: Page, radar: RadarContext) {
  await page.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" }).fill("4.95");
  await page.getByRole("button", { name: "変更を適用", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "この基準を作品全体に適用しますか？",
  });
  await expect(confirmation.getByRole("button", { name: "作品全体に適用する" })).toBeEnabled();
  expect(radar.commands).toEqual([
    {
      gameTitleId: radar.gameTitleId,
      kind: "manual",
      expectedCurrentBasisId: "radar-basis-current",
      expectedCandidateId: "radar-candidate",
      sourceBasisId: "radar-basis-current",
      sourceCandidateId: null,
      manualInput: radar.expectedInput,
    },
  ]);
  return confirmation;
}

test("keeps canceled edits, waits for discard, and browses another title's immutable history", async ({
  page,
  radar,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const threshold = await openEditor(page, radar);
  await threshold.fill("-");
  await threshold.press("Enter");
  const nextThreshold = page.getByRole("textbox", { name: "平均順位 3点の境界（位以下）" });
  await expect(nextThreshold).toBeFocused();
  await nextThreshold.press("Shift+Enter");
  await expect(threshold).toBeFocused();

  await page.getByRole("tab", { name: "改訂履歴", exact: true }).click();
  const leave = page.getByRole("alertdialog", { name: "未保存の変更を破棄しますか？" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "キャンセル" }).click();
  await expect(leave).toHaveCount(0);
  await expect(threshold).toHaveValue("-");
  expect(radar.commands).toEqual([]);

  const apply = await prepareManualChange(page, radar);
  await apply.getByRole("button", { name: "キャンセル" }).click();
  await expect(apply).toHaveCount(0);
  await expect(threshold).toHaveValue("4.95");
  await page.getByRole("tab", { name: "改訂履歴", exact: true }).click();
  await leave.getByRole("button", { name: "破棄して移動" }).click();
  await radar.withdrawalStarted;
  await expect(leave.getByRole("button", { name: "破棄して移動" })).toBeDisabled();
  await expect(page).not.toHaveURL(/radarView=history/u);
  expect(radar.commands[1]).toEqual({
    gameTitleId: radar.gameTitleId,
    kind: "withdraw",
    candidateId: "radar-browser-manual-candidate",
    originOperationId: "radar-browser-manual-operation",
  });
  radar.finishWithdrawal();
  await expect(page.getByRole("table", { name: "採点基準の改訂一覧" })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await selectControlOption(
    page,
    page.getByRole("combobox", { name: "履歴の作品" }),
    radar.historyTitleId,
  );
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("historyGameTitleId") === radar.historyTitleId &&
      url.searchParams.get("gameTitleId") === radar.gameTitleId,
  );
  await expect
    .poll(() => radar.historyQueries.at(-1)?.get("gameTitleId"))
    .toBe(radar.historyTitleId);
  await page.getByRole("button", { name: /の改訂詳細$/u }).click();
  const detail = page.getByRole("region", { name: "改訂詳細" });
  await expect(detail.getByText("適用者: 適用時の担当者")).toBeVisible();
  await expect(detail.getByText("案の保存者: 保存時の担当者")).toBeVisible();
  const changedRow = detail
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "2点", exact: true }) });
  await expect(changedRow.getByRole("cell", { name: "4.923456789123", exact: true })).toBeVisible();
  await expect(changedRow.getByRole("cell", { name: "変更あり", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "現在の採点境界", exact: true }).click();
  await expect(page.getByRole("table", { name: "適用中の採点境界" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "対象作品" })).toContainText("桃太郎電鉄2");
  await page.getByRole("button", { name: "調整を始める" }).click();
  await expect(threshold).toHaveValue("4.9");
  await threshold.fill("-");
  await page.getByRole("link", { name: "出力", exact: true }).click();
  await leave.getByRole("button", { name: "破棄して移動" }).click();
  await expect(page.getByRole("region", { name: "出力条件" })).toBeVisible();
  expect(radar.commands.map((command) => command.kind)).toEqual(["manual", "withdraw"]);
});

test("applies the reviewed manual identities once and transfers focus to recalculation", async ({
  page,
  radar,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, radar);
  const confirmation = await prepareManualChange(page, radar);
  await confirmation.getByRole("button", { name: "作品全体に適用する" }).click();
  const recalculation = page.getByRole("tab", { name: "分析の再計算", exact: true });
  await expect(recalculation).toHaveAttribute("aria-selected", "true");
  await expect(recalculation).toBeFocused();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "recalculation");
  expect(radar.commands).toHaveLength(2);
  expect(radar.commands[1]).toEqual({
    gameTitleId: radar.gameTitleId,
    kind: "apply",
    candidateId: "radar-browser-manual-candidate",
    previewId: "radar-browser-manual-preview",
    expectedCurrentBasisId: "radar-basis-current",
  });
});

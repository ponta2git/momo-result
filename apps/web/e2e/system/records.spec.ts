import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { seedConfirmedContext, seedMasterContext, seedUiContext } from "../fixtures/records";
import {
  expect,
  expectGeneratedId,
  expectOk,
  readJsonObject,
  selectControlOption,
  sessionStorageState,
  test,
} from "./support";

test("creates a held event and persists a manually entered result and note", async ({
  e2eRun,
  page,
  request,
}) => {
  const masters = await seedMasterContext(request, e2eRun);
  await page.goto("/held-events");
  await page.getByRole("button", { name: /^(?:最初の)?開催を作成$/u }).click();
  const create = page.getByRole("dialog", { name: "新しい開催を作成" });
  await create.getByLabel("開催日時").fill(e2eRun.uniqueLocalDateTime());
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/held-events") && response.request().method() === "POST",
  );
  await create.getByRole("button", { exact: true, name: "開催を作成" }).click();
  const response = await created;
  await expectOk(response, "create held event with session");
  const heldEventId = expectGeneratedId((await readJsonObject(response))["id"], "held event ID");
  e2eRun.trackHeldEvent(heldEventId);
  await page.getByRole("link", { exact: true, name: "手入力" }).click();
  await selectMasters(page, masters);
  for (const [index, name] of ["ぽんた", "あかねまみ", "おーたか", "いーゆー"].entries()) {
    await page
      .getByLabel(`${name} 総資産（万円）`, { exact: true })
      .fill(String((4 - index) * 123));
    await page.getByLabel(`${name} 収益（万円）`, { exact: true }).fill(String((4 - index) * 12));
  }
  const note = `手入力の記録 ${e2eRun.masterIdSuffix}`;
  await page.getByRole("textbox", { name: "試合メモ（任意）" }).fill(note);
  await page.getByRole("button", { name: "確定前の確認へ進む" }).click();
  const confirmed = page.waitForResponse(
    (value) => value.url().endsWith("/api/matches") && value.request().method() === "POST",
  );
  await page
    .getByRole("dialog", { name: "この内容で確定しますか？" })
    .getByRole("button", { name: "確定する" })
    .click();
  const confirmation = await confirmed;
  await expectOk(confirmation, "confirm manual match with session and CSRF");
  const matchId = expectGeneratedId((await readJsonObject(confirmation))["matchId"], "match ID");
  e2eRun.trackMatch(matchId);
  await expect(page).toHaveURL(`/matches/${matchId}`);
  await page.reload();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  const detailResponse = await request.get(`/api/matches/${matchId}`);
  await expectOk(detailResponse, "read saved manual match");
  expect(await readJsonObject(detailResponse)).toMatchObject({
    heldEventId,
    gameTitleId: masters.gameTitleId,
    mapMasterId: masters.mapMasterId,
    seasonMasterId: masters.seasonMasterId,
    note: { body: note },
    players: ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"].map(
      (memberId, index) => ({
        memberId,
        totalAssetsManYen: (4 - index) * 123,
        revenueManYen: (4 - index) * 12,
        rank: index + 1,
      }),
    ),
  });
});

test("finds a saved match, edits it and exports the saved values", async ({
  e2eRun,
  page,
  request,
}) => {
  const fixture = await seedConfirmedContext(request, e2eRun);
  await page.goto("/matches");
  await page.getByText("詳細条件", { exact: true }).click();
  await page.getByRole("button", { name: "開催を変更" }).click();
  await page
    .getByRole("dialog", { name: "開催を選択" })
    .getByRole("radio", { name: fixture.heldEventLabelPrefix, exact: true })
    .press("Space");
  await page.locator(`a[href="/m/${fixture.matchPublicId}"]:visible`).click();
  await page.getByRole("link", { name: "試合結果を編集" }).click();
  await page.getByLabel("ぽんた 総資産（万円）", { exact: true }).fill("7654");
  await page.getByRole("button", { exact: true, name: "保存" }).click();
  await expect(page).toHaveURL(`/m/${fixture.matchPublicId}`);
  await page.reload();
  const saved = await request.get(`/api/matches/${fixture.matchId}`);
  await expectOk(saved, "read edited match");
  expect(await readJsonObject(saved)).toMatchObject({
    matchId: fixture.matchId,
    players: expect.arrayContaining(
      [{ memberId: "member_ponta", totalAssetsManYen: 7654 }].map((value) =>
        expect.objectContaining(value),
      ),
    ),
  });
  await page.getByRole("link", { name: "この試合を出力" }).click();
  await page.getByRole("tab", { exact: true, name: "TSV" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "この試合をTSVでダウンロード" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error("Missing exported file");
  const [headers, ...rows] = (await readFile(path, "utf8"))
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => line.split("\t"));
  if (!headers) throw new Error("Missing export columns");
  expect(rows).toHaveLength(4);
  const records = rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])),
  );
  expect(records.map((record) => record["総資産"])).toEqual(["7654", "300", "200", "100"]);
  expect(
    records.every(
      (record) => record["マップ"] === fixture.mapName && record["シーズン"] === fixture.seasonName,
    ),
  ).toBe(true);
});

test("deletes only the selected match and leaves the other record usable", async ({
  e2eRun,
  page,
  request,
}) => {
  const fixture = await seedUiContext(request, e2eRun);
  const [deletedId, remainingId] = fixture.matchIds;
  if (!deletedId || !remainingId) throw new Error("Expected two fixture matches");
  const retainedResponse = await request.get(`/api/matches/${remainingId}`);
  await expectOk(retainedResponse, "read record retained before deletion");
  const retained = await readJsonObject(retainedResponse);
  await page.goto(`/matches/${deletedId}`);
  await page.getByRole("button", { exact: true, name: "削除" }).click();
  await page
    .getByRole("alertdialog", { name: "試合を削除しますか？" })
    .getByRole("button", { name: "削除する" })
    .click();
  await expect(page).toHaveURL(`/e/${fixture.heldEventPublicId}`);
  expect((await request.get(`/api/matches/${deletedId}`)).status()).toBe(404);
  const remaining = await request.get(`/api/matches/${remainingId}`);
  await expectOk(remaining, "read record retained after deletion");
  expect(await readJsonObject(remaining)).toMatchObject({
    matchId: remainingId,
    heldEventId: fixture.heldEventId,
    players: retained["players"],
    note: retained["note"],
  });
  await page.goto(`/matches/${remainingId}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: /第2試合の結果/u })).toBeVisible();
  await page.getByRole("link", { name: "試合結果を編集" }).click();
  await expect(page.getByRole("button", { exact: true, name: "保存" })).toBeEnabled();
});

test("saves an independent member alias through administration", async ({ e2eRun, page }) => {
  const alias = `E2E-${e2eRun.masterIdSuffix}`;
  await page.goto("/admin/masters");
  await page.getByRole("tab", { name: "メンバー名寄せ" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "追加" }) });
  await form.locator('input[name="alias"]').fill(alias);
  const created = page.waitForResponse(
    (response) =>
      response.url().includes("/api/member-aliases") && response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "追加" }).click();
  const response = await created;
  await expectOk(response, "create member alias");
  e2eRun.trackAlias(expectGeneratedId((await readJsonObject(response))["id"], "member alias ID"));
  await page.reload();
  await page.getByRole("tab", { name: "メンバー名寄せ" }).click();
  await expect(page.getByText(alias, { exact: true })).toBeVisible();
});

async function selectMasters(
  page: Page,
  ids: { gameTitleId: string; mapMasterId: string; seasonMasterId: string },
) {
  await selectControlOption(page, page.getByRole("combobox", { name: /^作品/u }), ids.gameTitleId);
  await selectControlOption(
    page,
    page.getByRole("combobox", { name: /^シーズン/u }),
    ids.seasonMasterId,
  );
  await selectControlOption(
    page,
    page.getByRole("combobox", { name: /^マップ/u }),
    ids.mapMasterId,
  );
}

test("keeps edited values after a failed save and completes the retry", async ({
  e2eRun,
  page,
  request,
}) => {
  const fixture = await seedConfirmedContext(request, e2eRun);
  await page.goto(`/matches/${fixture.matchId}/edit`);
  const assets = page.getByLabel("ぽんた 総資産（万円）", { exact: true });
  await assets.fill("9876");
  const endpoint = `**/api/matches/${fixture.matchId}`;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "PUT") await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { exact: true, name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "変更を保存できませんでした" })).toBeVisible();
  await expect(assets).toHaveValue("9876");
  const unchanged = await request.get(`/api/matches/${fixture.matchId}`);
  expect(await readJsonObject(unchanged)).toMatchObject({
    players: expect.arrayContaining([
      expect.objectContaining({ memberId: "member_ponta", totalAssetsManYen: 400 }),
    ]),
  });
  await page.unroute(endpoint);
  await page.getByRole("button", { exact: true, name: "保存" }).click();
  await expect(page).toHaveURL(`/m/${fixture.matchPublicId}`);
  await page.reload();
  const updated = await request.get(`/api/matches/${fixture.matchId}`);
  expect(await readJsonObject(updated)).toMatchObject({
    players: expect.arrayContaining([
      expect.objectContaining({ memberId: "member_ponta", totalAssetsManYen: 9876 }),
    ]),
  });
});

test("a concurrent note save preserves both inputs until the user explicitly retries", async ({
  e2eRun,
  page,
  request,
  browser,
  baseURL,
}) => {
  const fixture = await seedConfirmedContext(request, e2eRun);
  await page.goto(`/matches/${fixture.matchId}`);
  await page.getByRole("button", { name: "メモを追加" }).click();
  const localNote = `自分の入力 ${e2eRun.masterIdSuffix}`;
  const otherNote = `別の利用者の入力 ${e2eRun.masterIdSuffix}`;
  await page.getByRole("textbox", { exact: true, name: "試合メモ" }).fill(localNote);
  if (!baseURL) throw new Error("System tests require a base URL");
  const otherContext = await browser.newContext({
    baseURL,
    storageState: await sessionStorageState("user"),
  });
  try {
    const other = await otherContext.newPage();
    await other.goto(`/matches/${fixture.matchId}`);
    await other.getByRole("button", { name: "メモを追加" }).click();
    await other.getByRole("textbox", { exact: true, name: "試合メモ" }).fill(otherNote);
    await other.getByRole("button", { exact: true, name: "保存" }).click();
    await expect(other.getByText(otherNote, { exact: true })).toBeVisible();
    await expect(other.getByRole("textbox", { exact: true, name: "試合メモ" })).toHaveCount(0);

    await page.getByRole("button", { exact: true, name: "保存" }).click();
    await expect(page.getByText("別の利用者が先に更新しました", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { exact: true, name: "試合メモ" })).toHaveValue(
      localNote,
    );
    await expect(page.getByText(otherNote, { exact: true })).toBeVisible();
    const conflicted = await request.get(`/api/matches/${fixture.matchId}`);
    expect(await readJsonObject(conflicted)).toMatchObject({ note: { body: otherNote } });
    await page.getByRole("button", { name: "この入力で再試行" }).click();
    await expect(page.getByRole("textbox", { exact: true, name: "試合メモ" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(localNote, { exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByText(localNote, { exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

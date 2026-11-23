import { makeMatchDraftReviewResponse } from "../../src/test/factories/matchDraftReview";
import { draftPayload } from "../../src/test/msw/fixtures";
import { confirmedContext } from "./fixtures/records";
import { expect, installUiAuth, test } from "./support";

test("keeps the mobile search draft through layout changes and applies it only on submission", async ({
  page,
}) => {
  await installUiAuth(page);
  const { heldEventId, gameTitleId, seasonMasterId } = confirmedContext;
  const initialSearch = new URLSearchParams({
    heldEventId,
    gameTitleId,
    seasonMasterId,
  });
  const requests: URLSearchParams[] = [];
  await page.route(/\/api\/matches(?:\?.*)?$/u, async (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    await route.fallback();
  });
  await page.setViewportSize({ height: 844, width: 320 });
  await page.goto(`/matches?${initialSearch.toString()}`);
  const list = page.getByRole("region", { exact: true, name: "確定済みの試合" });
  await expect(list).toContainText("2試合");
  const initialRequests = requests.length;

  const searchTrigger = page.getByRole("button", { name: /^検索条件/u });
  await searchTrigger.click();
  const dialog = page.getByRole("dialog", { exact: true, name: "検索条件" });
  const memo = dialog.getByLabel("メモに含む語句");
  await memo.fill("ボンビー");
  await page.setViewportSize({ height: 900, width: 1280 });
  await expect(memo).toHaveValue("ボンビー");
  await page.setViewportSize({ height: 844, width: 320 });
  await expect(memo).toHaveValue("ボンビー");
  expect(requests).toHaveLength(initialRequests);
  expect(new URL(page.url()).searchParams.get("q")).toBeNull();

  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(searchTrigger).toBeFocused();
  await searchTrigger.press("Enter");
  await expect(memo).toHaveValue("");
  await memo.fill("ボンビー");
  await dialog.getByRole("button", { name: "この条件で検索" }).click();

  await expect(dialog).not.toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("ボンビー");
  // "1試合" also matches the retained "第1試合" row; wait for the deferred list request itself.
  await expect.poll(() => requests.at(-1)?.get("q")).toBe("ボンビー");
  await expect(list).toContainText("1試合");
  expect(Object.fromEntries(requests.at(-1) ?? [])).toMatchObject({
    ...Object.fromEntries(initialSearch),
    kind: "match",
    status: "confirmed",
    q: "ボンビー",
  });
  await expect(list.getByRole("link", { name: "第1試合・東日本編" })).toBeVisible();
  await expect(list.getByRole("link", { name: "第2試合・東日本編" })).toHaveCount(0);

  await list.getByRole("link", { name: "第1試合をCSV/TSV出力" }).click();
  await expect(page).toHaveURL("/exports?matchId=match-1");
  await expect(page.getByRole("region", { name: "出力条件" })).toBeVisible();
  await page.goBack();
  await expect(list).toContainText("1試合");
  expect(new URL(page.url()).searchParams.get("q")).toBe("ボンビー");

  await page.getByRole("button", { name: "メモ「ボンビー」 を解除" }).click();
  await expect(list).toContainText("2試合");
  expect(new URL(page.url()).searchParams.get("q")).toBeNull();
  expect(new URL(page.url()).searchParams.get("heldEventId")).toBe(heldEventId);
});

test("waits for the member aliases and assigns OCR results after a failed read is retried", async ({
  page,
}) => {
  await installUiAuth(page);
  const review = makeMatchDraftReviewResponse("alias-review");
  const payload = {
    ...draftPayload,
    players: draftPayload.players.map((player, index) => ({
      ...player,
      member_id: null,
      raw_player_name: { ...player.raw_player_name, value: index === 0 ? "青チーム社長" : null },
    })),
  };
  await page.route("**/api/match-drafts/alias-review/review", (route) =>
    route.fulfill({
      json: {
        ...review,
        sourceImages: [],
        ocrDrafts: review.ocrDrafts?.map((draft) => ({ ...draft, payloadJson: payload })),
      },
    }),
  );
  let recovered = false;
  await page.route("**/api/member-aliases", (route) =>
    recovered
      ? route.fulfill({
          json: {
            items: [
              {
                id: "alias-blue",
                memberId: "member_akane_mami",
                alias: "青チーム",
                createdAt: review.draft.createdAt,
              },
            ],
          },
        })
      : route.fulfill({ status: 503, json: { detail: "一覧を一時的に取得できません" } }),
  );
  await page.goto("/review/alias-review");
  const retry = page.getByRole("button", { name: "もう一度読み込む" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("button", { name: "確定前の確認へ進む" })).toHaveCount(0);
  recovered = true;
  await retry.click();
  await expect(page.getByRole("textbox", { name: "あかねまみ 順位" })).toHaveValue("1");
});

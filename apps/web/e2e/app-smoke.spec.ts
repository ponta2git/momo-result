import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse, Page, Request, Route } from "@playwright/test";

import { withReturnTo } from "../src/shared/navigation/returnTo";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisDrilldown,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisReview,
  makeSeriesAnalysisStatus,
} from "../src/test/msw/seriesAnalysisFixtures";

const devAccountId = "account_ponta";
const devUserStorageKey = "momoresult.devUser";
const runId = randomUUID().replaceAll("-", "");
const masterIdSuffix = runId.slice(-18) || "1";
const gameTitleId = `gt_e2e_${masterIdSuffix}`;
const seasonMasterId = `season_e2e_${masterIdSuffix}`;
const mapMasterId = `map_e2e_${masterIdSuffix}`;
const gameTitleName = `桃太郎電鉄2 E2E ${masterIdSuffix}`;
const aliasName = `E2E-${masterIdSuffix}`;
const generatedIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("completes the app smoke workflow with isolated scoped data", async ({ page, request }) => {
  let heldEventId = "";
  let matchId = "";
  let uploadedDraftId = "";

  await test.step("seed scoped masters", async () => {
    await postJson(request, "/api/game-titles", {
      id: gameTitleId,
      name: gameTitleName,
      layoutFamily: "momotetsu_2",
    });
    await postJson(request, "/api/season-masters", {
      id: seasonMasterId,
      gameTitleId,
      name: "E2Eシーズン",
    });
    await postJson(request, "/api/map-masters", {
      id: mapMasterId,
      gameTitleId,
      name: "E2Eマップ",
    });
  });

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [devUserStorageKey, devAccountId],
  );
  await installE2eAuthHeaders(page);

  await test.step("create a held event after dev login", async () => {
    await page.goto("/held-events");

    await expect(page.getByRole("heading", { exact: true, name: "開催履歴" })).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/held-events") && response.request().method() === "POST",
    );
    await page.getByRole("button", { exact: true, name: "開催を作成" }).click();
    const createDialog = page.getByRole("dialog", { name: "新しい開催を作成" });
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel("開催日時").fill(uniqueLocalDateTime());
    await createDialog.getByRole("button", { exact: true, name: "開催を作成" }).click();

    const response = await createResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { id?: string };
    heldEventId = expectGeneratedId(body.id, "held event ID");
    const heldEventDetailHref = withReturnTo(`/held-events/${heldEventId}`, "/held-events");
    await expect(page).toHaveURL(heldEventDetailHref);
    await expect(page.getByText("確定 0試合・未完了 0件。次は第1試合です。")).toBeVisible();
    const manualLinks = await page.getByRole("link", { exact: true, name: "手入力" }).all();
    expect(manualLinks).toHaveLength(2);
    for (const manualLink of manualLinks) {
      await expect(manualLink).toHaveAttribute(
        "href",
        withReturnTo(`/matches/new?heldEventId=${heldEventId}`, currentPagePath(page)),
      );
    }
    const ocrLinks = await page.getByRole("link", { exact: true, name: "OCR取り込み" }).all();
    expect(ocrLinks).toHaveLength(2);
    for (const ocrLink of ocrLinks) {
      await expect(ocrLink).toHaveAttribute(
        "href",
        withReturnTo(`/ocr/new?heldEventId=${heldEventId}`, currentPagePath(page)),
      );
    }
  });

  await test.step("open OCR for the latest held event from held-event history", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/held-events");
    await expect(page.getByRole("heading", { exact: true, name: "開催履歴" })).toBeVisible();

    const latestOcrLink = page.getByRole("link", { name: /の開催にOCR取り込み$/u });
    const expectedOcrHref = withReturnTo(`/ocr/new?heldEventId=${heldEventId}`, "/held-events");
    await expect(latestOcrLink).toHaveCount(1);
    await expect(latestOcrLink).toBeVisible();
    await expect(latestOcrLink).toHaveAttribute("href", expectedOcrHref);

    await page.setViewportSize({ height: 844, width: 390 });
    await expect(latestOcrLink).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
    await latestOcrLink.click();

    await expect(page).toHaveURL(expectedOcrHref);
    await expect(page.getByRole("heading", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /開催（任意）/u })).toHaveValue(heldEventId);
    await expect(page.getByLabel("試合番号")).toHaveValue("1");

    const cancelOcrLink = page.getByRole("link", { exact: true, name: "取り込みをやめる" });
    await expect(cancelOcrLink).toHaveAttribute("href", "/held-events");
    await cancelOcrLink.click();
    await expect(page).toHaveURL("/held-events");
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  await test.step("create a member alias through the admin UI", async () => {
    await page.goto("/admin/masters");

    await expect(page.getByRole("heading", { exact: true, name: "設定管理" })).toBeVisible();
    await page.getByRole("tab", { name: "メンバー名寄せ" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "プレーヤー名の別名" }),
    ).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/member-aliases") && response.request().method() === "POST",
    );
    const createForm = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "追加" }) });
    await createForm.locator('input[name="alias"]').fill(aliasName);
    await page.getByRole("button", { name: "追加" }).click();

    const response = await createResponse;
    expect(response.ok()).toBe(true);
    await expect(page.getByText(aliasName)).toBeVisible();
  });

  await test.step("start an OCR job from an uploaded image", async () => {
    await page.goto("/ocr/new");

    await expect(page.getByRole("heading", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await selectSeedMasters(page);

    const totalAssetsFrame = page.getByRole("group", { name: "総資産の16:9画像枠" });
    await expect(totalAssetsFrame).toBeVisible();
    const emptyFrameBox = await totalAssetsFrame.boundingBox();
    if (!emptyFrameBox) {
      throw new Error("Empty OCR tray frame geometry must be measurable.");
    }
    expect(emptyFrameBox.width / emptyFrameBox.height).toBeCloseTo(16 / 9, 2);

    await page.getByLabel("OCRの画像をアップロード").setInputFiles({
      buffer: png1x1,
      mimeType: "image/png",
      name: "total-assets.png",
    });
    await expect(page.getByAltText("総資産プレビュー")).toBeVisible();
    const selectedFrameBox = await totalAssetsFrame.boundingBox();
    if (!selectedFrameBox) {
      throw new Error("Selected OCR tray frame geometry must be measurable.");
    }
    expect(selectedFrameBox.width).toBeCloseTo(emptyFrameBox.width, 1);
    expect(selectedFrameBox.height).toBeCloseTo(emptyFrameBox.height, 1);

    const draftResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/match-drafts") && response.request().method() === "POST",
    );
    const jobResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/ocr-jobs") && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "読み取りを開始" }).click();
    const startDialog = page.getByRole("dialog", { name: "読み取りを開始しますか？" });
    await expect(startDialog).toBeVisible();
    await expect(startDialog.getByText("1件だけで開始します")).toBeVisible();
    await startDialog.getByRole("button", { name: "1件で読み取りを開始" }).click();

    const draftCreateResponse = await draftResponse;
    expect(draftCreateResponse.ok()).toBe(true);
    const draftBody = (await draftCreateResponse.json()) as { matchDraftId?: string };
    uploadedDraftId = expectGeneratedId(draftBody.matchDraftId, "match draft ID");

    expect((await jobResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/\/matches(?:\?.*)?$/u);
    const matchesPageTitle = page.getByRole("heading", { exact: true, name: "試合一覧" });
    await expect(matchesPageTitle).toBeVisible();
    expect(
      await matchesPageTitle.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return { fontSize: style.fontSize, fontWeight: style.fontWeight };
      }),
    ).toEqual({ fontSize: "24px", fontWeight: "600" });
  });

  await test.step("confirm the sample OCR review into a match detail", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/review/dev-sample?sample=1");

    await expect(page.getByRole("heading", { exact: true, name: "OCR結果の確認" })).toBeVisible();
    await expect(page.getByText("サンプルの読み取り結果で表示中")).toBeVisible();
    const reviewRail = page.getByLabel("OCR確認レール");
    await expect(reviewRail.getByText("未確認 2 / 2")).toBeVisible();
    await reviewRail.getByRole("button", { name: "この値で確認済み" }).click();
    await expect(reviewRail.getByText("未確認 1 / 2")).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await reviewRail.getByRole("button", { name: "次の要確認セルへ" }).click();
    await expect(page.getByLabel("おーたか 順位")).toBeFocused();
    const mobileReviewGeometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(mobileReviewGeometry.innerWidth).toBe(390);
    expect(mobileReviewGeometry.scrollWidth).toBeLessThanOrEqual(mobileReviewGeometry.innerWidth);
    await page.setViewportSize({ height: 900, width: 1440 });

    await page.getByLabel(/開催履歴/u).selectOption(heldEventId);
    await expect(page.getByLabel(/開催履歴/u)).toHaveValue(heldEventId);
    await selectSeedMasters(page);

    const confirmResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/matches") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "確定前の確認へ進む" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "この内容で確定しますか？" }),
    ).toBeVisible();
    const confirmDialog = page.getByRole("dialog", { name: "この内容で確定しますか？" });
    await expect(confirmDialog.getByRole("table", { name: "確定する4人分の結果" })).toBeVisible();
    await expect(confirmDialog.getByText("確認済み 1 / 2")).toBeVisible();
    await expect(confirmDialog.getByText(/未確認の強調項目が1件あります/u)).toBeVisible();
    await page.getByRole("button", { name: "確定する" }).click();

    const response = await confirmResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { matchId?: string };
    matchId = expectGeneratedId(body.matchId, "match ID");

    await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`, "u"));
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
    await expect(page.getByText(gameTitleName, { exact: true })).toBeVisible();
    await page.setViewportSize({ height: 900, width: 1440 });
    await expect(page.getByText("比較データを読み込み中", { exact: true }).first()).toBeVisible();
    const resultLedger = page.getByRole("list", { name: "試合の順位と成績" });
    await expect(resultLedger).toBeVisible();
    const resultLedgerCard = resultLedger.locator("xpath=..");
    await expect(resultLedgerCard).toBeVisible();
    const resultLedgerCardBox = await resultLedgerCard.boundingBox();
    if (!resultLedgerCardBox) {
      throw new Error("Result ledger card geometry must be measurable.");
    }
    expect(resultLedgerCardBox.width).toBeLessThanOrEqual(896);
    const firstLedgerRow = resultLedgerCard.getByRole("listitem").first();
    const rankBox = await firstLedgerRow.getByText("1位", { exact: true }).boundingBox();
    const totalAssetsBox = await firstLedgerRow
      .getByText("総資産", { exact: true })
      .locator("..")
      .boundingBox();
    if (!rankBox || !totalAssetsBox) {
      throw new Error("Result ledger primary columns must be measurable.");
    }
    expect(totalAssetsBox.x - rankBox.x).toBeLessThanOrEqual(480);

    await page.getByRole("link", { name: "この開催へ戻る" }).click();
    await expect(page).toHaveURL(`/held-events/${heldEventId}`);
    await expect(page.getByRole("heading", { exact: true, name: "この開催の戦績" })).toBeVisible();
    const eventMatchLink = page.getByRole("link", { name: /第\d+試合の結果を見る/u });
    const matchFromHeldEventHref = withReturnTo(`/matches/${matchId}`, currentPagePath(page));
    await expect(eventMatchLink).toHaveAttribute("href", matchFromHeldEventHref);
    await expect(page.getByRole("link", { name: /第\d+試合を戦績比較で見る/u })).toBeVisible();
    await eventMatchLink.click();
    await expect(page).toHaveURL(matchFromHeldEventHref);
  });

  await test.step("inspect saved analysis, refresh states, and details", async () => {
    const desktopViewport = page.viewportSize();
    const artifact = {
      ...analysisArtifact,
      artifactId: `artifact-e2e-${masterIdSuffix}`,
      gameTitleId,
      inputRevision: "1",
    };
    const analysisScope = {
      displayName: "E2Eシーズン / E2Eマップ",
      kind: "season_map" as const,
      mapMasterId,
      matchCount: 1,
      seasonMasterId,
    };
    const optionsFixture = makeSeriesAnalysisOptions();
    optionsFixture.defaultGameTitleId = gameTitleId;
    optionsFixture.titles = [
      {
        confirmedMatchCount: 1,
        displayName: gameTitleName,
        gameTitleId,
        maps: [{ displayName: "E2Eマップ", mapMasterId }],
        seasonMapPairs: [{ mapMasterId, seasonMasterId }],
        seasons: [{ displayName: "E2Eシーズン", seasonMasterId }],
      },
    ];
    const aggregateFixture = makeSeriesAnalysisAggregate(artifact);
    aggregateFixture.scope = analysisScope;
    const recentMatch = aggregateFixture.matchDigest.recent[0];
    if (!recentMatch) throw new Error("analysis aggregate fixture requires a recent match");
    Object.assign(recentMatch, {
      itemId: `match:${matchId}`,
      matchId,
      matchIndex: 1,
      matchNoInEvent: 1,
    });
    const recentRank = aggregateFixture.recentRanks[0]?.rows[0];
    if (recentRank) {
      recentRank.itemId = `recent-rank:member_ponta:${matchId}`;
      recentRank.matchId = matchId;
    }
    const strategyPoint = aggregateFixture.strategyScatter.points[0];
    if (strategyPoint) {
      strategyPoint.itemId = `strategy-point:${matchId}:member_ponta`;
      strategyPoint.matchId = matchId;
      strategyPoint.matchIndex = 1;
    }
    const trendPoint = aggregateFixture.trends[0]?.points[0];
    if (trendPoint) {
      trendPoint.itemId = `trend:rank_cumulative_average:member_ponta:${matchId}`;
      trendPoint.matchId = matchId;
      trendPoint.index = 1;
    }
    const reviewFixture = makeSeriesAnalysisReview();
    reviewFixture.artifact = artifact;
    reviewFixture.scope = analysisScope;
    const matchContextFixture = makeSeriesAnalysisMatchContext();
    matchContextFixture.artifact = artifact;
    matchContextFixture.matchId = matchId;
    matchContextFixture.scope = analysisScope;
    if (matchContextFixture.match) {
      matchContextFixture.match.matchIndex = 1;
      matchContextFixture.match.focusedItemIds = [
        "rank-distribution:member_ponta:1",
        "play-order:member_ponta:1",
        `recent-rank:member_ponta:${matchId}`,
        `strategy-point:${matchId}:member_ponta`,
        "revenue-rank:member_ponta:1:1",
        "momentum:member_ponta:4:1",
        "card-shop:member_ponta:destination_with_shop",
        `trend:rank_cumulative_average:member_ponta:${matchId}`,
        `match:${matchId}`,
      ];
    }

    let statusPhase: "failed" | "running" = "running";
    const statusPattern = /\/api\/analytics\/series-comparison\/v2\/status(?:\?.*)?$/u;
    await page.route(/\/api\/analytics\/series-comparison\/v2\/options(?:\?.*)?$/u, async (route) =>
      route.fulfill({ json: optionsFixture }),
    );
    await page.route(statusPattern, async (route) => {
      const calculation =
        statusPhase === "running"
          ? {
              finishedAt: null,
              requestedAt: "2026-08-09T01:05:00.000Z",
              startedAt: "2026-08-09T01:05:01.000Z",
              status: "running" as const,
              trigger: "match_mutation" as const,
            }
          : {
              finishedAt: "2026-08-09T01:06:00.000Z",
              requestedAt: "2026-08-09T01:05:00.000Z",
              startedAt: "2026-08-09T01:05:01.000Z",
              status: "failed" as const,
              trigger: "match_mutation" as const,
            };
      await route.fulfill({
        json: makeSeriesAnalysisStatus({
          artifactFreshness: "stale",
          calculation,
          currentArtifact: artifact,
          desired: {
            algorithmVersion: artifact.algorithmVersion,
            artifactSchemaVersion: artifact.artifactSchemaVersion,
            inputRevision: "2",
          },
          gameTitleId,
        }),
      });
    });
    await page.route(
      /\/api\/analytics\/series-comparison\/v2\/aggregate(?:\?.*)?$/u,
      async (route) => route.fulfill({ json: aggregateFixture }),
    );
    await page.route(/\/api\/analytics\/series-comparison\/v2\/review(?:\?.*)?$/u, async (route) =>
      route.fulfill({ json: reviewFixture }),
    );
    await page.route(
      /\/api\/analytics\/series-comparison\/v2\/drilldown(?:\?.*)?$/u,
      async (route) => {
        const url = new URL(route.request().url());
        const fixture = makeSeriesAnalysisDrilldown(
          url.searchParams.get("metricId") ?? "rank.averageHistory",
        );
        fixture.artifact = artifact;
        fixture.scope = analysisScope;
        if (fixture.payload.kind === "rank_average_history") {
          for (const row of fixture.payload.matchRows) {
            row.itemId = `rank-history:${matchId}`;
            row.matchId = matchId;
            row.matchIndex = 1;
            row.matchNoInEvent = 1;
          }
        }
        await route.fulfill({ json: fixture });
      },
    );
    await page.route(
      /\/api\/analytics\/series-comparison\/v2\/match-context(?:\?.*)?$/u,
      async (route) => route.fulfill({ json: matchContextFixture }),
    );

    await page.setViewportSize({ height: 844, width: 390 });
    const comparisonLink = page.getByRole("link", { name: "前後の戦績を見る" });
    const comparisonHref = withReturnTo(
      `/analytics/series?gameTitleId=${encodeURIComponent(
        gameTitleId,
      )}&seasonMasterId=${encodeURIComponent(seasonMasterId)}&mapMasterId=${encodeURIComponent(
        mapMasterId,
      )}&focusMatchId=${encodeURIComponent(matchId)}&view=flow`,
      currentPagePath(page),
    );
    await expect(comparisonLink).toHaveAttribute("href", comparisonHref);
    await comparisonLink.click();

    await expect(page.getByRole("heading", { exact: true, name: "戦績比較" })).toBeVisible();
    await expect(page.getByText("新しい戦績データを計算中です")).toBeVisible();
    await expect(page.getByText(/更新のデータを表示します/u)).toBeVisible();
    const selectedMatch = page.getByRole("region", { name: "選択中の試合" });
    await expect(selectedMatch.getByRole("heading", { name: /第1戦/u })).toBeVisible();
    await expect(selectedMatch.getByRole("list", { name: "この試合の注目点" })).toBeVisible();
    await expect(selectedMatch.getByText("ぽんた")).toBeVisible();
    await expect(page.locator('[data-focused-metric="true"]').first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "最近の試合と荒れ方" })).toBeVisible();
    await expectNoHorizontalPageOverflow(page);

    await page.getByRole("tab", { name: "今の差" }).click();
    await expect(page.getByRole("heading", { name: "順位と基礎比較" })).toBeVisible();
    await expect(selectedMatch).toBeVisible();
    await expect(page.locator('[data-focused-metric="true"]').first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`focusMatchId=${encodeURIComponent(matchId)}`, "u"));
    await page.getByRole("button", { name: "推移" }).first().click();
    const rankDialog = page.getByRole("dialog", { name: "平均順位の推移" });
    await expect(rankDialog.getByRole("cell", { name: "第1戦" })).toBeVisible();
    await rankDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();

    await page.setViewportSize({ height: 900, width: 1440 });
    await page.getByRole("tab", { name: "次戦に備える" }).click();
    await expect(page.getByText(/次の4戦で/u)).toBeVisible();
    await expect(selectedMatch).toBeVisible();
    await page.getByRole("button", { name: "根拠・注意・試合後の確認" }).click();
    const evidenceDialog = page.getByRole("dialog", { name: "根拠・注意・試合後の確認" });
    await expect(evidenceDialog.getByText("データ上の理由")).toBeVisible();
    await expect(evidenceDialog.getByText(/対象 5戦／ぶれにくさ/u)).toBeVisible();
    await evidenceDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();

    statusPhase = "failed";
    const failedStatusResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/v2/status"),
    );
    await page.getByRole("button", { name: "分析を再読み込み" }).click();
    expect((await failedStatusResponse).ok()).toBe(true);
    await expect(page.getByText("分析データを再計算できませんでした")).toBeVisible();
    await expect(page.getByText(/更新のデータを表示しています/u)).toBeVisible();

    await selectedMatch.getByRole("button", { name: "選択解除" }).click();
    await expect(selectedMatch).toHaveCount(0);
    await expect(page).not.toHaveURL(/focusMatchId=/u);

    if (desktopViewport) await page.setViewportSize(desktopViewport);
  });

  await test.step("run analysis administration and enforce admin access", async () => {
    await page.goto("/admin/analysis");
    await expect(page.getByRole("heading", { exact: true, name: "戦績分析" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "全体の実行状況" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "直近3件" })).toBeVisible();

    const titleSelect = page.getByRole("combobox", { name: "対象作品" });
    await titleSelect.selectOption(gameTitleId);
    await expect(titleSelect).toHaveValue(gameTitleId);

    const titleResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/series-analysis/recalculations") &&
        !response.url().endsWith("/all") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "この作品を再計算" }).click();
    const acceptedTitleResponse = await titleResponse;
    expect(acceptedTitleResponse.status()).toBe(202);
    expect(acceptedTitleResponse.request().postDataJSON()).toEqual({ gameTitleId });

    await page.getByRole("button", { name: "全作品を再計算" }).click();
    const allDialog = page.getByRole("alertdialog", {
      name: "全作品の再計算を予約しますか？",
    });
    await expect(allDialog).toContainText(/作品を対象として予約します/u);
    const allResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/series-analysis/recalculations/all") &&
        response.request().method() === "POST",
    );
    await allDialog.getByRole("button", { name: "全作品を再計算" }).click();
    const acceptedAllResponse = await allResponse;
    expect(acceptedAllResponse.status()).toBe(202);
    expect(acceptedAllResponse.request().postDataJSON()).toEqual({
      confirmation: "all_titles",
    });

    await page.setViewportSize({ height: 844, width: 390 });
    await expectNoHorizontalPageOverflow(page);

    await page.route("**/api/**", continueWithE2eNonAdminAuth);
    await page.goto("/admin/analysis");
    await expect(page.getByText("管理者権限が必要です")).toBeVisible();
    await expect(page.getByRole("button", { name: "この作品を再計算" })).toHaveCount(0);
    await page.unroute("**/api/**", continueWithE2eNonAdminAuth);
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  await test.step("filter and sort the confirmed match list", async () => {
    expectGeneratedId(heldEventId, "held event ID");
    expectGeneratedId(matchId, "match ID");

    await page.goto("/matches");

    await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();

    const statusResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isMatchListResponse(response) &&
        url.searchParams.get("status") === "confirmed" &&
        url.searchParams.get("heldEventId") === null
      );
    });
    const confirmedStatusButton = page.getByRole("button", { exact: true, name: "確定済" });
    await expect(confirmedStatusButton).toBeEnabled();
    await confirmedStatusButton.click();
    expect((await statusResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]status=confirmed(?:&|$)/u);

    const heldEventResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return isMatchListResponse(response) && url.searchParams.get("heldEventId") === heldEventId;
    });
    await page.getByText("詳細条件", { exact: true }).click();
    const heldEventSelect = page.getByRole("combobox", { name: "開催" });
    await expect(heldEventSelect).toBeEnabled();
    await heldEventSelect.selectOption(heldEventId);
    expect((await heldEventResponse).ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`[?&]heldEventId=${heldEventId}(?:&|$)`, "u"));
    const confirmedMatchRow = matchTableRow(page, matchId);
    await expect(confirmedMatchRow).toBeVisible();
    await expect(confirmedMatchRow.getByText(gameTitleName)).toBeVisible();

    const sortResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        isMatchListResponse(response) &&
        url.searchParams.get("heldEventId") === heldEventId &&
        url.searchParams.get("sort") === "updated_desc"
      );
    });
    const sortSelect = page.getByRole("combobox", { name: "並び順" });
    await expect(sortSelect).toBeEnabled();
    await sortSelect.selectOption("updated_desc");
    expect((await sortResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]sort=updated_desc(?:&|$)/u);

    await sortSelect.selectOption("held_desc");
    await expect(sortSelect).toHaveValue("held_desc");
    await expect(page).not.toHaveURL(/[?&]sort=/u);
    await expect(confirmedMatchRow).toBeVisible();
  });

  await test.step("open match detail immediately with a loading shell from the list", async () => {
    expectGeneratedId(heldEventId, "held event ID");
    expectGeneratedId(matchId, "match ID");

    let releaseDetailResponse!: () => void;
    let detailApiRequested = false;
    const detailHold = new Promise<void>((resolve) => {
      releaseDetailResponse = resolve;
    });
    const detailUrlPattern = `**/api/matches/${matchId}`;
    await page.route(detailUrlPattern, async (route) => {
      if (route.request().method() !== "GET") {
        await continueWithE2eAuth(route);
        return;
      }

      detailApiRequested = true;
      await detailHold;
      await continueWithE2eAuth(route);
    });

    await page.goto(`/matches?status=confirmed&heldEventId=${heldEventId}`);

    await expect(page.getByRole("heading", { exact: true, name: "試合一覧" })).toBeVisible();
    const detailLink = matchDetailLink(page, matchId);
    await expect(detailLink).toHaveCount(1);
    await expect(detailLink).toBeVisible();
    const matchFromListHref = withReturnTo(`/matches/${matchId}`, currentPagePath(page));
    await expect(detailLink).toHaveAttribute("href", matchFromListHref);
    await detailLink.click();

    await expect(page).toHaveURL(matchFromListHref);
    await expect(page.getByLabel("試合詳細を読み込み中")).toHaveAttribute("aria-busy", "true");
    await expect(
      page.getByRole("heading", { exact: true, name: "試合結果を読み込み中" }),
    ).toBeVisible();
    await expect.poll(() => detailApiRequested).toBe(true);

    releaseDetailResponse();
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
    await page.unroute(detailUrlPattern);
  });

  await test.step("download an export for the confirmed match", async () => {
    expectGeneratedId(matchId, "match ID");

    await page.goto(`/exports?matchId=${encodeURIComponent(matchId)}&format=tsv`);

    await expect(page.getByRole("heading", { exact: true, name: "CSV/TSV出力" })).toBeVisible();
    await expect(page.getByRole("button", { name: "試合を変更" })).toBeVisible();
    await expect(page.getByText(/第1試合.*TSVで書き出します。/u)).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ height: 812, width: 375 });
    const mobileExportGeometry = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(mobileExportGeometry.innerWidth).toBe(375);
    expect(mobileExportGeometry.reducedMotion).toBe(true);
    expect(mobileExportGeometry.scrollWidth).toBeLessThanOrEqual(mobileExportGeometry.innerWidth);
    expect(
      await page
        .getByRole("button", { name: "試合を変更" })
        .evaluate((element) => window.getComputedStyle(element).transitionDuration),
    ).toBe("0s");

    await page.getByRole("button", { name: "試合を変更" }).click();
    const candidateDialog = page.getByRole("dialog", { name: "試合を選択" });
    await expect(candidateDialog).toBeVisible();
    await expect(candidateDialog.getByRole("radio", { name: /第1試合/u })).toBeChecked();
    await expectNoHorizontalPageOverflow(page);
    await candidateDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
    await expect(candidateDialog).toBeHidden();

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ height: 900, width: 1440 });

    const exportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/exports/matches") && response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "この試合をTSVでダウンロード" }).click();

    const response = await exportResponse;
    expect(response.ok()).toBe(true);
    const url = new URL(response.url());
    expect(url.searchParams.get("format")).toBe("tsv");
    expect(url.searchParams.get("matchId")).toBe(matchId);
    await expect(
      page.getByRole("heading", { exact: true, name: "ダウンロードを開始しました" }),
    ).toBeVisible();
  });

  await test.step("delete discarded OCR draft and scoped masters after deleting the match", async () => {
    expectGeneratedId(uploadedDraftId, "match draft ID");
    expectGeneratedId(matchId, "match ID");

    const cancelResponse = await postMutation(
      request,
      `/api/match-drafts/${uploadedDraftId}/cancel`,
    );
    await expectOk(cancelResponse, "cancel uploaded draft");

    const draftAfterCancel = await request.get(`/api/match-drafts/${uploadedDraftId}`, {
      headers: {
        "X-Momo-Account-Id": devAccountId,
      },
    });
    expect(draftAfterCancel.status()).toBe(404);

    const blockedMapDelete = await deleteJson(request, `/api/map-masters/${mapMasterId}`);
    expect(blockedMapDelete.status()).toBe(409);

    const matchDelete = await deleteJson(request, `/api/matches/${matchId}`);
    await expectOk(matchDelete, "delete confirmed match");

    await expectDeleted(await deleteJson(request, `/api/map-masters/${mapMasterId}`), mapMasterId);
    await expectDeleted(
      await deleteJson(request, `/api/season-masters/${seasonMasterId}`),
      seasonMasterId,
    );
    await expectDeleted(await deleteJson(request, `/api/game-titles/${gameTitleId}`), gameTitleId);
  });
});

function uniqueLocalDateTime(): string {
  const numericRunId = Number.parseInt(masterIdSuffix.slice(-8), 16);
  const minutes = Number.isFinite(numericRunId) ? numericRunId % (20 * 24 * 60) : 0;
  const value = new Date(Date.UTC(2026, 4, 1, 0, minutes));
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}T${value
    .getUTCHours()
    .toString()
    .padStart(2, "0")}:${value.getUTCMinutes().toString().padStart(2, "0")}`;
}

async function postJson(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request.post(path, {
    data,
    headers: {
      "Idempotency-Key": `e2e-${masterIdSuffix}-${path.split("/").at(-1)}`,
      "X-CSRF-Token": "dev",
      "X-Momo-Account-Id": devAccountId,
    },
  });
  await expectOk(response, path);
  return (await response.json()) as Record<string, unknown>;
}

async function deleteJson(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.delete(path, {
    headers: {
      "Idempotency-Key": `e2e-${masterIdSuffix}-${path.replaceAll(/[^a-z0-9]+/giu, "-")}`,
      "X-CSRF-Token": "dev",
      "X-Momo-Account-Id": devAccountId,
    },
  });
}

async function postMutation(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.post(path, {
    headers: {
      "Idempotency-Key": `e2e-${masterIdSuffix}-${path.replaceAll(/[^a-z0-9]+/giu, "-")}`,
      "X-CSRF-Token": "dev",
      "X-Momo-Account-Id": devAccountId,
    },
  });
}

async function expectDeleted(response: APIResponse, id: string): Promise<void> {
  await expectOk(response, id);
  expect((await response.json()) as { deleted?: boolean; id?: string }).toMatchObject({
    deleted: true,
    id,
  });
}

async function expectOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) {
    return;
  }
  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
}

async function installE2eAuthHeaders(page: Page): Promise<void> {
  // Runtime E2E exercises the built web bundle, where import.meta.env.DEV is false.
  // Inject the dev auth contract at the browser boundary instead of relying on localStorage.
  await page.route("**/api/**", continueWithE2eAuth);
}

async function continueWithE2eAuth(route: Route): Promise<void> {
  await route.continue({ headers: e2eAuthHeaders(route.request()) });
}

async function continueWithE2eNonAdminAuth(route: Route): Promise<void> {
  await route.continue({ headers: e2eAuthHeaders(route.request(), "account_eu") });
}

function e2eAuthHeaders(
  request: Request,
  accountId: string = devAccountId,
): Record<string, string> {
  const headers = {
    ...request.headers(),
    "X-Momo-Account-Id": accountId,
  };
  if (["DELETE", "PATCH", "POST", "PUT"].includes(request.method())) {
    headers["X-CSRF-Token"] = "dev";
  }
  return headers;
}

function expectGeneratedId(value: string | undefined, label: string): string {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${label}, but received ${String(value)}`);
  }
  expect(value).toEqual(expect.stringMatching(generatedIdPattern));
  return value;
}

function isMatchListResponse(response: APIResponse): boolean {
  const url = new URL(response.url());
  return url.pathname === "/api/matches" && response.request().method() === "GET";
}

function currentPagePath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const isClippedByAncestor = (element: Element) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const overflowX = window.getComputedStyle(ancestor).overflowX;
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsWithinViewport =
          ancestorRect.left >= -1 && ancestorRect.right <= viewportWidth + 1;
        if (clipsWithinViewport && ["auto", "clip", "hidden", "scroll"].includes(overflowX)) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    const offenders = [...document.body.querySelectorAll("*")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          (rect.left >= -1 && rect.right <= viewportWidth + 1) ||
          isClippedByAncestor(element)
        ) {
          return [];
        }
        const ancestry = [];
        let current: Element | null = element;
        while (current && ancestry.length < 12) {
          const currentRect = current.getBoundingClientRect();
          const style = window.getComputedStyle(current);
          ancestry.push({
            className: current.getAttribute("class")?.slice(0, 120) ?? "",
            clientWidth: current.clientWidth,
            display: style.display,
            left: Math.round(currentRect.left),
            overflowX: style.overflowX,
            right: Math.round(currentRect.right),
            scrollWidth: current.scrollWidth,
            tag: current.tagName.toLowerCase(),
            width: Math.round(currentRect.width),
          });
          current = current.parentElement;
        }
        return [
          {
            ancestry,
            className: element.getAttribute("class")?.slice(0, 160) ?? "",
            depth: ancestry.length,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            tag: element.tagName.toLowerCase(),
            text: element.textContent?.trim().replaceAll(/\s+/gu, " ").slice(0, 100) ?? "",
            width: Math.round(rect.width),
          },
        ];
      })
      .toSorted((left, right) => right.depth - left.depth || right.right - left.right)
      .slice(0, 1);
    return {
      offenders,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
    };
  });

  expect(
    geometry.scrollWidth,
    `horizontal overflow: ${JSON.stringify(geometry.offenders)}`,
  ).toBeLessThanOrEqual(geometry.viewportWidth);
}

function matchDetailLink(page: Page, matchId: string) {
  return page.locator(
    `a[href="/matches/${matchId}"]:visible, a[href^="/matches/${matchId}?"]:visible`,
  );
}

function matchTableRow(page: Page, matchId: string) {
  return page.getByRole("row").filter({ has: matchDetailLink(page, matchId) });
}

async function selectSeedMasters(page: Page): Promise<void> {
  const gameTitleSelect = page.getByRole("combobox", { name: /^作品/u });
  await expect(gameTitleSelect).toBeEnabled();
  await gameTitleSelect.selectOption(gameTitleId);
  await expect(gameTitleSelect).toHaveValue(gameTitleId);

  const seasonSelect = page.getByRole("combobox", { name: /^シーズン/u });
  await expect(seasonSelect).toBeEnabled();
  await expect(seasonSelect.locator(`option[value="${seasonMasterId}"]`)).toHaveCount(1);
  await seasonSelect.selectOption(seasonMasterId);
  await expect(seasonSelect).toHaveValue(seasonMasterId);

  const mapSelect = page.getByRole("combobox", { name: /^マップ/u });
  await expect(mapSelect).toBeEnabled();
  await expect(mapSelect.locator(`option[value="${mapMasterId}"]`)).toHaveCount(1);
  await mapSelect.selectOption(mapMasterId);
  await expect(mapSelect).toHaveValue(mapMasterId);
}

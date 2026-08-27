import type { APIResponse, Locator, Page } from "@playwright/test";

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
import {
  continueWithE2eAuth,
  continueWithE2eNonAdminAuth,
  deleteJson,
  devAccountId,
  devUserStorageKey,
  expect,
  expectDeleted,
  expectGeneratedId,
  expectNoHorizontalPageOverflow,
  expectOk,
  installE2eAuthHeaders,
  postJson,
  postMutation,
  test,
} from "./support";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("completes the app smoke workflow with isolated scoped data", async ({
  e2eRun,
  page,
  request,
}) => {
  const { masterIdSuffix } = e2eRun;
  const gameTitleId = `gt_e2e_${masterIdSuffix}`;
  const seasonMasterId = `season_e2e_${masterIdSuffix}`;
  const mapMasterId = `map_e2e_${masterIdSuffix}`;
  const gameTitleName = `桃太郎電鉄2 E2E ${masterIdSuffix}`;
  const aliasName = `E2E-${masterIdSuffix}`;
  let heldEventId = "";
  let heldEventLabelPrefix = "";
  let matchId = "";
  let uploadedDraftId = "";

  await test.step("seed scoped masters", async () => {
    await postJson(request, e2eRun, "/api/game-titles", {
      id: gameTitleId,
      name: gameTitleName,
      layoutFamily: "momotetsu_2",
    });
    e2eRun.trackGameTitle(gameTitleId);
    await postJson(request, e2eRun, "/api/season-masters", {
      id: seasonMasterId,
      gameTitleId,
      name: "E2Eシーズン",
    });
    e2eRun.trackSeasonMaster(seasonMasterId);
    await postJson(request, e2eRun, "/api/map-masters", {
      id: mapMasterId,
      gameTitleId,
      name: "E2Eマップ",
    });
    e2eRun.trackMapMaster(mapMasterId);
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
    await page.getByRole("button", { name: /^(?:最初の)?開催を作成$/u }).click();
    const createDialog = page.getByRole("dialog", { name: "新しい開催を作成" });
    await expect(createDialog).toBeVisible();
    const heldEventLocalDateTime = e2eRun.uniqueLocalDateTime();
    heldEventLabelPrefix = heldEventLocalDateTime.replaceAll("-", "/").replace("T", " ");
    await createDialog.getByLabel("開催日時").fill(heldEventLocalDateTime);
    await createDialog.getByRole("button", { exact: true, name: "開催を作成" }).click();

    const response = await createResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { id?: string };
    heldEventId = expectGeneratedId(body.id, "held event ID");
    e2eRun.trackHeldEvent(heldEventId);
    const heldEventDetailHref = withReturnTo(`/held-events/${heldEventId}`, "/held-events");
    await expect(page).toHaveURL(heldEventDetailHref);
    await expect(page.getByText("確定済み0試合・未確定下書き0件", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, level: 2, name: "第1試合を記録" }),
    ).toBeVisible();

    const manualLink = page.getByRole("link", { exact: true, name: "手入力" });
    await expect(manualLink).toHaveCount(1);
    await expect(manualLink).toHaveAttribute(
      "href",
      withReturnTo(`/matches/new?heldEventId=${heldEventId}`, currentPagePath(page)),
    );
    const ocrLink = page.getByRole("link", { exact: true, name: "OCR取り込み" });
    await expect(ocrLink).toHaveCount(1);
    await expect(ocrLink).toHaveAttribute(
      "href",
      withReturnTo(`/ocr/new?heldEventId=${heldEventId}`, currentPagePath(page)),
    );
  });

  await test.step("open OCR for this run's held event from held-event history", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/held-events");
    await expect(page.getByRole("heading", { exact: true, name: "開催履歴" })).toBeVisible();

    const expectedOcrHref = withReturnTo(`/ocr/new?heldEventId=${heldEventId}`, "/held-events");
    const heldEventOcrLink = page
      .locator(`a[href="${expectedOcrHref}"]`)
      .filter({ hasText: "OCR取り込み" });
    await expect(heldEventOcrLink).toHaveCount(1);
    await expect(heldEventOcrLink).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await expect(heldEventOcrLink).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
    await heldEventOcrLink.click();

    await expect(page).toHaveURL(expectedOcrHref);
    await expect(page.getByRole("heading", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await expect(page.getByText(/— 確定済み0試合・未確定下書き0件$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "開催（任意）を変更" })).toBeVisible();
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
    const body = (await response.json()) as { id?: string };
    e2eRun.trackAlias(expectGeneratedId(body.id, "member alias ID"));
    await expect(page.getByText(aliasName)).toBeVisible();
  });

  await test.step("start an OCR job from an uploaded image", async () => {
    await page.goto("/ocr/new");

    await expect(page.getByRole("heading", { exact: true, name: "OCR取り込み" })).toBeVisible();
    await selectSeedMasters(page, { gameTitleId, mapMasterId, seasonMasterId });

    const cameraFrame = page.getByRole("group", { name: "総資産の16:9カメラ画像枠" });
    const cameraFrameBox = await measureElement(cameraFrame, "OCR camera frame");
    expect(cameraFrameBox.width / cameraFrameBox.height).toBeCloseTo(16 / 9, 2);

    const totalAssetsFrame = page.getByRole("group", { name: "総資産の16:9画像枠" });
    await expect(totalAssetsFrame).toBeVisible();
    const emptyFrameBox = await measureElement(totalAssetsFrame, "Empty OCR tray frame");
    expect(emptyFrameBox.width / emptyFrameBox.height).toBeCloseTo(16 / 9, 2);

    await page.getByLabel("OCRの画像をアップロード").setInputFiles({
      buffer: png1x1,
      mimeType: "image/png",
      name: "total-assets.png",
    });
    await expect(page.getByAltText("総資産プレビュー")).toBeVisible();
    const selectedFrameBox = await measureElement(totalAssetsFrame, "Selected OCR tray frame");
    expect(selectedFrameBox.width).toBeCloseTo(emptyFrameBox.width, 1);
    expect(selectedFrameBox.height).toBeCloseTo(emptyFrameBox.height, 1);
    const trayFeedback = page.getByRole("status", { name: "分類トレイの操作結果" });
    await expect(trayFeedback).toContainText("総資産に画像を配置しました。");
    const startButton = page.getByRole("button", { name: "1件で読み取りを開始" });
    await startButton.scrollIntoViewIfNeeded();
    const feedbackBox = await measureElement(trayFeedback, "OCR tray feedback");
    const startButtonBox = await measureElement(startButton, "OCR start action");
    expect(feedbackBox.y + feedbackBox.height).toBeLessThan(startButtonBox.y);

    const draftResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/match-drafts") && response.request().method() === "POST",
    );
    const jobResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/ocr-jobs") && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "1件で読み取りを開始" }).click();
    const startDialog = page.getByRole("dialog", { name: "読み取りを開始しますか？" });
    await expect(startDialog).toBeVisible();
    await expect(startDialog.getByText("1件だけで開始します")).toBeVisible();
    await startDialog.getByRole("button", { name: "1件で読み取りを開始" }).click();

    const draftCreateResponse = await draftResponse;
    await expectOk(draftCreateResponse, "create uploaded OCR draft");
    const draftBody = (await draftCreateResponse.json()) as { matchDraftId?: string };
    uploadedDraftId = expectGeneratedId(draftBody.matchDraftId, "match draft ID");
    e2eRun.trackDraft(uploadedDraftId);

    await expectOk(await jobResponse, "create OCR job");
    await expect(page).toHaveURL(/\/matches\?status=incomplete&sort=updated_desc$/u);
    const matchesPageTitle = page.getByRole("heading", { exact: true, name: "試合一覧" });
    await expect(matchesPageTitle).toBeVisible();
    expect(
      await matchesPageTitle.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return { fontSize: style.fontSize, fontWeight: style.fontWeight };
      }),
    ).toEqual({ fontSize: "30px", fontWeight: "600" });
    await page.setViewportSize({ height: 844, width: 320 });
    expect(
      await matchesPageTitle.evaluate((element) => window.getComputedStyle(element).fontSize),
    ).toBe("24px");
    await page.setViewportSize({ height: 900, width: 1440 });
  });

  await test.step("confirm the sample OCR review into a match detail", async () => {
    expectGeneratedId(heldEventId, "held event ID");

    await page.goto("/review/dev-sample?sample=1");

    await expect(page.getByRole("heading", { exact: true, name: "OCR結果の確認" })).toBeVisible();
    await expect(page.getByText("サンプルの読み取り結果で表示中")).toBeVisible();
    const reviewRail = page.getByLabel("OCRの確認項目");
    await expect(reviewRail.getByText("未確認2件／全2件")).toBeVisible();
    await reviewRail.getByRole("button", { name: "この値で確認済み" }).click();
    await expect(reviewRail.getByText("未確認1件／全2件")).toBeVisible();

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

    await page.getByRole("button", { name: "開催（必須）を変更" }).click();
    const heldEventDialog = page.getByRole("dialog", { name: "開催（必須）を選択" });
    await selectDialogRadio(heldEventDialog, new RegExp(`^${heldEventLabelPrefix} —`, "u"));
    await expect(page.getByText(new RegExp(`^${heldEventLabelPrefix} —`, "u"))).toBeVisible();
    await selectSeedMasters(page, { gameTitleId, mapMasterId, seasonMasterId });

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
    await expect(confirmDialog.getByText("確認済み1件／全2件")).toBeVisible();
    await expect(confirmDialog.getByText(/未確認の強調項目が1件あります/u)).toBeVisible();
    await page.getByRole("button", { name: "確定する" }).click();

    const response = await confirmResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { matchId?: string };
    matchId = expectGeneratedId(body.matchId, "match ID");
    e2eRun.trackMatch(matchId);

    await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`, "u"));
    await expect(page.getByRole("heading", { name: /第\d+試合の結果/u })).toBeVisible();
    await expect(page.getByText(gameTitleName, { exact: true })).toBeVisible();
    await page.setViewportSize({ height: 900, width: 1440 });
    await expect(page.getByText("比較データを読み込み中", { exact: true }).first()).toBeVisible();
    const resultLedgerCard = page.getByRole("region", { name: "順位・総資産" });
    await expect(resultLedgerCard).toBeVisible();
    const resultLedger = resultLedgerCard.getByRole("list", { name: "試合の順位と成績" });
    await expect(resultLedger).toBeVisible();
    const resultLedgerCardBox = await measureElement(resultLedgerCard, "Result ledger card");
    const resultContentSurfaceBox = await measureElement(
      resultLedgerCard.locator(".."),
      "Result content surface",
    );
    expect(resultContentSurfaceBox.width - resultLedgerCardBox.width).toBeLessThanOrEqual(48);
    const firstPlaceLedgerRow = resultLedgerCard
      .getByRole("listitem")
      .filter({ hasText: "ぽんた" });
    const rankBox = await measureElement(
      firstPlaceLedgerRow.getByText("1位", { exact: true }),
      "Result ledger rank",
    );
    const totalAssetsBox = await measureElement(
      firstPlaceLedgerRow.getByText("総資産", { exact: true }).locator(".."),
      "Result ledger total assets",
    );
    expect(totalAssetsBox.x).toBeGreaterThan(rankBox.x);
    expect(totalAssetsBox.x + totalAssetsBox.width).toBeLessThanOrEqual(
      resultLedgerCardBox.x + resultLedgerCardBox.width,
    );

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
    for (const trend of aggregateFixture.trends) {
      const trendPoint = trend.points[0];
      if (!trendPoint) continue;
      trendPoint.itemId = `trend:${trend.kind}:member_ponta:${matchId}`;
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
        `trend:rank_cumulative_standard_deviation:member_ponta:${matchId}`,
        `trend:podium_cumulative_rate:member_ponta:${matchId}`,
        `trend:lower_half_cumulative_rate:member_ponta:${matchId}`,
        `trend:ginji_cumulative_count:member_ponta:${matchId}`,
        `match:${matchId}`,
      ];
    }

    let statusPhase: "failed" | "running" = "running";
    let interceptedStatusRequests = 0;
    const statusPattern = /\/api\/analytics\/series-comparison\/v2\/status(?:\?.*)?$/u;
    await page.route(/\/api\/analytics\/series-comparison\/v2\/options(?:\?.*)?$/u, async (route) =>
      route.fulfill({ json: optionsFixture }),
    );
    await page.route(statusPattern, async (route) => {
      interceptedStatusRequests += 1;
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
        } else if (fixture.payload.kind === "play_order_rank_history") {
          for (const row of fixture.payload.seriesByPlayOrder) {
            row.itemId = `play-order-history:${matchId}`;
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
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.dispatchEvent(new Event("focus"));
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("pageshow"));
          window.dispatchEvent(new Event("online"));
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(interceptedStatusRequests).toBe(0);

    const currentStatusResponse = page.waitForResponse((response) =>
      statusPattern.test(response.url()),
    );
    await page.getByRole("button", { name: "状態を再確認" }).click();
    expect((await currentStatusResponse).ok()).toBe(true);
    expect(interceptedStatusRequests).toBe(1);

    const purposeTabs = page.getByRole("tablist", { name: "戦績比較の目的" });
    const analysisTabs = page.getByRole("tablist", { name: "分析の切り口" });
    await expect(purposeTabs.getByRole("tab", { name: "分析する" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(analysisTabs.getByRole("tab", { name: "推移" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const metricGuideTrigger = page.getByRole("button", { name: "指標の読み方" });
    await expect(metricGuideTrigger).toBeVisible();
    await metricGuideTrigger.click();
    const metricGuideDialog = page.getByRole("dialog", { name: "指標の読み方" });
    await expect(metricGuideDialog).toBeVisible();
    await metricGuideDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
    const scopeSurface = page.getByRole("region", { name: "比較条件" });
    await expect(scopeSurface).toContainText(`${analysisScope.matchCount}戦`);
    await expect(scopeSurface).not.toContainText("十分");
    await expect(page.getByText("新しい戦績データを計算中です")).toBeVisible();
    await expect(page.getByText(/更新のデータを表示します/u)).toBeVisible();
    const selectedMatch = page.getByRole("region", { name: "選択中の試合" });
    await expect(selectedMatch.getByRole("heading", { name: /第1戦/u })).toBeVisible();
    const selectedMatchHref = withReturnTo(
      `/matches/${encodeURIComponent(matchId)}`,
      currentPagePath(page),
    );
    await expect(
      selectedMatch.getByRole("link", { name: "第1戦の試合結果を見る" }),
    ).toHaveAttribute("href", selectedMatchHref);
    await expect(selectedMatch.getByRole("list", { name: "この試合の注目点" })).toBeVisible();
    await expect(
      selectedMatch.getByRole("list", { name: "選択中の試合の順位と成績" }),
    ).toContainText("ぽんた");
    await expect(page.locator('[data-focused-metric="true"]').first()).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: `直近${aggregateFixture.matchDigest.shownCount}戦と荒れ方`,
      }),
    ).toBeVisible();
    await expect(page.getByText("カード表示", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "直近の試合順位" })).toBeVisible();
    const recentRankTile = page.getByRole("link", {
      name: /ぽんた、第1戦、1位、この試合。試合結果を見る/u,
    });
    await expect(recentRankTile).toHaveCSS("height", "44px");
    await expect(recentRankTile).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expectNoHorizontalPageOverflow(page);

    await page.getByRole("tab", { name: "今の差" }).click();
    await expect(page.getByRole("heading", { name: "順位と基礎比較" })).toBeVisible();
    await expect(page.getByRole("region", { name: "順位と基礎比較" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "各順位の回数" })).toBeVisible();
    await expect(page.getByLabel("ぽんたの順位回数")).toContainText(
      "1位 6回（この試合）・2位 2回・3位 2回・4位 2回",
    );
    await expectNoHorizontalPageOverflow(page);
    const crownRegion = page.getByRole("region", { name: "平均順位首位の確からしさ" });
    await expect(crownRegion.getByRole("img", { name: /平均順位首位に残った比率/u })).toBeVisible();
    await crownRegion.getByRole("button", { name: "平均順位首位の確からしさの読み方" }).click();
    await expect(crownRegion.getByText(/直接対決.*順位の安定性/u)).toBeVisible();
    await expect(crownRegion.getByText(/次戦の勝率や最終順位/u)).toBeVisible();
    await expect(selectedMatch).toBeVisible();
    await expect(page.locator('[data-focused-metric="true"]').first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`focusMatchId=${encodeURIComponent(matchId)}`, "u"));
    await page.getByRole("button", { name: "順位推移を見る" }).first().click();
    const rankDialog = page.getByRole("dialog", { name: "平均順位の推移" });
    await expect(rankDialog.getByRole("img", { name: "ぽんたの累積平均順位の推移" })).toBeVisible();
    await expect(rankDialog.getByRole("columnheader", { name: "開催日時" })).toBeVisible();
    await expect(rankDialog).not.toContainText("event-12");
    await expect(rankDialog).not.toContainText("初戦後からの通算変化");
    await expect(
      rankDialog.getByRole("rowheader", { name: "第1戦の試合結果を見る" }),
    ).toBeVisible();
    await expect(rankDialog.getByText("0.05 改善")).toBeVisible();
    const rankHistoryMatchHref = withReturnTo(
      `/matches/${encodeURIComponent(matchId)}`,
      currentPagePath(page),
    );
    await expect(rankDialog.getByRole("link", { name: "第1戦の試合結果を見る" })).toHaveAttribute(
      "href",
      rankHistoryMatchHref,
    );
    await rankDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(page.getByLabel("ぽんたの順位回数")).toBeVisible();
    await expectNoHorizontalPageOverflow(page);

    await page.getByRole("tab", { name: "条件別" }).click();
    await expect(page.getByRole("heading", { name: "番手比較" })).toBeVisible();
    await expect(page.getByRole("table", { name: "番手別成績" })).toBeVisible();
    await expect(page.getByText("得意")).toBeVisible();
    await page.getByRole("button", { name: "ぽんたの番手別推移" }).click();
    const playOrderDialog = page.getByRole("dialog", { name: "番手別順位の推移" });
    await expect(
      playOrderDialog.getByRole("img", { name: "ぽんたの番手別累積平均順位の推移" }),
    ).toBeVisible();
    await expect(playOrderDialog.getByText(/2位 → 1.5位/u)).toBeVisible();
    await expect(playOrderDialog.getByText("改善")).toBeVisible();
    await playOrderDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();

    await page.getByRole("tab", { name: "勝因候補" }).click();
    await expect(page.getByText("0円", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "ぽんたの物件収益順位と最終順位" })).toBeVisible();
    await expect(page.getByLabel("物件収益と最終順位のセルの読み方")).toContainText(
      "同じ物件収益順位の中で、その最終順位になった割合",
    );
    const scatterMatchHref = withReturnTo(
      `/matches/${encodeURIComponent(matchId)}`,
      currentPagePath(page),
    );
    await expect(
      page.getByRole("link", { name: /第1戦、12%、21億円、1位の試合結果を見る/u }),
    ).toHaveAttribute("href", scatterMatchHref);
    await page.getByRole("button", { name: "検証範囲を見る" }).click();
    const rankSignalDialog = page.getByRole("dialog", { name: "順位を読む手掛かり" });
    await expect(rankSignalDialog.getByLabel("順位を読む手掛かりの使い方")).toContainText(
      "試合後に同じ傾向が続いたか確認",
    );
    await expect(rankSignalDialog.getByText("候補はこの1件")).toBeVisible();
    await expect(
      rankSignalDialog.getByRole("list", { name: "物件収益の別開催での支持" }),
    ).toBeVisible();
    await rankSignalDialog.getByRole("button", { name: "別開催テストと採用基準" }).click();
    await expect(
      rankSignalDialog.getByRole("listitem").filter({ hasText: "候補を作る" }),
    ).toContainText("4組を使用");
    const pageScrollBeforeDisclosure = await page.evaluate(() => window.scrollY);
    await rankSignalDialog.getByRole("button", { name: "物件収益の開催別の数値" }).click();
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeDisclosure);
    expect(
      await rankSignalDialog.evaluate((dialog) => {
        const surface = dialog.firstElementChild;
        const candidates = [dialog, surface, ...dialog.querySelectorAll("*")].filter(
          (element): element is Element => element !== null,
        );
        const scrollOwners = candidates.filter(
          (element) =>
            ["auto", "scroll"].includes(window.getComputedStyle(element).overflowY) &&
            element.scrollHeight > element.clientHeight + 1,
        );
        return {
          bodyOverflow: window.getComputedStyle(document.body).overflow,
          scrollOwnerCount: scrollOwners.length,
        };
      }),
    ).toEqual({ bodyOverflow: "hidden", scrollOwnerCount: 1 });
    await rankSignalDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();

    await page.setViewportSize({ height: 900, width: 1440 });
    const reviewPurposeTab = purposeTabs.getByRole("tab", { name: "次戦に備える" });
    await reviewPurposeTab.click();
    await expect(reviewPurposeTab).toHaveAttribute("aria-selected", "true");
    const nextMatchReview = page.getByRole("tabpanel", { name: "次戦に備える" });
    await expect(nextMatchReview).toBeVisible();
    await expect(reviewPurposeTab).toBeFocused();
    const actionHypothesisTarget = nextMatchReview.getByLabel("行動仮説の対象");
    await expect(actionHypothesisTarget.getByText("対象", { exact: true })).toBeVisible();
    await expect(actionHypothesisTarget.getByText("次の4戦", { exact: true })).toBeVisible();
    await expect(nextMatchReview.getByText("使う場面", { exact: true })).toHaveCount(0);
    await expect(selectedMatch).toBeVisible();
    await page.getByRole("button", { name: "根拠・注意・試合後の確認" }).click();
    const evidenceDialog = page.getByRole("dialog", { name: "根拠・注意・試合後の確認" });
    await expect(evidenceDialog.getByText("データ上の理由")).toBeVisible();
    await expect(evidenceDialog.getByText("ぶれにくさ: 高め")).toBeVisible();
    await evidenceDialog.getByRole("button", { name: "ダイアログを閉じる" }).click();

    statusPhase = "failed";
    const failedStatusResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/v2/status"),
    );
    await page.getByRole("button", { name: "表示を更新" }).click();
    expect((await failedStatusResponse).ok()).toBe(true);
    expect(interceptedStatusRequests).toBe(2);
    await expect(page.getByText("分析データを再計算できませんでした")).toBeVisible();
    await expect(page.getByText(/更新のデータを表示しています/u)).toBeVisible();

    await selectedMatch.getByRole("button", { name: "この試合の選択を解除" }).click();
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
    const statusSelect = page.getByRole("combobox", { exact: true, name: "確定状況" });
    await expect(statusSelect).toBeEnabled();
    await statusSelect.selectOption("confirmed");
    expect((await statusResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/[?&]status=confirmed(?:&|$)/u);

    const heldEventResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return isMatchListResponse(response) && url.searchParams.get("heldEventId") === heldEventId;
    });
    await page.getByText("詳細条件", { exact: true }).click();
    const heldEventPicker = page.getByRole("button", { name: "開催を変更" });
    await expect(heldEventPicker).toBeEnabled();
    await heldEventPicker.click();
    await selectDialogRadio(
      page.getByRole("dialog", { name: "開催を選択" }),
      new RegExp(`^${heldEventLabelPrefix} —`, "u"),
    );
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
    const exportScopeTabs = page.getByRole("tablist", { name: "出力範囲" });
    const exportFormatTabs = page.getByRole("tablist", { name: "ファイル形式" });
    await expect(exportScopeTabs.getByRole("tab", { exact: true, name: "試合" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(exportFormatTabs.getByRole("tab", { name: "TSV" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tabpanel", { exact: true, name: "試合" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "TSV" })).toBeVisible();
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
      e2eRun,
      `/api/match-drafts/${uploadedDraftId}/cancel`,
    );
    await expectOk(cancelResponse, "cancel uploaded draft");

    const draftAfterCancel = await request.get(`/api/match-drafts/${uploadedDraftId}`, {
      headers: {
        "X-Momo-Account-Id": devAccountId,
      },
    });
    expect(draftAfterCancel.status()).toBe(404);

    const blockedMapDelete = await deleteJson(request, e2eRun, `/api/map-masters/${mapMasterId}`);
    expect(blockedMapDelete.status()).toBe(409);

    const matchDelete = await deleteJson(request, e2eRun, `/api/matches/${matchId}`);
    await expectOk(matchDelete, "delete confirmed match");

    await expectDeleted(
      await deleteJson(request, e2eRun, `/api/map-masters/${mapMasterId}`),
      mapMasterId,
    );
    await expectDeleted(
      await deleteJson(request, e2eRun, `/api/season-masters/${seasonMasterId}`),
      seasonMasterId,
    );
    await expectDeleted(
      await deleteJson(request, e2eRun, `/api/game-titles/${gameTitleId}`),
      gameTitleId,
    );
  });
});

function isMatchListResponse(response: APIResponse): boolean {
  const url = new URL(response.url());
  return url.pathname === "/api/matches" && response.request().method() === "GET";
}

function currentPagePath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
}

function matchDetailLink(page: Page, matchId: string) {
  return page.locator(
    `a[href="/matches/${matchId}"]:visible, a[href^="/matches/${matchId}?"]:visible`,
  );
}

function matchTableRow(page: Page, matchId: string) {
  return page.getByRole("row").filter({ has: matchDetailLink(page, matchId) });
}

async function selectDialogRadio(dialog: Locator, name: string | RegExp): Promise<void> {
  const radio = dialog.getByRole("radio", { name });
  if (await radio.isChecked()) {
    await dialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
  } else {
    await radio.press("Space");
  }
  await expect(dialog).toBeHidden();
}

async function selectSeedMasters(
  page: Page,
  ids: { gameTitleId: string; mapMasterId: string; seasonMasterId: string },
): Promise<void> {
  const gameTitleSelect = page.getByRole("combobox", { name: /^作品/u });
  await expect(gameTitleSelect).toBeEnabled();
  await gameTitleSelect.selectOption(ids.gameTitleId);
  await expect(gameTitleSelect).toHaveValue(ids.gameTitleId);

  const seasonSelect = page.getByRole("combobox", { name: /^シーズン/u });
  await expect(seasonSelect).toBeEnabled();
  await expect(seasonSelect.locator(`option[value="${ids.seasonMasterId}"]`)).toHaveCount(1);
  await seasonSelect.selectOption(ids.seasonMasterId);
  await expect(seasonSelect).toHaveValue(ids.seasonMasterId);

  const mapSelect = page.getByRole("combobox", { name: /^マップ/u });
  await expect(mapSelect).toBeEnabled();
  await expect(mapSelect.locator(`option[value="${ids.mapMasterId}"]`)).toHaveCount(1);
  await mapSelect.selectOption(ids.mapMasterId);
  await expect(mapSelect).toHaveValue(ids.mapMasterId);
}

async function measureElement(locator: Locator, label: string) {
  await expect(locator, `${label} must be visible before measuring.`).toBeVisible();
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    };
  });
}

import type { APIRequestContext } from "@playwright/test";

import type { components } from "../../src/shared/api/generated";
import { seedConfirmedContext } from "../fixtures/records";
import { expect, expectOk, selectControlOption, test } from "./support";

type Status = components["schemas"]["SeriesAnalysisStatusResponse"];
type Aggregate = components["schemas"]["SeriesAnalysisAggregateV5Response"];

test("saved and edited results reach worker analysis, the browser and the original match", async ({
  e2eRun,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const fixture = await seedConfirmedContext(request, e2eRun);
  const first = await waitForPublished(request, fixture.gameTitleId);
  const initial = await readAggregate(request, fixture, first);
  expect(initial.scope.matchCount).toBe(1);
  expect(initial.strategyScatter.points).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        matchId: fixture.matchId,
        memberId: "member_ponta",
        totalAssetsManYen: 400,
      }),
    ]),
  );

  await page.goto(`/matches/${fixture.matchId}`);
  await page.getByRole("link", { name: "試合結果を編集" }).click();
  await page.getByLabel("ぽんた 総資産（万円）", { exact: true }).fill("7654");
  await page.getByRole("button", { exact: true, name: "保存" }).click();
  await expect(page).toHaveURL(`/matches/${fixture.matchId}`);
  const updated = await waitForPublished(request, fixture.gameTitleId, first.artifactId);
  expect(updated.inputRevision).not.toBe(first.inputRevision);
  const aggregate = await readAggregate(request, fixture, updated);
  expect(aggregate.artifact.artifactId).toBe(updated.artifactId);
  expect(aggregate.scope.matchCount).toBe(1);
  expect(aggregate.strategyScatter.points).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        matchId: fixture.matchId,
        memberId: "member_ponta",
        totalAssetsManYen: 7654,
      }),
    ]),
  );

  await page.getByRole("link", { name: "前後の戦績を見る" }).click();
  // Navigation may retain the status prefetched before publication. Refresh is the user-facing
  // transition to the latest immutable result; the first aggregate request need not be current.
  const refresh = page.getByRole("button", { exact: true, name: "表示を更新" });
  await expect(refresh).toBeEnabled();
  const browserAggregate = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/v5/aggregate") &&
      url.searchParams.get("artifactId") === updated.artifactId
    );
  });
  await refresh.click();
  const rendered = await browserAggregate;
  await expectOk(rendered, "browser aggregate");
  const renderedBody = (await rendered.json()) as Aggregate;
  expect(renderedBody.artifact.artifactId).toBe(updated.artifactId);
  await expect(page.getByRole("table", { name: "直近の試合順位" })).toBeVisible();
  await page.getByRole("tab", { exact: true, name: "今の差" }).click();
  const savedMetrics = page.getByRole("table", { name: "プレーヤー別の順位と基礎比較" });
  const player = savedMetrics
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "ぽんた" }) });
  await expect(player).toContainText("7654万円");
  await page.getByRole("tab", { exact: true, name: "推移" }).click();
  const source = page
    .getByRole("table", { name: "直近の試合順位" })
    .getByRole("link", { name: /^第1戦の試合結果を見る/u });
  await expect(source).toHaveAttribute("href", `/matches/${fixture.matchId}`);
  await source.click();
  await expect(page.getByRole("heading", { name: "第1試合の結果" })).toBeVisible();

  // Manual administration is an independent input path; automatic publication was proved above.
  await page.goto("/admin/analysis");
  await selectControlOption(
    page,
    page.getByRole("combobox", { name: "対象作品" }),
    fixture.gameTitleId,
  );
  const recalculated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/series-analysis/recalculations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "この作品を再計算" }).click();
  const response = await recalculated;
  expect(response.status()).toBe(202);
  const accepted =
    (await response.json()) as components["schemas"]["SeriesAnalysisRecalculationAcceptedResponse"];
  // Identical inputs can reuse the published artifact. Wait for this manual run to finish.
  const manual = await waitForPublished(
    request,
    fixture.gameTitleId,
    undefined,
    accepted.acceptedAt,
  );
  expect(manual.inputRevision).toBe(updated.inputRevision);
  const manualAggregate = await readAggregate(request, fixture, manual);
  expect(manualAggregate.scope.matchCount).toBe(1);
  expect(manualAggregate.strategyScatter.points).toEqual(aggregate.strategyScatter.points);
});

async function waitForPublished(
  request: APIRequestContext,
  gameTitleId: string,
  previousArtifactId?: string,
  manualAcceptedAt?: string,
): Promise<NonNullable<Status["currentArtifact"]>> {
  let status: Status | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/analytics/series-comparison/v2/status?${new URLSearchParams({ gameTitleId })}`,
        );
        await expectOk(response, "analysis publication status");
        status = (await response.json()) as Status;
        const published =
          status.artifactFreshness === "current" &&
          status.currentArtifact !== null &&
          status.currentArtifact.artifactId !== previousArtifactId &&
          status.currentArtifact.inputRevision === status.desired.inputRevision &&
          (!manualAcceptedAt ||
            (status.calculation?.trigger === "manual" &&
              status.calculation.status === "succeeded" &&
              Date.parse(status.calculation.requestedAt) >= Date.parse(manualAcceptedAt)));
        return published
          ? "published"
          : `${status.artifactFreshness}; calculation=${status.calculation?.status ?? "none"}; desired=${status.desired.algorithmVersion}/${status.desired.inputRevision}`;
      },
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toBe("published");
  if (!status?.currentArtifact) throw new Error("Missing published analysis artifact");
  return status.currentArtifact;
}

async function readAggregate(
  request: APIRequestContext,
  fixture: { gameTitleId: string; seasonMasterId: string; mapMasterId: string },
  artifact: NonNullable<Status["currentArtifact"]>,
): Promise<Aggregate> {
  const query = new URLSearchParams({
    gameTitleId: fixture.gameTitleId,
    seasonMasterId: fixture.seasonMasterId,
    mapMasterId: fixture.mapMasterId,
    artifactId: artifact.artifactId,
  });
  const response = await request.get(`/api/analytics/series-comparison/v5/aggregate?${query}`);
  await expectOk(response, "published scoped aggregate");
  return (await response.json()) as Aggregate;
}

test("an unavailable analysis read does not prevent saving and reading match results", async ({
  e2eRun,
  page,
  request,
}) => {
  const fixture = await seedConfirmedContext(request, e2eRun);
  await page.route("**/api/analytics/series-comparison/v2/status?*", (route) =>
    route.abort("failed"),
  );
  await page.goto(`/analytics/series?gameTitleId=${fixture.gameTitleId}`);
  await expect(page.getByRole("heading", { name: "戦績データを取得できません" })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "試合" }).click();
  await page.locator(`a[href="/matches/${fixture.matchId}"]:visible`).click();
  await page.getByRole("link", { name: "試合結果を編集" }).click();
  await page.getByLabel("ぽんた 総資産（万円）", { exact: true }).fill("5432");
  await page.getByRole("button", { exact: true, name: "保存" }).click();
  await expect(page).toHaveURL(`/matches/${fixture.matchId}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "第1試合の結果" })).toBeVisible();
  const response = await request.get(`/api/matches/${fixture.matchId}`);
  await expectOk(response, "saved record while analysis read is unavailable");
  expect(await response.json()).toMatchObject({
    players: expect.arrayContaining([
      expect.objectContaining({ memberId: "member_ponta", totalAssetsManYen: 5432 }),
    ]),
  });
});

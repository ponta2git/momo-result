import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { SeriesComparisonPage } from "@/features/seriesComparison/page/SeriesComparisonPage";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisScopeStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
// Empty-scope navigation is the oracle; load the real populated view before timing interactions.
beforeAll(() =>
  Promise.all([
    import("@/features/seriesComparison/page/SeriesAnalysisOverviewView"),
    decodeSeriesAnalysisArtifact("aggregateV5", makeSeriesAnalysisAggregate()),
  ]),
);

function renderScope() {
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [{ path: "/analytics/series", element: <SeriesComparisonPage /> }],
    {
      initialEntries: [
        "/analytics/series?gameTitleId=gt_momotetsu_2&view=overview&seasonMasterId=season_current&mapMasterId=map_empty",
      ],
    },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

describe("SeriesComparison empty scope", () => {
  it("preserves valid masters absent from the match directory without fetching an empty artifact", async () => {
    const user = userEvent.setup();
    let aggregateReads = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const empty = params.has("mapMasterId");
        return HttpResponse.json(
          makeSeriesAnalysisScopeStatus({
            artifactId: params.get("artifactId"),
            seasonMasterId: params.get("seasonMasterId"),
            mapMasterId: params.get("mapMasterId"),
            seasonName: params.has("seasonMasterId") ? "今シーズン" : null,
            mapName: empty ? "記録のなくなったマップ" : null,
            state: empty ? "empty" : "available",
            currentHasMatches: !empty,
            publishedHasMatches: params.has("artifactId") ? !empty : null,
          }),
        );
      }),
      http.get("/api/analytics/series-comparison/v5/aggregate", () => {
        aggregateReads += 1;
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
    );
    const { client, router } = renderScope();
    expect(await screen.findByText("この範囲に確定済みの試合がありません")).toBeInTheDocument();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const summary = within(screen.getByRole("region", { name: "比較条件" }));
    expect(summary.getByText("0戦")).toBeInTheDocument();
    expect(summary.getByText("対象試合なし")).toBeInTheDocument();
    expect(summary.queryByText("対戦数未取得")).not.toBeInTheDocument();
    expect(summary.queryByText("分析結果は未取得です")).not.toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get("mapMasterId")).toBe("map_empty");
    expect(new URLSearchParams(router.state.location.search).get("seasonMasterId")).toBe(
      "season_current",
    );
    expect(aggregateReads).toBe(0);
    await user.click(screen.getByRole("button", { name: "比較対象を変更" }));
    expect(screen.getByRole("combobox", { name: "マップ" })).toHaveTextContent(
      "記録のなくなったマップ",
    );
    await user.click(screen.getByRole("button", { name: "全シーズン・全マップに戻す" }));
    expect(await screen.findByRole("heading", { name: "プレーヤーレーダー" })).toBeInTheDocument();
    expect(aggregateReads).toBe(1);
    await act(async () => router.navigate(-1));
    expect(await screen.findByText("この範囲に確定済みの試合がありません")).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get("seasonMasterId")).toBe(
      "season_current",
    );
    expect(new URLSearchParams(router.state.location.search).get("mapMasterId")).toBe("map_empty");
    expect(
      within(screen.getByRole("region", { name: "比較条件" })).getByText("0戦"),
    ).toBeInTheDocument();
    await act(async () => router.navigate(1));
    expect(await screen.findByRole("heading", { name: "プレーヤーレーダー" })).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).has("mapMasterId")).toBe(false);
    expect(new URLSearchParams(router.state.location.search).has("seasonMasterId")).toBe(false);
    expect(aggregateReads).toBe(1);
  });

  it("distinguishes unpublished nonempty scopes from zero matches", async () => {
    server.use(
      http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
        const params = new URL(request.url).searchParams;
        return HttpResponse.json(
          makeSeriesAnalysisScopeStatus({
            artifactId: params.get("artifactId"),
            seasonMasterId: "season_current",
            mapMasterId: "map_empty",
            seasonName: "今シーズン",
            mapName: "追加したマップ",
            state: "awaiting_analysis",
            publishedHasMatches: false,
          }),
        );
      }),
    );
    const { client, router } = renderScope();
    expect(await screen.findByText("この条件の分析を準備しています")).toBeInTheDocument();
    expect(screen.queryByText("この範囲に確定済みの試合がありません")).not.toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get("mapMasterId")).toBe("map_empty");
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const summary = within(screen.getByRole("region", { name: "比較条件" }));
    expect(summary.queryByText("0戦")).not.toBeInTheDocument();
    expect(summary.queryByText("対象試合なし")).not.toBeInTheDocument();
  });

  it.each(["scope_error", "missing_payload"] as const)(
    "does not describe pending or %s results as zero matches",
    async (failure) => {
      const gate = createDeferred();
      server.use(
        http.get("/api/analytics/series-comparison/v2/scope-status", async ({ request }) => {
          const params = new URL(request.url).searchParams;
          if (params.has("artifactId")) {
            await gate.promise;
            if (failure === "scope_error")
              return HttpResponse.json(
                {
                  type: "about:blank",
                  title: "Unavailable",
                  detail: "Scope lookup failed",
                  status: 503,
                  code: "SERVICE_UNAVAILABLE",
                },
                { status: 503 },
              );
          }
          return HttpResponse.json(
            makeSeriesAnalysisScopeStatus({
              artifactId: params.get("artifactId"),
              seasonMasterId: "season_current",
              mapMasterId: "map_empty",
              seasonName: "今シーズン",
              mapName: "選択マップ",
              state: "available",
            }),
          );
        }),
        http.get("/api/analytics/series-comparison/v5/aggregate", () =>
          HttpResponse.json(
            {
              type: "about:blank",
              title: "Unavailable",
              detail: "Missing expected payload",
              status: 500,
              code: "INTERNAL_ERROR",
            },
            { status: 500 },
          ),
        ),
      );
      const { client } = renderScope();
      const summary = within(await screen.findByRole("region", { name: "比較条件" }));
      expect(summary.getByText("対戦数を確認中")).toBeInTheDocument();
      expect(summary.queryByText("0戦")).not.toBeInTheDocument();
      expect(summary.queryByText("対象試合なし")).not.toBeInTheDocument();
      gate.resolve();
      expect(await screen.findByText("戦績データを読み込めません")).toBeInTheDocument();
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(summary.getByText("対戦数未取得")).toBeInTheDocument();
      expect(summary.getByText("分析結果は未取得です")).toBeInTheDocument();
      expect(summary.queryByText("0戦")).not.toBeInTheDocument();
      expect(screen.queryByText("この範囲に確定済みの試合がありません")).not.toBeInTheDocument();
    },
  );

  it("normalizes only an invalid identity and keeps the other valid selection", async () => {
    server.use(
      http.get("/api/analytics/series-comparison/v5/aggregate", () =>
        HttpResponse.json({
          ...makeSeriesAnalysisAggregate(),
          scope: {
            kind: "season",
            displayName: "今シーズン",
            seasonMasterId: "season_current",
            matchCount: 12,
          },
        }),
      ),
    );
    const { router } = renderScope();
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).has("mapMasterId")).toBe(false),
    );
    expect(new URLSearchParams(router.state.location.search).get("seasonMasterId")).toBe(
      "season_current",
    );
    expect(await screen.findByText(/表示条件を調整しました/u)).toBeInTheDocument();
  });
});

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SeriesComparisonPage } from "@/features/seriesComparison/page/SeriesComparisonPage";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisOptionsQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeFourPlayerSeriesAnalysisMatchContext,
  makeOwnerComparisonAggregate,
  makeSeriesAnalysisAggregate,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
beforeAll(() => decodeSeriesAnalysisArtifact("aggregateV4", makeSeriesAnalysisAggregate()));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("SeriesComparisonPage", () => {
  it("changes owner metrics without making the focused control inert or refetching analysis", async () => {
    const user = userEvent.setup();
    let aggregateReads = 0;
    let contextReads = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v4/aggregate", () => {
        aggregateReads += 1;
        return HttpResponse.json(makeOwnerComparisonAggregate());
      }),
      http.get("/api/analytics/series-comparison/v3/match-context", () => {
        contextReads += 1;
        return HttpResponse.json(
          makeFourPlayerSeriesAnalysisMatchContext({ ownerMemberId: "member_akane_mami" }),
        );
      }),
    );
    const queryClient = createTestQueryClient();
    // This regression starts from a loaded, fresh snapshot. Await the real queries (including
    // their generated decoders) and lazy view before timing UI interactions under coverage.
    queryClient.setQueryDefaults(seriesAnalysisKeys.all(), { staleTime: Infinity });
    const query = {
      artifactId: analysisArtifact.artifactId,
      gameTitleId: analysisArtifact.gameTitleId,
    };
    await Promise.all([
      queryClient.fetchQuery(seriesAnalysisOptionsQueryOptions()),
      queryClient.fetchQuery(seriesAnalysisStatusQueryOptions(query.gameTitleId)),
      queryClient.fetchQuery(seriesAnalysisAggregateQueryOptions(query)),
      queryClient.fetchQuery(
        seriesAnalysisMatchContextQueryOptions({ ...query, matchId: "match-12" }),
      ),
      import("@/features/seriesComparison/page/SeriesAnalysisContextView"),
    ]);
    const router = createMemoryRouter(
      [{ path: "/analytics/series", element: <SeriesComparisonPage /> }],
      {
        initialEntries: [
          "/analytics/series?gameTitleId=gt_momotetsu_2&view=context&focusMatchId=match-12",
        ],
      },
    );
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
    });
    const select = screen.getByRole("combobox", { name: "オーナー比較の指標" });
    expect(select.closest("[inert]")).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: /あかねまみ.*この試合のオーナー/u }),
    ).toHaveAttribute("data-highlighted", "true");
    const scroller = screen.getByRole("region", { name: "オーナー別の平均順位の表" });
    scroller.scrollLeft = 123;
    let blockedOwnerControl = false;
    const observer = new MutationObserver((records) => {
      blockedOwnerControl ||= records.some(
        (record) =>
          record.oldValue === null &&
          record.target instanceof HTMLElement &&
          record.target.contains(select),
      );
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["inert"],
      attributeOldValue: true,
      subtree: true,
    });
    try {
      for (const [metric, label] of [
        ["rank.distribution", "順位分布"],
        ["assets.average", "平均総資産"],
      ] as const) {
        await selectOption(user, select, metric);
        await screen.findByRole("table", { name: `オーナー別の${label}` });
        expect(screen.getByRole("combobox", { name: "オーナー比較の指標" })).toBe(select);
        expect(select).toHaveFocus();
        expect(blockedOwnerControl).toBe(false);
        expect(screen.getByRole("region", { name: `オーナー別の${label}の表` })).toBe(scroller);
        expect(scroller.scrollLeft).toBe(123);
        expect(
          screen.getByRole("columnheader", { name: /あかねまみ.*この試合のオーナー/u }),
        ).toHaveAttribute("data-highlighted", "true");
        expect(new URLSearchParams(router.state.location.search).get("ownerMetric")).toBe(metric);
        expect(new URLSearchParams(router.state.location.search).get("focusMatchId")).toBe(
          "match-12",
        );
        expect(router.state.location.hash).toBe("#metric-owner");
      }
      expect(aggregateReads).toBe(1);
      expect(contextReads).toBe(1);
    } finally {
      observer.disconnect();
    }
  });

  it("keeps purpose tabs, analysis tabs, and the metric guide outside stale results", async () => {
    const user = userEvent.setup();
    const aggregate = makeSeriesAnalysisAggregate();
    const refresh = createDeferred();
    let requests = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v4/aggregate", async () => {
        requests += 1;
        if (requests > 1) await refresh.promise;
        return HttpResponse.json(aggregate);
      }),
    );
    await act(async () => {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter
            initialEntries={["/analytics/series?gameTitleId=gt_momotetsu_2&view=overview"]}
          >
            <SeriesComparisonPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const heading = await screen.findByRole("heading", { name: "順位と基礎比較" });
    await user.click(screen.getByRole("button", { name: "表示を更新" }));
    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(heading.closest("[inert]")).not.toBeNull());

    const flowTab = screen.getByRole("tab", { name: "推移" });
    const reviewTab = screen.getByRole("tab", { name: "次戦に備える" });
    const metricGuide = screen.getByRole("button", { name: "指標の読み方" });
    expect(flowTab.closest("[inert]")).toBeNull();
    expect(reviewTab.closest("[inert]")).toBeNull();
    expect(metricGuide.closest("[inert]")).toBeNull();
    expect(heading).toBeVisible();

    await user.click(metricGuide);
    expect(await screen.findByRole("dialog", { name: "指標の読み方" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(flowTab);
    expect(flowTab).toHaveAttribute("aria-selected", "true");
    expect(flowTab).toHaveFocus();

    await act(async () => refresh.resolve());
    const flowHeading = await screen.findByRole("heading", { name: "直近順位と累積推移" });
    await waitFor(() => expect(flowHeading.closest("[inert]")).toBeNull());
    expect(flowTab).toHaveFocus();
  });
});

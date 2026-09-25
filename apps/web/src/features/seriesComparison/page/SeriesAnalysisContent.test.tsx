import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { SeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import type {
  SeriesAnalysisMatchContextV3,
  SeriesComparisonAggregate,
} from "@/shared/api/seriesAnalysis";
import {
  makeFourPlayerSeriesAnalysisReview,
  makeOwnerComparisonAggregate,
  makeSeriesAnalysisAggregate,
  makeFourPlayerSeriesAnalysisMatchContext,
} from "@/test/msw/seriesAnalysisFixtures";
import { createTestQueryClient } from "@/test/queryClient";

type AnalysisViewId = Exclude<SeriesAnalysisViewId, "review">;

function analysisBundle(
  aggregate: SeriesComparisonAggregate,
  view: AnalysisViewId,
): SeriesAnalysisDisplayBundle {
  return { aggregate, kind: "analysis", matchContext: undefined, view };
}

describe("SeriesAnalysisContent", () => {
  it("closes review evidence when its displayed scope changes instead of retargeting an open dialog", async () => {
    const user = userEvent.setup();
    const review = makeFourPlayerSeriesAnalysisReview();
    const callbacks = {
      onArtifactExpired: vi.fn(),
      onClearFocusedMatch: vi.fn(),
      onFocusMatch: vi.fn(),
      onViewChange: vi.fn(),
    };
    const renderBundle = (response: typeof review) => (
      <MemoryRouter>
        <SeriesAnalysisContent
          {...callbacks}
          bundle={{ kind: "review", view: "review", review: response, matchContext: undefined }}
        />
      </MemoryRouter>
    );
    const rendered = render(renderBundle(review));
    const purpose = screen.getByRole("tab", { name: "次戦に備える" });
    await user.click(screen.getAllByRole("button", { name: "根拠・注意・試合後の確認" })[0]!);
    expect(screen.getByRole("dialog", { name: "根拠・注意・試合後の確認" })).toBeInTheDocument();
    rendered.rerender(
      renderBundle({
        ...review,
        scope: { ...review.scope, kind: "season", seasonMasterId: "season-next" },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "次戦に備える" })).toBe(purpose);
  });

  it("keeps the same owner's focus when the match changes and when returning to the context view", async () => {
    const user = userEvent.setup();
    const aggregate = makeOwnerComparisonAggregate();
    const context = makeFourPlayerSeriesAnalysisMatchContext({
      ownerMemberId: "member_akane_mami",
    });
    context.scope = aggregate.scope;
    const nextContext = makeFourPlayerSeriesAnalysisMatchContext({
      matchId: "match-13",
      matchIndex: 13,
      ownerMemberId: "member_akane_mami",
    });
    nextContext.scope = aggregate.scope;
    const queryClient = createTestQueryClient();
    const props = {
      onArtifactExpired: vi.fn(),
      onClearFocusedMatch: vi.fn(),
      onFocusMatch: vi.fn(),
      onViewChange: vi.fn(),
    };
    const view = (
      matchContext: SeriesAnalysisMatchContextV3,
      activeView: AnalysisViewId = "context",
    ) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SeriesAnalysisContent
            {...props}
            bundle={{ ...analysisBundle(aggregate, activeView), matchContext }}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const rendered = render(view(context));
    expect(
      await screen.findByRole("columnheader", { name: /あかねまみ.*この試合のオーナー/u }),
    ).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByRole("link", { name: "第12戦の試合結果を見る" })).toBeInTheDocument();

    rendered.rerender(view(nextContext));
    expect(
      await screen.findByRole("columnheader", { name: /あかねまみ.*この試合のオーナー/u }),
    ).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByRole("link", { name: "第13戦の試合結果を見る" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "第12戦の試合結果を見る" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "今の差" }));
    rendered.rerender(view(nextContext, "overview"));
    expect(screen.getByRole("tab", { name: "今の差" })).toHaveFocus();
    expect(screen.queryByText("この試合のオーナー")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第13戦の試合結果を見る" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "条件別" }));
    rendered.rerender(view(nextContext));
    expect(
      await screen.findByRole("columnheader", { name: /あかねまみ.*この試合のオーナー/u }),
    ).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByRole("tab", { name: "条件別" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "第13戦の試合結果を見る" })).toBeInTheDocument();
  });

  it("links review artifacts without presentation metadata to local evidence sections", () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/analytics/series?gameTitleId=gt_momotetsu_2"]}>
          <SeriesAnalysisContent
            bundle={{
              kind: "review",
              view: "review",
              review: makeFourPlayerSeriesAnalysisReview(),
              matchContext: undefined,
            }}
            onArtifactExpired={vi.fn()}
            onClearFocusedMatch={vi.fn()}
            onFocusMatch={vi.fn()}
            onViewChange={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const links = screen.getAllByRole("link", { name: "物件収益の根拠を見る" });
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link).toHaveAttribute(
        "href",
        "/analytics/series?gameTitleId=gt_momotetsu_2&view=drivers#metric-revenue-outcome",
      );
    }
  });

  it("keeps analysis and its controls usable with a malformed section fragment", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/analytics/series#%E0%A4%A"]}>
          <SeriesAnalysisNavigation>
            <SeriesAnalysisContent
              bundle={analysisBundle(makeSeriesAnalysisAggregate(), "overview")}
              onArtifactExpired={vi.fn()}
              onClearFocusedMatch={vi.fn()}
              onFocusMatch={vi.fn()}
              onViewChange={vi.fn()}
            />
          </SeriesAnalysisNavigation>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "順位と基礎比較" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "指標の読み方" }));
    expect(await screen.findByRole("dialog", { name: "指標の読み方" })).toBeInTheDocument();
  });

  it("reuses one drilldown dialog when it is reopened during exit", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const aggregate = makeSeriesAnalysisAggregate();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SeriesAnalysisContent
            bundle={analysisBundle(aggregate, "overview")}
            onArtifactExpired={vi.fn()}
            onClearFocusedMatch={vi.fn()}
            onFocusMatch={vi.fn()}
            onViewChange={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "順位推移を見る" }));
    const dialog = await screen.findByRole("dialog", { name: "平均順位の推移" });
    await user.click(within(dialog).getByRole("button", { name: "ダイアログを閉じる" }));

    await user.click(screen.getByRole("button", { name: "順位推移を見る" }));
    expect(await screen.findAllByRole("dialog", { name: "平均順位の推移" })).toHaveLength(1);
  });

  it("resets drilldown state when the artifact, scope, or analysis view identity changes", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const aggregate = makeSeriesAnalysisAggregate();
    const nextAggregate = {
      ...makeSeriesAnalysisAggregate(),
      artifact: {
        ...aggregate.artifact,
        artifactId: "artifact-next",
      },
    };
    const props = {
      onArtifactExpired: vi.fn(),
      onClearFocusedMatch: vi.fn(),
      onFocusMatch: vi.fn(),
      onViewChange: vi.fn(),
    };
    const view = (bundle: SeriesAnalysisDisplayBundle) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SeriesAnalysisContent {...props} bundle={bundle} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const rendered = render(view(analysisBundle(aggregate, "overview")));

    await user.click(await screen.findByRole("button", { name: "順位推移を見る" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "平均順位の推移" })).toHaveAccessibleDescription(
      "比較に使った試合を確認します。",
    );
    rendered.rerender(view(analysisBundle(nextAggregate, "overview")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: "順位推移を見る" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    const seasonAggregate: SeriesComparisonAggregate = {
      ...nextAggregate,
      scope: { ...nextAggregate.scope, kind: "season", seasonMasterId: "season_current" },
    };
    rendered.rerender(view(analysisBundle(seasonAggregate, "overview")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: "順位推移を見る" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    const mapAggregate: SeriesComparisonAggregate = {
      ...nextAggregate,
      scope: { ...nextAggregate.scope, kind: "map", mapMasterId: "map_japan" },
    };
    rendered.rerender(view(analysisBundle(mapAggregate, "overview")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: "順位推移を見る" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    rendered.rerender(view(analysisBundle(mapAggregate, "drivers")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

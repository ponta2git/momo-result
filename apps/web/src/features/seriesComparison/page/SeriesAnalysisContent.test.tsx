import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function analysisBundle(
  aggregate: SeriesComparisonAggregate,
  view: AnalysisViewId,
): SeriesAnalysisDisplayBundle {
  return { aggregate, kind: "analysis", matchContext: undefined, view };
}

describe("SeriesAnalysisContent", () => {
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

  it("keeps owner comparison and the metric guide usable", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <SeriesAnalysisContent
            bundle={analysisBundle(makeOwnerComparisonAggregate(), "context")}
            onArtifactExpired={vi.fn()}
            onClearFocusedMatch={vi.fn()}
            onFocusMatch={vi.fn()}
            onViewChange={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("table", { name: "オーナー別の平均順位" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "指標の読み方" }));
    expect(screen.getByRole("dialog", { name: "指標の読み方" })).toHaveTextContent("平均物件収益");
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

  it("opens the shared metric guide from an analysis view", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const aggregate = makeSeriesAnalysisAggregate();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SeriesAnalysisContent
            bundle={analysisBundle(aggregate, "flow")}
            onArtifactExpired={vi.fn()}
            onClearFocusedMatch={vi.fn()}
            onFocusMatch={vi.fn()}
            onViewChange={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const guideTrigger = screen.getByRole("button", { name: "指標の読み方" });
    await user.click(guideTrigger);
    expect(await screen.findByRole("dialog", { name: "指標の読み方" })).toBeInTheDocument();
  });

  it("keeps focus on a nested analysis tab when the controlled view changes", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const aggregate = makeSeriesAnalysisAggregate();
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

    await user.click(screen.getByRole("tab", { name: "勝因候補" }));
    rendered.rerender(view(analysisBundle(aggregate, "drivers")));

    expect(screen.getByRole("tab", { name: "勝因候補" })).toHaveFocus();
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

  it("resets drilldown state when the artifact or analysis view identity changes", async () => {
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

    rendered.rerender(view(analysisBundle(nextAggregate, "drivers")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

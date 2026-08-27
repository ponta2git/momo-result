import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { SeriesAnalysisDisplayBundle } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";
import { createTestQueryClient } from "@/test/queryClient";

type AnalysisViewId = Exclude<SeriesAnalysisViewId, "review">;

function analysisBundle(
  aggregate: SeriesComparisonAggregateV3,
  view: AnalysisViewId,
): SeriesAnalysisDisplayBundle {
  return { aggregate, kind: "analysis", matchContext: undefined, view };
}

describe("SeriesAnalysisContent", () => {
  it("keeps the shared metric guide above every analysis view and opens it as a dialog", async () => {
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
    const flowPanel = screen.getByRole("tabpanel", { name: "推移" });
    expect(
      guideTrigger.compareDocumentPosition(flowPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

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
    expect(await screen.findByLabelText("詳細を読み込み中")).toBeInTheDocument();

    rendered.rerender(view(analysisBundle(nextAggregate, "overview")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: "順位推移を見る" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    rendered.rerender(view(analysisBundle(nextAggregate, "drivers")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

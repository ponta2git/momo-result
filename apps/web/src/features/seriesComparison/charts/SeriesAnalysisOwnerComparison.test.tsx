import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeriesAnalysisOwnerComparison } from "@/features/seriesComparison/charts/SeriesAnalysisOwnerComparison";
import type { OwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import {
  makeOwnerComparisonAggregate,
  makeSeriesAnalysisAggregate,
} from "@/test/msw/seriesAnalysisFixtures";
import { selectOption } from "@/test/selectOption";

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
function Harness() {
  const [metric, setMetric] = useState<OwnerMetricId>("rank.average");
  return (
    <SeriesAnalysisOwnerComparison
      response={makeOwnerComparisonAggregate()}
      metric={metric}
      onMetricChange={setMetric}
    />
  );
}
describe("owner comparison", () => {
  it("keeps all four owners, distinguishes no target and zero, and shows the seven metrics with their denominators", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const select = screen.getByRole("combobox", { name: "オーナー比較の指標" });
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getAllByText("参考値")).toHaveLength(2);
    expect(screen.getAllByText("対象なし")).toHaveLength(2);
    expect(screen.getAllByLabelText("対象なし")).toHaveLength(8);
    expect(within(screen.getAllByRole("row")[1]!).getByText("2位")).toBeInTheDocument();
    for (const [metric, title, value, detail] of [
      ["assets.average", "平均総資産", "100万円", undefined],
      ["revenue.average", "平均物件収益", "10万円", undefined],
      ["destination.average", "目的地到着回数（1試合平均）", "1回/試合", "合計2回"],
      ["ginji.encounterRate", "銀次遭遇率", "50%", "遭遇1戦"],
      ["ginji.average", "銀次遭遇回数（1試合平均）", "1.5回/試合", "合計3回"],
    ] as const) {
      await selectOption(user, select, metric);
      const table = screen.getByRole("table", { name: `オーナー別の${title}` });
      expect(within(table).getAllByText(value)).toHaveLength(
        metric === "assets.average" || metric === "revenue.average" ? 8 : 4,
      );
      if (detail) expect(within(table).getAllByText(detail)).toHaveLength(4);
      expect(within(table).getAllByLabelText("対象なし")).toHaveLength(8);
    }
    expect(screen.getAllByText("0回/試合")).toHaveLength(4);
    await selectOption(user, select, "rank.distribution");
    const table = screen.getByRole("table", { name: "オーナー別の順位分布" });
    expect(table).toHaveTextContent("1位 1回");
    expect(table).toHaveTextContent("2位 0回");
    expect(table).toHaveTextContent("（0%）");
    expect(table).toHaveTextContent("（50%）");
  });

  it("explains legacy and empty scopes without presenting zeroes as observed values", () => {
    const { rerender } = render(
      <SeriesAnalysisOwnerComparison response={makeSeriesAnalysisAggregate()} />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText(/この分析にはオーナー別の集計がありません/u)).toBeInTheDocument();
    const empty = makeOwnerComparisonAggregate();
    empty.scope.matchCount = 0;
    empty.ownerComparison = { owners: [], rows: [], recordedOwnerCount: 0 };
    rerender(<SeriesAnalysisOwnerComparison response={empty} />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("heading", { name: "対象の試合がありません" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeriesAnalysisOwnerComparison } from "@/features/seriesComparison/charts/SeriesAnalysisOwnerComparison";
import type {
  OwnerComparison,
  OwnerMetricId,
} from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import { makeOwnerComparisonAggregate } from "@/test/msw/seriesAnalysisFixtures";
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
function Harness({ focusedOwnerMemberId }: { focusedOwnerMemberId?: string }) {
  const [metric, setMetric] = useState<OwnerMetricId>("rank.average");
  return (
    <SeriesAnalysisOwnerComparison
      comparison={makeOwnerComparisonAggregate().ownerComparison}
      focusedOwnerMemberId={focusedOwnerMemberId}
      hasMatches
      metric={metric}
      onMetricChange={setMetric}
    />
  );
}

function expectFocusedOwner(ownerId: string | undefined) {
  const comparison = makeOwnerComparisonAggregate().ownerComparison;
  const ownerIndex = comparison.owners.findIndex((owner) => owner.memberId === ownerId);
  const table = screen.getByRole("table");
  for (const row of within(table).getAllByRole("row")) {
    for (const [index, cell] of Array.from(row.children).entries()) {
      if (ownerIndex !== -1 && index === ownerIndex + 1) {
        expect(cell).toHaveAttribute("data-highlighted", "true");
      } else {
        expect(cell).not.toHaveAttribute("data-highlighted");
      }
    }
  }
  if (ownerIndex === -1) {
    expect(within(table).queryByText("この試合のオーナー")).not.toBeInTheDocument();
  } else {
    const owner = comparison.owners[ownerIndex]!;
    const header = within(table).getByRole("columnheader", {
      name: new RegExp(owner.displayName, "u"),
    });
    expect(within(header).getByText("この試合のオーナー")).toBeVisible();
    expect(header).toHaveTextContent(`${owner.targetCount}戦`);
    expect(within(header).getByText("参考値")).toBeInTheDocument();
    expect(within(table).getAllByText("この試合のオーナー")).toHaveLength(1);
  }
}

function cellValues() {
  return screen.getAllByRole("cell").map((cell) => cell.textContent);
}

describe("owner comparison", () => {
  it("keeps the owner column focused across all seven metrics while preserving values and denominators", async () => {
    const user = userEvent.setup();
    render(<Harness focusedOwnerMemberId="member_akane_mami" />);
    const select = screen.getByRole("combobox", { name: "オーナー比較の指標" });
    const scrollArea = screen.getByRole("region", { name: "オーナー別の平均順位の表" });
    scrollArea.scrollLeft = 123;
    expectFocusedOwner("member_akane_mami");
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
      expectFocusedOwner("member_akane_mami");
      expect(select).toHaveFocus();
      expect(screen.getByRole("region", { name: `オーナー別の${title}の表` })).toBe(scrollArea);
      expect(scrollArea.scrollLeft).toBe(123);
      const table = screen.getByRole("table", { name: `オーナー別の${title}` });
      expect(within(table).getAllByText(value)).toHaveLength(
        metric === "assets.average" || metric === "revenue.average" ? 8 : 4,
      );
      if (detail) expect(within(table).getAllByText(detail)).toHaveLength(4);
      expect(within(table).getAllByLabelText("対象なし")).toHaveLength(8);
    }
    expect(screen.getAllByText("0回/試合")).toHaveLength(4);
    await selectOption(user, select, "rank.distribution");
    expectFocusedOwner("member_akane_mami");
    const table = screen.getByRole("table", { name: "オーナー別の順位分布" });
    expect(table).toHaveTextContent("1位 1回");
    expect(table).toHaveTextContent("2位 0回");
    expect(table).toHaveTextContent("（0%）");
    expect(table).toHaveTextContent("（50%）");
    for (const rank of within(table).getAllByRole("listitem")) {
      expect(rank).not.toHaveAttribute("data-highlighted");
      expect(rank).not.toHaveAttribute("data-focused-metric");
    }
  });

  it("switches and clears the whole column without changing any aggregate cells", () => {
    const comparison = makeOwnerComparisonAggregate().ownerComparison;
    const view = (focusedOwnerMemberId?: string) => (
      <SeriesAnalysisOwnerComparison
        comparison={comparison}
        focusedOwnerMemberId={focusedOwnerMemberId}
        hasMatches
      />
    );
    const rendered = render(view("member_ponta"));
    const values = cellValues();
    expectFocusedOwner("member_ponta");
    rendered.rerender(view("member_akane_mami"));
    expectFocusedOwner("member_akane_mami");
    expect(cellValues()).toEqual(values);
    rendered.rerender(view());
    expectFocusedOwner(undefined);
    expect(cellValues()).toEqual(values);
  });

  it.each<{
    name: string;
    ownerId: string;
    prepare?: (comparison: OwnerComparison) => void;
  }>([
    { name: "unknown owner", ownerId: "member_unknown" },
    { name: "owner with no target matches", ownerId: "member_otaka" },
    {
      name: "missing player row",
      ownerId: "member_akane_mami",
      prepare: (comparison) => {
        comparison.rows.pop();
      },
    },
    {
      name: "missing owner cell",
      ownerId: "member_akane_mami",
      prepare: (comparison) => {
        comparison.rows[2]!.cells = comparison.rows[2]!.cells.filter(
          (cell) => cell.ownerMemberId !== "member_akane_mami",
        );
      },
    },
  ])("does not infer a column for $name", ({ ownerId, prepare }) => {
    const comparison = makeOwnerComparisonAggregate().ownerComparison;
    prepare?.(comparison);
    render(
      <SeriesAnalysisOwnerComparison
        comparison={comparison}
        focusedOwnerMemberId={ownerId}
        hasMatches
      />,
    );
    expectFocusedOwner(undefined);
  });

  it("explains empty scopes without presenting zeroes as observed values", () => {
    const empty = makeOwnerComparisonAggregate();
    empty.scope.matchCount = 0;
    empty.ownerComparison = { owners: [], rows: [], recordedOwnerCount: 0 };
    render(<SeriesAnalysisOwnerComparison comparison={empty.ownerComparison} hasMatches={false} />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("heading", { name: "対象の試合がありません" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

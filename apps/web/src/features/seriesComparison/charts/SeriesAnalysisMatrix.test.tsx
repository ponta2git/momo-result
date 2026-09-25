import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PlayOrderMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisContextCharts";
import { makeSeriesAnalysisAggregate } from "@/test/msw/seriesAnalysisFixtures";
import { notifyResize } from "@/test/resizeObserver";

describe("analysis matrix scrolling", () => {
  it("makes an overflowing comparison keyboard reachable while preserving native row and column semantics", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PlayOrderMatrix
          entries={makeSeriesAnalysisAggregate().playOrderComparison}
          focusedItemIds={[]}
        />
        <button type="button">比較の次へ</button>
      </>,
    );
    const table = screen.getByRole("table", { name: "番手別成績" });
    const viewport = table.parentElement!;
    const width = vi.spyOn(viewport, "scrollWidth", "get").mockReturnValue(720);
    vi.spyOn(viewport, "clientWidth", "get").mockReturnValue(340);
    act(() => notifyResize(table));
    const region = screen.getByRole("region", { name: "番手別成績" });
    expect(region).toHaveAccessibleDescription("表は左右にスクロールできます。");
    expect(screen.getByRole("rowheader", { name: "ぽんた" })).toHaveAttribute("scope", "row");
    expect(screen.getByRole("columnheader", { name: "プレー順1" })).toHaveAttribute("scope", "col");
    await user.tab();
    expect(region).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "比較の次へ" })).toHaveFocus();

    width.mockReturnValue(340);
    act(() => notifyResize(viewport));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(viewport).not.toHaveAttribute("tabindex");
  });
});

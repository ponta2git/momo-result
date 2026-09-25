import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DataVizHistogramChart } from "@/features/seriesComparison/charts/dataViz/HistogramChart";
import { DataVizLineChart } from "@/features/seriesComparison/charts/dataViz/LineChart";
import { DataVizQuadrantPlot } from "@/features/seriesComparison/charts/dataViz/QuadrantPlot";
import { DataVizScatterPlot } from "@/features/seriesComparison/charts/dataViz/ScatterPlot";

const identities = [1, 2, 3, 4].map((index) => ({
  id: `player-${index}`,
  label: `プレーヤー${index}`,
}));

describe("data visualizations at the analysis display bound", () => {
  it("lets keyboard users skip plotted links and reads exact scatter values through bounded pages", async () => {
    const user = userEvent.setup();
    const points = Array.from({ length: 53 }, (_, index) => ({
      href: `/matches/match-${index + 1}`,
      itemId: `point-${index + 1}`,
      label: `プレーヤー1の第${index + 1}戦`,
      seriesId: "player-1",
      x: index / 100,
      y: index - 30,
    }));
    render(
      <MemoryRouter>
        <DataVizScatterPlot
          ariaLabel="試合の資産"
          points={points}
          seriesIdentity={identities}
          formatX={(value) => `${value * 100}%`}
          formatY={(value) => `${value}万円`}
          xAxisLabel="物件収益比率"
          xMinimumStep={0.1}
          yAxisLabel="総資産"
          yMinimumStep={1}
        />
        <button type="button">次の節</button>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.tab();
    const disclosure = screen.getByRole("button", { name: "試合の資産の数値を表で見る" });
    expect(disclosure).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "次の節" })).toHaveFocus();
    await user.click(disclosure);
    const table = screen.getByRole("table", { name: "試合の資産の数値" });
    expect(within(table).getAllByRole("link")).toHaveLength(25);
    expect(
      within(table).getByRole("link", { name: "プレーヤー1の第1戦の試合結果を見る" }),
    ).toHaveAttribute("href", "/matches/match-1");
    const first = within(table).getByRole("row", { name: /プレーヤー1の第1戦/u });
    expect(within(first).getByRole("cell", { name: "0%" })).toBeInTheDocument();
    expect(within(first).getByRole("cell", { name: "-30万円" })).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "次のページへ" });
    await user.click(next);
    expect(next).toHaveFocus();
    expect(
      within(table).queryByRole("link", { name: "プレーヤー1の第1戦の試合結果を見る" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).getByRole("link", { name: "プレーヤー1の第26戦の試合結果を見る" }),
    ).toHaveAttribute("href", "/matches/match-26");
    expect(screen.getByRole("status")).toHaveTextContent("26〜50件／全53件");
    await user.click(next);
    expect(within(table).getAllByRole("link")).toHaveLength(3);
    expect(next).toBeDisabled();
  });

  it("pairs line values with the same index and named series without filling missing observations", async () => {
    const user = userEvent.setup();
    render(
      <DataVizLineChart
        ariaLabel="累積値"
        focusItemIds={["first-2"]}
        formatIndex={(index) => `第${index}戦`}
        formatValue={(value) => `${value}回`}
        seriesIdentity={identities.slice(0, 2)}
        series={[
          {
            id: "player-1",
            points: [
              { index: 1, itemId: "first-1", value: 0 },
              { index: 2, itemId: "first-2", value: 3 },
            ],
          },
          { id: "player-2", points: [{ index: 2, itemId: "second-2", value: 7 }] },
        ]}
        yAxisLabel="累積回数"
      />,
    );
    await user.click(screen.getByRole("button", { name: "累積値の数値を表で見る" }));
    const table = screen.getByRole("table", { name: "累積値の数値" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["試合", "プレーヤー1", "プレーヤー2"]);
    expect(within(table).getByRole("row", { name: "第1戦 0回 —" })).toBeInTheDocument();
    expect(
      within(table).getByRole("row", { name: "第2戦（この試合） 3回 7回" }),
    ).toBeInTheDocument();
  });

  it("exposes histogram zeros and undefined quadrant coordinates as different values", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DataVizHistogramChart
          ariaLabel="金額帯"
          bins={[
            { id: 0, label: "0〜100万円" },
            { id: 1, label: "100〜200万円" },
          ]}
          series={[{ id: "player-1", counts: [0, 2] }]}
          seriesIdentity={[identities[0]!]}
        />
        <DataVizQuadrantPlot
          ariaLabel="収益と順位"
          cornerLabels={{
            topLeft: "左上",
            topRight: "右上",
            bottomLeft: "左下",
            bottomRight: "右下",
          }}
          points={[{ label: "プレーヤー1", seriesId: "player-1", x: null, y: 2 }]}
          seriesIdentity={[identities[0]!]}
          formatX={(value) => `${value * 100}%`}
          formatY={(value) => `${value}位`}
          xAxisLabel="収益比率"
          xMidpoint={null}
          yAxisLabel="順位"
          yDomain={[1, 4]}
          yMidpoint={null}
        />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "金額帯の数値を表で見る" }));
    const histogram = screen.getByRole("table", { name: "金額帯の数値" });
    expect(within(histogram).getByRole("row", { name: "0〜100万円 0戦" })).toBeInTheDocument();
    expect(within(histogram).getByRole("row", { name: "100〜200万円 2戦" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "収益と順位の数値を表で見る" }));
    expect(
      within(screen.getByRole("table", { name: "収益と順位の数値" })).getByRole("row", {
        name: "プレーヤー1 — 2位",
      }),
    ).toBeInTheDocument();
  });

  it("keeps all 2,000 scatter points without browser-side sampling", () => {
    const points = identities.flatMap((identity, playerIndex) =>
      Array.from({ length: 500 }, (_, matchIndex) => ({
        itemId: `point:${identity.id}:${matchIndex + 1}`,
        label: `${identity.label}の第${matchIndex + 1}戦`,
        seriesId: identity.id,
        x: (matchIndex + 1) / 500,
        y: playerIndex * 500 + matchIndex + 1,
      })),
    );
    const focusedItemId = "point:player-4:500";
    const { container } = render(
      <DataVizScatterPlot
        ariaLabel="上限散布図"
        focusItemIds={[focusedItemId]}
        formatX={String}
        formatY={String}
        points={points}
        seriesIdentity={identities}
        xAxisLabel="横軸"
        xMinimumStep={0.1}
        yAxisLabel="縦軸"
        yMinimumStep={1}
      />,
    );

    const chart = container.querySelector<SVGSVGElement>('svg[aria-label="上限散布図"]');
    expect(chart).not.toBeNull();
    expect(chart?.querySelectorAll("[data-series-shape]")).toHaveLength(2_000);
    expect(chart).toHaveTextContent("プレーヤー4の第500戦、この試合");
    expect(container).toHaveTextContent("選択中の試合は、ほかの点と異なる輪郭で示します。");
  });

  it("keeps every point in four 500-match line paths", () => {
    const series = identities.map((identity, playerIndex) => ({
      id: identity.id,
      points: Array.from({ length: 500 }, (_, matchIndex) => ({
        index: matchIndex + 1,
        itemId: `trend:${identity.id}:${matchIndex + 1}`,
        value: playerIndex + (matchIndex % 10) / 10,
      })),
    }));
    const { container } = render(
      <DataVizLineChart
        ariaLabel="上限折れ線"
        focusItemIds={["trend:player-1:500"]}
        formatIndex={(value) => `第${value}戦`}
        formatValue={String}
        minimumYStep={0.25}
        series={series}
        seriesIdentity={identities}
        yAxisLabel="値"
      />,
    );

    const chart = container.querySelector<SVGSVGElement>('svg[aria-label="上限折れ線"]');
    expect(chart).not.toBeNull();
    const paths = [...(chart?.querySelectorAll('path[fill="none"]') ?? [])];
    expect(paths).toHaveLength(4);
    for (const path of paths) {
      expect(path.getAttribute("d")?.match(/[ML]/gu)).toHaveLength(500);
    }
    expect(chart?.querySelector('[aria-label="第500戦を選択中"]')).toBeInTheDocument();
    expect(chart).toHaveTextContent("第500戦");
    expect(chart).toHaveTextContent("この試合");
  });

  it("excludes non-finite line values from the domain, path, focus, and marks", () => {
    const { container } = render(
      <DataVizLineChart
        ariaLabel="非有限値を含む折れ線"
        focusItemIds={["trend:player-1:nan"]}
        formatValue={String}
        series={[
          {
            id: "player-1",
            points: [
              { index: 1, itemId: "trend:player-1:1", value: 2 },
              { index: 2, itemId: "trend:player-1:nan", value: Number.NaN },
              { index: 3, itemId: "trend:player-1:infinity", value: Number.POSITIVE_INFINITY },
              {
                index: 4,
                itemId: "trend:player-1:negative-infinity",
                value: Number.NEGATIVE_INFINITY,
              },
              { index: 5, itemId: "trend:player-1:5", value: 4 },
            ],
          },
        ]}
        seriesIdentity={[{ id: "player-1", label: "プレーヤー1" }]}
        yAxisLabel="値"
      />,
    );

    const chart = container.querySelector('svg[aria-label="非有限値を含む折れ線"]');
    const path = chart?.querySelector('path[data-series-id="player-1"][fill="none"]');
    expect(path?.getAttribute("d")?.match(/[ML]/gu)).toHaveLength(2);
    expect(path?.getAttribute("d")).not.toMatch(/Infinity|NaN/u);
    expect(chart?.querySelectorAll('[data-series-id="player-1"][data-series-shape]')).toHaveLength(
      2,
    );
    expect(chart?.querySelector('[aria-label$="を選択中"]')).not.toBeInTheDocument();
    expect(chart).not.toHaveTextContent(/Infinity|NaN/u);
  });
});

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { DataVizScatterPlot } from "@/shared/ui/dataViz/ScatterPlot";

const identities = [1, 2, 3, 4].map((index) => ({
  id: `player-${index}`,
  label: `プレーヤー${index}`,
}));

describe("data visualizations at the analysis display bound", () => {
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

    const chart = container.querySelector('svg[aria-label="上限散布図"]');
    expect(chart?.querySelectorAll("[data-series-shape]")).toHaveLength(2_000);
    expect(chart).toHaveTextContent("プレーヤー4の第500戦、この試合");
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

    const chart = container.querySelector('svg[aria-label="上限折れ線"]');
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
    const formatValue = vi.fn(String);
    const { container } = render(
      <DataVizLineChart
        ariaLabel="非有限値を含む折れ線"
        focusItemIds={["trend:player-1:nan"]}
        formatValue={formatValue}
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
    expect(formatValue.mock.calls.flat()).toEqual([0, 2, 4, 6]);
  });
});

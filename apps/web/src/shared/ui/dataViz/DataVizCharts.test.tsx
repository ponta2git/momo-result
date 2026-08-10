import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
    expect(chart).toHaveTextContent("この試合");
  });
});

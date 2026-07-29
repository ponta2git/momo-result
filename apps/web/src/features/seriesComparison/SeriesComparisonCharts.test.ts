import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { makeSeriesComparisonResponse } from "@/test/msw/seriesComparisonFixtures";

import {
  HistogramChart,
  LineChart,
  PlayerLegend,
  RecentRankStrip,
  StrategyProfileChart,
  StrategyScatterPlot,
} from "./charts/SeriesComparisonCharts";

describe("PlayerLegend", () => {
  it("matches line patterns and point shapes to the plotted player series", () => {
    const { container } = render(
      createElement(PlayerLegend, {
        players: [
          { displayName: "桃太郎", memberId: "member-1" },
          { displayName: "夜叉姫", memberId: "member-2" },
          { displayName: "浦島", memberId: "member-3" },
          { displayName: "金太郎", memberId: "member-4" },
        ],
        variant: "line",
      }),
    );

    expect(
      [...container.querySelectorAll("line")].map((line) => line.getAttribute("stroke-dasharray")),
    ).toEqual([null, "7 3", "2 3", "9 3 2 3"]);
    expect(
      [...container.querySelectorAll<SVGElement>("[data-player-shape]")].map(
        (mark) => mark.dataset["playerShape"],
      ),
    ).toEqual(["circle", "square", "diamond", "triangle"]);
  });
});

describe("RecentRankStrip", () => {
  const players = [
    { displayName: "桃太郎", memberId: "member-1" },
    { displayName: "夜叉姫", memberId: "member-2" },
  ];
  const entries = [
    {
      memberId: "member-1",
      points: [
        { matchId: "match-11", matchIndex: 11, rank: 2 },
        { matchId: "match-12", matchIndex: 12, rank: 1 },
      ],
      status: "reference",
      targetCount: 2,
      totalCount: 12,
      windowSize: 8,
    },
    {
      memberId: "member-2",
      points: [
        { matchId: "match-11", matchIndex: 11, rank: 1 },
        { matchId: "match-12", matchIndex: 12, rank: 3 },
      ],
      status: "reference",
      targetCount: 2,
      totalCount: 12,
      windowSize: 8,
    },
  ];

  it("renders all player rows in one horizontal scroll region", () => {
    render(
      createElement(RecentRankStrip, {
        entries,
        players,
      }),
    );

    expect(
      screen.getByRole("region", { name: "直近順位ストリップ横スクロール" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "直近順位ストリップ" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "桃太郎" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "夜叉姫" })).toBeInTheDocument();
    expect(screen.getAllByText("参考")).toHaveLength(1);
    expect(screen.getByLabelText("桃太郎 12戦目 1位")).toBeInTheDocument();
    expect(screen.getByLabelText("夜叉姫 12戦目 3位")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "12戦" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "桃太郎" }).closest("tr")).not.toHaveTextContent(
      "12戦",
    );
  });

  it("initially scrolls the single strip region to the latest match side", () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(320);

    render(
      createElement(RecentRankStrip, {
        entries,
        players,
      }),
    );

    expect(screen.getByRole("region", { name: "直近順位ストリップ横スクロール" })).toHaveProperty(
      "scrollLeft",
      320,
    );
  });

  it("labels and outlines the selected match column", () => {
    const { container } = render(
      createElement(RecentRankStrip, {
        entries,
        focusedMatchId: "match-12",
        players,
      }),
    );

    expect(screen.getByRole("columnheader", { name: "12戦目、この試合" })).toBeInTheDocument();
    expect(screen.getByLabelText("桃太郎 12戦目 1位 この試合")).toBeInTheDocument();
    expect(screen.getByLabelText("夜叉姫 12戦目 3位 この試合")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-focused-metric="true"]')).toHaveLength(3);
  });

  it("shows an empty status once for the whole strip", () => {
    render(
      createElement(RecentRankStrip, {
        entries: [
          {
            memberId: "member-1",
            points: [],
            status: "empty",
            targetCount: 0,
            totalCount: 0,
            windowSize: 8,
          },
          {
            memberId: "member-2",
            points: [],
            status: "empty",
            targetCount: 0,
            totalCount: 0,
            windowSize: 8,
          },
        ],
        players,
      }),
    );

    expect(screen.getAllByText("対象なし")).toHaveLength(1);
    expect(
      screen.queryByRole("region", { name: "直近順位ストリップ横スクロール" }),
    ).not.toBeInTheDocument();
  });
});

describe("HistogramChart", () => {
  it("keeps bars inside the plot area", () => {
    const { container } = render(
      createElement(HistogramChart, {
        histogram: {
          bins: [
            { index: 0, label: "0-1000", lowerInclusive: 0, upperExclusive: 1000 },
            { index: 1, label: "1000-2000", lowerInclusive: 1000, upperExclusive: 2000 },
            { index: 2, label: "2000+", lowerInclusive: 2000 },
          ],
          series: [
            {
              counts: [0, 5, 10],
              memberId: "member-1",
            },
          ],
        },
        players: [{ displayName: "桃太郎", memberId: "member-1" }],
      }),
    );
    const baseline = 164;
    const plotTop = 18;
    const bars = [...container.querySelectorAll("rect")];

    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      const y = Number(bar.getAttribute("y"));
      const height = Number(bar.getAttribute("height"));

      expect(y).toBeGreaterThanOrEqual(plotTop);
      expect(y + height).toBeLessThanOrEqual(baseline);
    }
  });

  it("renders zero-only bins as a single zero label", () => {
    const { container } = render(
      createElement(HistogramChart, {
        histogram: {
          bins: [
            { index: 0, label: "0", lowerInclusive: 0, upperExclusive: 1 },
            { index: 1, label: "1-20", lowerInclusive: 1, upperExclusive: 21 },
          ],
          series: [
            {
              counts: [2, 1],
              memberId: "member-1",
            },
          ],
        },
        players: [{ displayName: "桃太郎", memberId: "member-1" }],
      }),
    );
    const axisLabels = [...container.querySelectorAll("text[transform^='rotate']")].map(
      (node) => node.textContent,
    );

    expect(axisLabels).toEqual(["0", "1万〜20万"]);
  });

  it("reserves an in-bounds area for every horizontal-axis label", () => {
    const response = makeSeriesComparisonResponse();
    const { container } = render(
      createElement(HistogramChart, {
        histogram: response.histograms.assets,
        players: response.players ?? [],
      }),
    );
    const svg = container.querySelector("svg");
    const labels = [...container.querySelectorAll("text[transform^='rotate']")];

    expect(svg).toHaveAttribute("viewBox", "0 0 320 236");
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(Number(label.getAttribute("y"))).toBeLessThanOrEqual(188);
    }
  });
});

describe("StrategyProfileChart", () => {
  it("centers the plot and keeps axis titles in dedicated in-bounds space", () => {
    const response = makeSeriesComparisonResponse();
    const { container } = render(
      createElement(StrategyProfileChart, {
        players: response.players ?? [],
        profiles: response.playerPerformanceProfiles,
      }),
    );
    const svg = screen.getByRole("img", {
      name: "桃鉄型・遊戯王型と順位スコアの4象限",
    });
    const horizontalAxis = container.querySelector("svg > line");
    const yAxisTitle = screen.getByText("順位スコア");
    const xAxisTitle = screen.getByText("物件収益比率");

    expect(svg).toHaveClass("max-w-full");
    expect(horizontalAxis).toHaveAttribute("x1", "52");
    expect(horizontalAxis).toHaveAttribute("x2", "508");
    expect(yAxisTitle.getAttribute("transform")).toMatch(/^rotate\(-90 /u);
    expect(xAxisTitle).toHaveAttribute("text-anchor", "middle");
    expect(screen.getByText("桃鉄型 / 上位")).toBeInTheDocument();
    expect(screen.getByText("遊戯王型 / 上位")).toBeInTheDocument();
  });
});

describe("selected match markers", () => {
  it("marks the selected index and its player points on line charts", () => {
    const response = makeSeriesComparisonResponse();
    const { container } = render(
      createElement(LineChart, {
        ariaLabel: "選択中試合の順位推移",
        focusedIndex: 4,
        formatValue: (value: number) => value.toFixed(2),
        players: response.players ?? [],
        series: response.trends.rankCumulativeAverage ?? [],
      }),
    );

    expect(screen.getByText("選択中")).toBeInTheDocument();
    expect(container.querySelectorAll("circle.momo-enter")).toHaveLength(4);
  });

  it("outlines all four selected-match points on the strategy scatter plot", () => {
    const response = makeSeriesComparisonResponse();
    const { container } = render(
      createElement(StrategyScatterPlot, {
        focusedMatchId: "match-12",
        players: response.players ?? [],
        points: response.matchPlayerPoints ?? [],
      }),
    );

    expect(container.querySelectorAll('[data-focused-match="true"]')).toHaveLength(4);
    expect(screen.getByText(/縁取りは選択中の試合です/u)).toBeInTheDocument();
  });
});

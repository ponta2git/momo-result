import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { RecentRankStrip } from "./SeriesComparisonCharts";

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

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  headToHeadCellTone,
  headToHeadToneLabel,
  RecentRankStrip,
  shouldShowRankStripMatchMarker,
} from "./SeriesComparisonCharts";

describe("headToHeadToneLabel", () => {
  it("uses early-scope battle significance thresholds", () => {
    expect(headToHeadToneLabel(0.8, 3)).toBe("優勢");
    expect(headToHeadToneLabel(0.65, 3)).toBe("優勢");
    expect(headToHeadToneLabel(0.55, 3)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.5, 3)).toBe("互角");
    expect(headToHeadToneLabel(0.45, 3)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.35, 3)).toBe("劣勢");
  });

  it("uses tighter battle labels when the pair has enough matches", () => {
    expect(headToHeadToneLabel(0.601563, 128)).toBe("優勢");
    expect(headToHeadToneLabel(0.554688, 128)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.515625, 128)).toBe("互角");
    expect(headToHeadToneLabel(0.445313, 128)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.398438, 128)).toBe("劣勢");
  });

  it("uses average rank diff when a mature pair rate is near even", () => {
    expect(headToHeadToneLabel(0.484375, 128, -0.1875)).toBe("やや劣勢");
    expect(headToHeadToneLabel(0.515625, 128, 0.1875)).toBe("やや優勢");
    expect(headToHeadToneLabel(0.515625, 128, 0.078125)).toBe("互角");
  });

  it("falls back labels by match count", () => {
    expect(headToHeadToneLabel(0.8, 2)).toBe("参考");
    expect(headToHeadToneLabel(0.5, 0)).toBe("判定なし");
    expect(headToHeadToneLabel(null, 0)).toBe("判定なし");
  });
});

describe("headToHeadCellTone", () => {
  it("uses neutral styling in the 0.45-0.55 band", () => {
    expect(headToHeadCellTone(0.5).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone(0.46).alpha).toBeLessThan(0.2);
    expect(headToHeadCellTone(0.46).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone(0.515625, 128).color).toBe("var(--color-tray-incident)");
    expect(headToHeadCellTone(1, 2).color).toBe("var(--color-tray-incident)");
  });

  it("uses directional styling outside neutral band", () => {
    expect(headToHeadCellTone(0.55).color).toBe("var(--color-action)");
    expect(headToHeadCellTone(0.65).color).toBe("var(--color-action)");
    expect(headToHeadCellTone(0.554688, 128).color).toBe("var(--color-action)");
    expect(headToHeadCellTone(0.45).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.35).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.445313, 128).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.484375, 128, -0.1875).color).toBe("var(--color-danger)");
    expect(headToHeadCellTone(0.515625, 128, 0.1875).color).toBe("var(--color-action)");
  });
});

describe("shouldShowRankStripMatchMarker", () => {
  it("marks the first point, every fifth match, and the latest point", () => {
    expect(shouldShowRankStripMatchMarker(1, 0, 12)).toBe(true);
    expect(shouldShowRankStripMatchMarker(2, 1, 12)).toBe(false);
    expect(shouldShowRankStripMatchMarker(5, 4, 12)).toBe(true);
    expect(shouldShowRankStripMatchMarker(10, 9, 12)).toBe(true);
    expect(shouldShowRankStripMatchMarker(12, 11, 12)).toBe(true);
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

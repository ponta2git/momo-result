import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";

describe("MatchResultLedger", () => {
  it("labels the cumulative-average meaning instead of showing only a signed decimal", () => {
    render(
      <MatchResultLedger
        contextStatus="ready"
        rows={[
          {
            cumulativeAverageAfter: 1.97,
            cumulativeAverageBefore: 2,
            cumulativeAverageDelta: -0.03,
            displayName: "ぽんた",
            memberId: "member_ponta",
            rank: 1,
            revenueAssetRate: 0.5,
            revenueManYen: 900,
            revenueRank: 1.5,
            totalAssetsManYen: 1800,
            trend: "improved",
          },
        ]}
      />,
    );

    expect(screen.getByRole("list", { name: "試合の順位と成績" })).toBeInTheDocument();
    expect(screen.getByText("2.00 → 1.97")).toBeInTheDocument();
    expect(screen.getByText("0.03改善")).toBeInTheDocument();
    expect(screen.getByText("収益順位 1.5位")).toBeInTheDocument();
    expect(screen.getByText("物件収益比率 50.0%")).toBeInTheDocument();
    expect(screen.queryByText("+0.03")).not.toBeInTheDocument();
  });

  it("keeps local results readable when comparison context is unavailable", () => {
    render(
      <MatchResultLedger
        contextStatus="unavailable"
        rows={[
          {
            displayName: "あかねまみ",
            memberId: "member_akane_mami",
            rank: 2,
            revenueManYen: 200,
            revenueRank: 2,
            totalAssetsManYen: 0,
            trend: "unavailable",
          },
        ]}
      />,
    );

    expect(screen.getByText("2位")).toBeInTheDocument();
    expect(screen.getByText("0万円")).toBeInTheDocument();
    expect(screen.getByText("物件収益比率 対象外")).toBeInTheDocument();
    expect(screen.getByText("比較データなし")).toBeInTheDocument();
  });
});

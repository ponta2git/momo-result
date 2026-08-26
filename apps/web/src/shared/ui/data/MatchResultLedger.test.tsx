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
          {
            cumulativeAverageAfter: 2.05,
            cumulativeAverageBefore: 2,
            cumulativeAverageDelta: 0.05,
            displayName: "いーゆー",
            memberId: "member_eu",
            rank: 2,
            revenueManYen: 700,
            revenueRank: 2,
            totalAssetsManYen: 1400,
            trend: "declined",
          },
        ]}
      />,
    );

    expect(screen.getByRole("list", { name: "試合の順位と成績" })).toBeInTheDocument();
    expect(screen.getByText("2.00 → 1.97")).toBeInTheDocument();
    expect(screen.getByText("0.03改善")).toHaveClass("border-[var(--color-analysis-positive)]/45");
    expect(screen.getByText("0.05後退")).toHaveClass("border-[var(--color-analysis-negative)]/35");
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

  it("owns the canonical member order independently of rank and API array order", () => {
    render(
      <MatchResultLedger
        contextStatus="unavailable"
        rows={[
          ledgerRow("member_otaka", "おーたか", 1),
          ledgerRow("member_akane_mami", "あかねまみ", 2),
          ledgerRow("member_ponta", "ぽんた", 3),
          ledgerRow("member_eu", "いーゆー", 4),
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("いーゆー"),
      expect.stringContaining("ぽんた"),
      expect.stringContaining("あかねまみ"),
      expect.stringContaining("おーたか"),
    ]);
    expect(
      screen
        .getAllByRole("listitem")
        .map((item) =>
          item.querySelector("[data-member-sequence]")?.getAttribute("data-member-sequence"),
        ),
    ).toEqual(["1", "2", "3", "4"]);
    expect(screen.getAllByText(/^[1-4]位$/u)).toHaveLength(4);
  });
});

function ledgerRow(memberId: string, displayName: string, rank: number) {
  return {
    displayName,
    memberId,
    rank,
    revenueManYen: rank * 100,
    totalAssetsManYen: rank * 200,
    trend: "unavailable" as const,
  };
}

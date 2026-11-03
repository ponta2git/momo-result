import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchResultLedger } from "@/shared/matches/MatchResultLedger";

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
    expect(screen.getByText("0.03改善")).toBeInTheDocument();
    expect(screen.getByText("0.05後退")).toBeInTheDocument();
    const ponta = cardOf("ぽんた");
    expect(factValue(ponta, "総資産")).toBe("1800万円");
    expect(factValue(ponta, "物件収益")).toBe("900万円");
    expect(factValue(ponta, "収益順位")).toBe("1.5位");
    expect(factValue(ponta, "物件収益比率")).toBe("50.0%");
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

    const card = cardOf("あかねまみ");
    expect(within(card).getAllByText("2位")[0]).toBeInTheDocument();
    expect(factValue(card, "総資産")).toBe("0万円");
    expect(factValue(card, "収益順位")).toBe("2位");
    expect(factValue(cardOf("あかねまみ"), "物件収益比率")).toBe("対象外");
    expect(screen.getByText("比較データなし")).toBeInTheDocument();
  });

  it("does not label an unavailable positive-assets ratio as inapplicable", () => {
    render(
      <MatchResultLedger
        contextStatus="unavailable"
        rows={[ledgerRow("member_ponta", "ぽんた", 1)]}
      />,
    );
    expect(factValue(cardOf("ぽんた"), "物件収益比率")).toBe("—");
  });

  it("shows first through fourth place regardless of member or API order", () => {
    render(
      <MatchResultLedger
        contextStatus="unavailable"
        rows={[
          ledgerRow("member_eu", "いーゆー", 4),
          ledgerRow("member_akane_mami", "あかねまみ", 2),
          ledgerRow("member_otaka", "おーたか", 1),
          ledgerRow("member_ponta", "ぽんた", 3),
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("おーたか"),
      expect.stringContaining("あかねまみ"),
      expect.stringContaining("ぽんた"),
      expect.stringContaining("いーゆー"),
    ]);
    // The rank badge leads each card; the revenue rank is a separate labelled fact.
    expect(
      screen.getAllByRole("listitem").map((item) => within(item).getAllByText(/^[1-4]位$/u)[0]),
    ).toEqual(
      ["1位", "2位", "3位", "4位"].map((rank) => expect.objectContaining({ textContent: rank })),
    );
  });
});

function cardOf(displayName: string): HTMLElement {
  const card = screen.getByRole("heading", { name: displayName }).closest("li");
  if (!card) throw new Error(`no card for ${displayName}`);
  return card;
}

/** Reads a labelled fact the way assistive technology pairs a term with its definition. */
function factValue(card: HTMLElement, label: string): string | null | undefined {
  const term = within(card).getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent;
}

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

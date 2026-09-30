import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PlayerRadarSection } from "@/features/seriesComparison/page/PlayerRadarSection";
import { canonicalResultMembers } from "@/shared/domain/members";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarDisplay } from "@/shared/seriesAnalysis/playerRadarPresentation";

function radarFixture(): PlayerRadarDisplay {
  const sample = {
    quality: "standard" as const,
    matchCount: 48,
    heldEventCount: 12,
    firstPlayedAt: "2026-01-01T00:00:00Z",
    lastPlayedAt: "2026-06-01T00:00:00Z",
    maps: [{ mapMasterId: "map-1", displayName: "マップ1", matchCount: 48 }],
  };
  return {
    sample,
    basis: {
      basisId: "basis-1",
      createdAt: "2026-06-02T00:00:00Z",
      appliedAt: "2026-06-03T00:00:00Z",
      definitionVersion: "six-axes-v1",
      methodVersion: "spread-v1",
      source: sample,
      axes: playerRadarAxes.map((axis) => ({
        axisId: axis.id,
        thresholds: Array.from({ length: 9 }, (_, index) => ({
          score: index + 2,
          rawValue: index,
        })),
      })),
    },
    players: canonicalResultMembers.toReversed().map((member) => ({
      ...member,
      axes: playerRadarAxes.map((axis) => ({
        axisId: axis.id,
        rawValue: axis.id === "averageRank" ? 2.125 : axis.id === "totalAssetsP10" ? -123 : 0,
        score: 7,
        sampleQuality: "standard",
        scoreUnavailableReasons: [],
      })),
    })),
  };
}

describe("PlayerRadarSection", () => {
  it("opens the saved score and raw value in canonical player order without rescoring in the browser", async () => {
    const user = userEvent.setup();
    const { container } = render(<PlayerRadarSection radar={radarFixture()} />);
    expect(screen.queryByRole("table", { name: "6軸の点数と元の成績" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "プレーヤーレーダーの数値を表で見る" }));
    const table = screen.getByRole("table", { name: "6軸の点数と元の成績" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["観点", ...canonicalResultMembers.map((member) => member.displayName)]);
    expect(within(table).getAllByText("7点")).toHaveLength(24);
    expect(within(table).getAllByText("0万円")).toHaveLength(16);
    expect(within(table).getAllByText("-123万円")).toHaveLength(4);
    expect(container.querySelectorAll('[data-radar-score="7"]')).toHaveLength(24);
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.queryByText(/総合点|平均点|総合順位/u)).not.toBeInTheDocument();
    expect(screen.getByLabelText("レーダーの使用基準")).toHaveTextContent(
      "作品共通・2026/06/03適用",
    );
    expect(screen.getByLabelText("レーダーの使用基準")).not.toHaveTextContent("basis-1");
  });

  it("leaves a real gap around an unscored axis and gives reference points a visible non-color meaning", async () => {
    const user = userEvent.setup();
    const radar = radarFixture();
    const firstPlayer = radar.players[0]!;
    const changed = {
      ...radar,
      sample: { ...radar.sample, quality: "reference" as const, matchCount: 20, heldEventCount: 5 },
      players: [
        {
          ...firstPlayer,
          axes: firstPlayer.axes.map((axis) =>
            axis.axisId === "revenueP90"
              ? {
                  ...axis,
                  score: null,
                  sampleQuality: "reference" as const,
                  scoreUnavailableReasons: ["basis_unavailable" as const],
                }
              : axis.axisId === "averageRank"
                ? { ...axis, sampleQuality: "reference" as const }
                : axis,
          ),
        },
      ],
    };
    const { container } = render(<PlayerRadarSection radar={changed} />);
    expect(container.querySelectorAll("[data-radar-edge]")).toHaveLength(4);
    expect(container.querySelector('[data-radar-edge="averageRank"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-radar-edge="revenueP90"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-radar-point="revenueP90"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-radar-point="averageRank"]')).toHaveAttribute(
      "fill",
      "var(--color-surface)",
    );
    expect(container.querySelector('[data-radar-edge="totalAssetsP90"]')).toHaveAttribute(
      "stroke-dasharray",
      "4 4",
    );
    expect(container.querySelector('[data-radar-edge="totalAssetsMedian"]')).not.toHaveAttribute(
      "stroke-dasharray",
    );
    expect(screen.getByRole("img")).toHaveAccessibleDescription(
      /平均順位：7点（参考値）。物件収益（高め）：未採点/u,
    );
    await user.click(screen.getByRole("button", { name: "プレーヤーレーダーの数値を表で見る" }));
    expect(screen.getAllByText("参考値")).toHaveLength(1);
    expect(screen.getByText("基準未適用")).toBeInTheDocument();
  });

  it("preserves both sample shortage and missing-basis reasons while keeping observed zero distinct from no target", async () => {
    const radar = radarFixture();
    render(
      <PlayerRadarSection
        radar={{
          ...radar,
          basis: null,
          sample: { ...radar.sample, quality: "insufficient", matchCount: 2, heldEventCount: 1 },
          players: radar.players.map((player) => ({
            ...player,
            axes: player.axes.map((axis) => ({
              ...axis,
              score: null,
              sampleQuality: "insufficient",
              scoreUnavailableReasons: ["insufficient_matches", "basis_unavailable"],
            })),
          })),
        }}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "6軸の点数と元の成績" });
    expect(within(table).getAllByText("未採点")).toHaveLength(24);
    expect(screen.getByText("3試合未満のため未採点")).toBeInTheDocument();
    expect(screen.getByLabelText("レーダーの使用基準")).toHaveTextContent("基準未適用");
    expect(within(table).queryByText(/3試合未満|基準未適用/u)).not.toBeInTheDocument();
    expect(within(table).getAllByText("0万円")).toHaveLength(16);
    expect(within(table).queryByText("対象なし")).not.toBeInTheDocument();
  });

  it("opens scoring eligibility and boundaries together by keyboard without making every vertex a tab stop", async () => {
    const user = userEvent.setup();
    const { container } = render(<PlayerRadarSection radar={radarFixture()} />);
    await user.tab();
    expect(
      screen.getByRole("button", { name: "プレーヤーレーダーの数値を表で見る" }),
    ).toHaveFocus();
    await user.tab();
    const disclosure = screen.getByRole("button", {
      name: "レーダーの採点基準",
    });
    expect(disclosure).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("3試合以上（40試合未満または8開催未満は参考値）")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "点数の境界" });
    expect(within(table).getByRole("columnheader", { name: "10点" })).toBeInTheDocument();
    expect(within(table).getAllByRole("rowheader")).toHaveLength(6);
    expect(container.querySelector("svg [tabindex]")).not.toBeInTheDocument();
  });
});

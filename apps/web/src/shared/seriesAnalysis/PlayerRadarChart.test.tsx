import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerRadarChart } from "@/shared/seriesAnalysis/PlayerRadarChart";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";

describe("radar chart comparison labels", () => {
  it("shows unchanged scored and unscored values once and keeps the changed transition", () => {
    const before = structuredClone(
      makePlayerRadarEditorView().editing!.evaluation!.raw.players[0]!,
    );
    before.axes.forEach((cell, index) => {
      cell.score = index === 1 ? null : 5;
      cell.scoreUnavailableReasons = [];
    });
    const player = structuredClone(before);
    player.axes[0]!.score = 6;
    render(
      <PlayerRadarChart player={player} referenceScoresGrouped={false} comparison={{ before }} />,
    );
    expect(screen.getAllByText("5点")).toHaveLength(4);
    expect(screen.getByText("未採点")).toBeInTheDocument();
    expect(screen.getByText("5 → 6点")).toBeInTheDocument();
    expect(screen.queryByText("5 → 5点")).not.toBeInTheDocument();
    expect(screen.queryByText("— → —点")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleDescription(
      /平均順位：適用中 5点、変更案 6点/u,
    );
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/物件収益（高め）：未採点/u);
  });
});

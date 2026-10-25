import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerRadarScoringCurve } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarScoringCurve";
import { defaultAchievementPointCurve } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";

describe("PlayerRadarScoringCurve", () => {
  it("compares the legacy default against point steps in point units before an initial six-axis basis", () => {
    const model = makePlayerRadarEditorView();
    const before = structuredClone(model.editing!.evaluation!.raw);
    before.basis = null;
    const after = structuredClone(model.editing!.evaluation!.raw);
    after.basis!.achievementCurve = defaultAchievementPointCurve;
    after.achievementCurve = defaultAchievementPointCurve;
    after.players[0]!.achievement!.score = 6;
    const { container } = render(
      <PlayerRadarScoringCurve axisId="achievement" before={before} after={after} />,
    );
    expect(screen.queryByText("適用中（未適用）")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "実績達成の採点境界と選手の位置" }),
    ).toHaveAccessibleDescription(/50pt、適用中 7点、変更案 6点/u);
    const current = container.querySelector(
      'path[stroke="var(--color-text-secondary)"][stroke-dasharray="5 4"]',
    );
    expect(current).toHaveAttribute("d", expect.stringContaining("L"));
    expect(current?.getAttribute("d")).not.toContain("V");
    expect(
      container.querySelector('path[stroke="var(--color-action)"][fill="none"]'),
    ).toHaveAttribute("d", expect.stringContaining("V"));
    expect(screen.getByText("適用中（従来の得点率）")).toBeVisible();
    expect(container.querySelectorAll('circle[r="5"]')).toHaveLength(4);
  });

  it("renders a published point curve as steps without a six-axis basis and keeps the published score", () => {
    const model = makePlayerRadarEditorView();
    const display = structuredClone(model.editing!.evaluation!.raw);
    display.basis = null;
    display.achievementCurve = {
      pointThresholds: [10, 20, 40, 60, 80, 100, 125, 150, 200],
    };
    display.players[0]!.achievement = { earnedPoints: 22, totalPoints: 100, score: 3 };
    const { container } = render(
      <PlayerRadarScoringCurve axisId="achievement" before={display} after={display} />,
    );
    expect(
      screen.getByRole("img", { name: "実績達成の採点境界と選手の位置" }),
    ).toHaveAccessibleDescription(/22pt、適用中 3点、変更案 3点/u);
    expect(screen.queryByText(/従来の得点率/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/未適用/u)).not.toBeInTheDocument();
    const current = container.querySelector(
      'path[stroke="var(--color-text-secondary)"][stroke-dasharray="5 4"]',
    );
    expect(current).toHaveAttribute("d", expect.stringContaining("V"));
    expect(current?.getAttribute("d")).not.toContain("L");
  });

  it("keeps coincident players distinguishable and leaves ineligible scores unscored", () => {
    const model = makePlayerRadarEditorView();
    const before = structuredClone(model.editing!.evaluation!.raw);
    const after = structuredClone(before);
    for (const player of after.players) {
      const cell = player.axes[0]!;
      cell.rawValue = 2;
      cell.score = 8;
    }
    after.players[1]!.axes[0]!.score = null;
    after.players[1]!.axes[0]!.scoreUnavailableReasons = ["insufficient_matches"];
    const { container } = render(
      <PlayerRadarScoringCurve axisId="averageRank" before={before} after={after} />,
    );
    const chart = screen.getByRole("img", { name: "平均順位の採点境界と選手の位置" });
    expect(chart).toHaveAccessibleDescription(/変更案 未採点/u);
    for (const player of after.players) {
      expect(chart).toHaveAccessibleDescription(new RegExp(player.displayName, "u"));
      expect(
        within(screen.getByRole("list")).getByText(new RegExp(`\\d ${player.displayName}`, "u")),
      ).toBeVisible();
    }
    expect(container.querySelectorAll('circle[r="9"]')).toHaveLength(4);
    expect(container.querySelectorAll('circle[r="4"]')).toHaveLength(3);
    expect(chart.innerHTML).not.toMatch(/NaN|Infinity/u);
  });

  it("shows the edited curve for an initial basis without inventing current scores or missing raw values", () => {
    const model = makePlayerRadarEditorView();
    const after = structuredClone(model.editing!.evaluation!.raw);
    const missing = after.players[0]!;
    missing.axes[0]!.rawValue = null;
    missing.axes[0]!.score = null;
    const { container } = render(
      <PlayerRadarScoringCurve axisId="averageRank" before={null} after={after} />,
    );
    expect(screen.getByText("適用中（未適用）")).toBeVisible();
    expect(screen.getByText(new RegExp(`${missing.displayName}（実値なし）`, "u"))).toBeVisible();
    expect(container.querySelectorAll('circle[r="5"]')).toHaveLength(0);
    expect(container.querySelectorAll('circle[r="9"]')).toHaveLength(3);
  });
});

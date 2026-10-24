import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerRadarScoringCurve } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarScoringCurve";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";

describe("PlayerRadarScoringCurve", () => {
  it("shows the default achievement curve before an initial six-axis basis", () => {
    const model = makePlayerRadarEditorView();
    const before = structuredClone(model.editing!.evaluation!.raw);
    before.basis = null;
    const after = structuredClone(model.editing!.evaluation!.raw);
    after.basis!.achievementCurve = { thresholds: [0, 20, 40, 60, 90] };
    after.players[0]!.achievement!.score = 6;
    const { container } = render(
      <PlayerRadarScoringCurve axisId="achievement" before={before} after={after} />,
    );
    expect(screen.queryByText("適用中（未適用）")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "実績達成の採点境界と選手の位置" }),
    ).toHaveAccessibleDescription(/適用中 7点、変更案 6点/u);
    const current = container.querySelector(
      'path[stroke="var(--color-text-secondary)"][stroke-dasharray="5 4"]',
    );
    expect(current).toHaveAttribute("d", expect.stringContaining("L"));
    expect(current?.getAttribute("d")).not.toContain("V");
    expect(container.querySelectorAll('circle[r="5"]')).toHaveLength(4);
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

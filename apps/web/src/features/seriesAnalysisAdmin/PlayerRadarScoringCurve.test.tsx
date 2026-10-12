import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerRadarScoringCurve } from "@/features/seriesAnalysisAdmin/PlayerRadarScoringCurve";
import { makePlayerRadarEditorModel } from "@/test/fixtures/playerRadarEditorModel";

describe("PlayerRadarScoringCurve", () => {
  it("keeps coincident players distinguishable and leaves ineligible scores unscored", () => {
    const model = makePlayerRadarEditorModel();
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
    const model = makePlayerRadarEditorModel();
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

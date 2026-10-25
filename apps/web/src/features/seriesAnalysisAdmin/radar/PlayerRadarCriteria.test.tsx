import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerRadarCriteria } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarCriteria";
import {
  defaultAchievementCurve,
  defaultAchievementPointCurve,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";

describe("PlayerRadarCriteria", () => {
  it("compares all seven axes in the same score rows", () => {
    const basis = makePlayerRadarEditorView().currentBasis!;
    render(
      <PlayerRadarCriteria
        currentBasis={{ ...basis, achievementCurve: defaultAchievementPointCurve }}
        proposedBasis={null}
      />,
    );
    const table = screen.getByRole("table", { name: "適用中の採点境界" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
    expect(within(table).getByRole("columnheader", { name: "実績達成" })).toBeVisible();
    expect(within(table).getAllByRole("rowheader")).toHaveLength(9);
    const two = within(table).getByRole("rowheader", { name: "2点" }).parentElement!;
    expect(within(two).getByText("5pt以上")).toBeVisible();
    expect(screen.queryByRole("table", { name: "実績達成の採点曲線" })).not.toBeInTheDocument();
  });

  it("keeps legacy knots and point boundaries distinct when comparing different units", () => {
    const basis = makePlayerRadarEditorView().currentBasis!;
    render(
      <PlayerRadarCriteria
        currentBasis={{ ...basis, achievementCurve: defaultAchievementCurve }}
        proposedBasis={{ ...basis, achievementCurve: defaultAchievementPointCurve }}
      />,
    );
    const table = screen.getByRole("table", { name: "採点境界の変更案" });
    const one = within(table).getByRole("rowheader", { name: "1点" }).parentElement!;
    expect(within(one).getByText("0%（従来の得点率）")).toBeVisible();
    const three = within(table).getByRole("rowheader", { name: "3点" }).parentElement!;
    expect(within(three).getByText("10%（従来の得点率）")).toBeVisible();
    expect(within(three).getByText("10pt以上", { exact: false })).toBeVisible();
    const nine = within(table).getByRole("rowheader", { name: "9点" }).parentElement!;
    expect(within(nine).getByText("150pt以上", { exact: false })).toBeVisible();
  });
});

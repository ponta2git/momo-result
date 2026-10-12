import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerRadarPreview } from "@/features/seriesAnalysisAdmin/PlayerRadarPreview";
import { makePlayerRadarEditorModel } from "@/test/fixtures/playerRadarEditorModel";

describe("radar comparison table", () => {
  it("shows a single value for unchanged scores and unscored cells while retaining changed transitions", () => {
    const model = makePlayerRadarEditorModel();
    const before = structuredClone(model.editing!.evaluation!.before!);
    const after = structuredClone(before);
    before.players[0]!.axes[0]!.score = 5;
    after.players[0]!.axes[0]!.score = 6;
    before.players[1]!.axes[0]!.score = null;
    after.players[1]!.axes[0]!.score = null;
    before.players[1]!.axes[0]!.scoreUnavailableReasons = [];
    after.players[1]!.axes[0]!.scoreUnavailableReasons = [];
    render(
      <PlayerRadarPreview
        preview={{
          previewId: "test-comparison",
          createdAt: "2026-10-12T00:00:00Z",
          evaluationState: "ready",
          before,
          after,
          beforeBasis: model.currentBasis,
          candidateBasis: model.currentBasis!,
        }}
        filter={model.previewFilter}
        updating={false}
        onSeasonChange={() => {}}
        onMapChange={() => {}}
        onResetFilter={() => {}}
      />,
    );
    const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    expect(within(table).getAllByLabelText("変更後")).toHaveLength(1);
    expect(within(table).queryByText("増減 0点")).not.toBeInTheDocument();
    expect(within(table).getByText("増減 +1点")).toBeVisible();
    const rank = within(table).getByRole("row", { name: /^平均順位/u });
    expect(within(rank).getAllByText("未採点")).toHaveLength(1);
  });
});

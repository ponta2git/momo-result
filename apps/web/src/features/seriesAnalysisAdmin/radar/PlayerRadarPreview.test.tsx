import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PlayerRadarPreview } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarPreview";
import { makePlayerRadarEditorModel } from "@/test/fixtures/playerRadarEditorModel";

function modelFixture() {
  const model = makePlayerRadarEditorModel();
  const before = structuredClone(model.editing!.evaluation!.raw);
  for (const player of before.players) {
    for (const cell of player.axes) {
      cell.score = 6;
      cell.rawValue = cell.axisId === "averageRank" ? 2.25 : 20000;
    }
  }
  const after = structuredClone(before);
  for (const player of after.players) {
    for (const cell of player.axes) cell.score = 7;
  }
  model.preview = {
    previewId: "preview-1",
    createdAt: "2026-06-04T00:00:00Z",
    evaluationState: "ready",
    before,
    after,
    beforeBasis: model.currentBasis,
    candidateBasis: model.currentBasis!,
  };
  model.actions.resetPreviewFilter = vi.fn();
  model.actions.generate.run = vi.fn();
  model.actions.apply = vi.fn(async () => {});
  return model;
}

function renderPreview(model: ReturnType<typeof modelFixture>) {
  render(
    <PlayerRadarPreview
      preview={model.preview!}
      filter={model.previewFilter}
      updating={false}
      onSeasonChange={model.actions.selectSeason}
      onMapChange={model.actions.selectMap}
      onResetFilter={model.actions.resetPreviewFilter}
    />,
  );
}

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

  it("does not invent previous scores on the first application", () => {
    const model = modelFixture();
    model.currentBasis = null;
    model.preview!.before = null;
    model.preview!.beforeBasis = null;
    renderPreview(model);
    const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(24);
    for (const cell of cells) expect(cell).toHaveTextContent("適用中 未採点 → 変更案 7点");
    expect(within(table).queryByText("0点")).not.toBeInTheDocument();
  });
  it("keeps empty filters explicit with a recovery action instead of presenting previous scores", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.preview!.after = null;
    model.preview!.before = null;
    model.preview!.evaluationState = "empty";
    model.previewFilter = {
      ...model.previewFilter,
      mapMasterId: "map-empty",
      mapOptions: [
        { label: "全マップ", value: "" },
        { label: "記録なしマップ", value: "map-empty" },
      ],
    };
    renderPreview(model);
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent(
      "記録なしマップ",
    );
    expect(screen.getByText("この条件に対象試合はありません")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全期間・全マップで比較する" }));
    expect(model.actions.resetPreviewFilter).toHaveBeenCalledOnce();
  });
  it("offers one title-wide reset beside active comparison filters without changing the candidate", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.previewFilter = {
      ...model.previewFilter,
      seasonMasterId: "season-1",
      mapMasterId: "map-1",
      seasonOptions: [
        { label: "全期間", value: "" },
        { label: "第1シーズン", value: "season-1" },
      ],
      mapOptions: [
        { label: "全マップ", value: "" },
        { label: "マップ1", value: "map-1" },
      ],
    };
    renderPreview(model);
    const filters = screen.getByRole("region", { name: "採点基準の比較条件" });
    expect(within(filters).getByRole("combobox", { name: "比較するシーズン" })).toHaveTextContent(
      "第1シーズン",
    );
    expect(screen.getAllByRole("button", { name: "全期間・全マップで比較する" })).toHaveLength(1);
    await user.click(within(filters).getByRole("button", { name: "全期間・全マップで比較する" }));
    expect(model.actions.resetPreviewFilter).toHaveBeenCalledOnce();
    expect(model.actions.generate.run).not.toHaveBeenCalled();
    expect(model.actions.apply).not.toHaveBeenCalled();
  });
  it.each([
    [12, 3, "40試合未満・8開催未満"],
    [12, 8, "40試合未満"],
    [40, 3, "8開催未満"],
  ])(
    "explains reference scores for %i matches and %i events",
    (matchCount, heldEventCount, reason) => {
      const model = modelFixture();
      for (const evaluation of [model.preview!.before!, model.preview!.after!]) {
        evaluation.sample = {
          ...evaluation.sample,
          matchCount,
          heldEventCount,
          quality: "reference",
        };
        for (const player of evaluation.players) {
          for (const axis of player.axes) axis.sampleQuality = "reference";
        }
      }
      renderPreview(model);
      expect(screen.getByText(`参考値（${reason}）`)).toBeInTheDocument();
      const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
      expect(within(table).queryByText(/参考値/u)).not.toBeInTheDocument();
      expect(within(table).getAllByText("7点")).toHaveLength(24);
    },
  );
  it("keeps partial reference warnings with the affected current and candidate scores", () => {
    const model = modelFixture();
    const before = model.preview!.before!;
    const after = model.preview!.after!;
    before.players[0]!.axes[0]!.sampleQuality = "reference";
    after.players[0]!.axes[0]!.sampleQuality = "reference";
    before.players[1]!.axes[0]!.sampleQuality = "reference";
    after.players[2]!.axes[0]!.sampleQuality = "reference";
    renderPreview(model);
    const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    const cells = within(table).getAllByRole("cell");
    expect(within(cells[0]!).getByText("参考値")).toBeInTheDocument();
    expect(within(cells[1]!).getByText("適用中: 参考値")).toBeInTheDocument();
    expect(within(cells[2]!).getByText("変更案: 参考値")).toBeInTheDocument();
    expect(within(table).getAllByText(/参考値/u)).toHaveLength(3);
    expect(screen.queryByText(/^参考値（/u)).not.toBeInTheDocument();
  });
  it("groups reference scores on a first proposal even when the current basis has no scores", () => {
    const model = modelFixture();
    model.currentBasis = null;
    model.preview!.beforeBasis = null;
    for (const evaluation of [model.preview!.before!, model.preview!.after!]) {
      evaluation.sample = {
        ...evaluation.sample,
        quality: "reference",
        matchCount: 12,
        heldEventCount: 3,
      };
      for (const player of evaluation.players) {
        for (const cell of player.axes) {
          cell.sampleQuality = "reference";
          if (evaluation === model.preview!.before) {
            cell.score = null;
            cell.scoreUnavailableReasons = ["basis_unavailable"];
          }
        }
      }
    }
    renderPreview(model);
    expect(screen.getByText("参考値（40試合未満・8開催未満）")).toBeVisible();
    const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    expect(within(table).queryByText(/参考値/u)).not.toBeInTheDocument();
    expect(within(table).getAllByText("7点")).toHaveLength(24);
    expect(within(table).getAllByText(/未採点/u)).toHaveLength(24);
  });
});

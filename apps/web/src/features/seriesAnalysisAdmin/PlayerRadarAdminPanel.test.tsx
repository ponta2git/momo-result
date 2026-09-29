import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/PlayerRadarAdminPanel";
import { canonicalResultMembers } from "@/shared/domain/members";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarBasis } from "@/shared/seriesAnalysis/playerRadarPresentation";

function action() {
  return { disabledReason: null, pending: false, run: vi.fn() };
}

function modelFixture(): PlayerRadarAdminModel {
  const sample = {
    quality: "standard" as const,
    matchCount: 48,
    heldEventCount: 12,
    firstPlayedAt: "2026-01-01T00:00:00Z",
    lastPlayedAt: "2026-06-01T00:00:00Z",
    maps: [{ mapMasterId: "map-1", displayName: "マップ1", matchCount: 48 }],
  };
  const basis: PlayerRadarBasis = {
    basisId: "basis-current",
    createdAt: "2026-06-02T00:00:00Z",
    appliedAt: "2026-06-03T00:00:00Z",
    definitionVersion: "six-axes-v1",
    methodVersion: "spread-v1",
    source: sample,
    axes: playerRadarAxes.map((axis) => ({
      axisId: axis.id,
      thresholds: Array.from({ length: 9 }, (_, index) => ({ score: index + 2, rawValue: index })),
    })),
  };
  const players = canonicalResultMembers.map((member) => ({
    ...member,
    axes: playerRadarAxes.map((axis) => ({
      axisId: axis.id,
      rawValue: axis.id === "averageRank" ? 2.25 : 20000,
      score: 6,
      sampleQuality: "standard" as const,
      scoreUnavailableReasons: [],
    })),
  }));
  return {
    gameTitleId: "game-title",
    gameTitleName: "比較対象の作品",
    currentBasis: basis,
    previousBasis: null,
    eligibility: { matchCount: 48, heldEventCount: 12 },
    candidate: {
      candidateId: "candidate-1",
      status: "ready",
      source: sample,
      failureMessage: null,
      unavailableAxes: [],
    },
    preview: {
      previewId: "preview-1",
      createdAt: "2026-06-04T00:00:00Z",
      evaluationState: "ready",
      before: { basis, sample, players },
      after: {
        basis: { ...basis, basisId: "basis-candidate" },
        sample,
        players: players.map((player) => ({
          ...player,
          axes: player.axes.map((cell) => ({ ...cell, score: 7 })),
        })),
      },
      beforeBasis: basis,
      candidateBasis: { ...basis, basisId: "basis-candidate" },
    },
    previewState: "ready",
    previewFilter: {
      seasonMasterId: "",
      mapMasterId: "",
      seasonOptions: [{ label: "全期間", value: "" }],
      mapOptions: [{ label: "全マップ", value: "" }],
    },
    previewUpdating: false,
    operation: null,
    review: { explanation: "基準を自動変更せず、必要に応じて確認できます。", reasons: [] },
    feedback: null,
    communicationUnknown: false,
    applyDisabledReason: null,
    applyPending: false,
    actions: {
      refresh: action(),
      generate: action(),
      rebuildPreview: action(),
      withdraw: action(),
      restore: action(),
      retry: action(),
      checkOperation: action(),
      apply: vi.fn(async () => undefined),
      acknowledge: vi.fn(),
      selectSeason: vi.fn(),
      selectMap: vi.fn(),
      resetPreviewFilter: vi.fn(),
    },
  };
}

describe("PlayerRadarAdminPanel", () => {
  it.each(["適用を確認する", "候補を取り下げる"])(
    "returns keyboard focus to %s after Escape",
    async (name) => {
      const user = userEvent.setup();
      render(<PlayerRadarAdminPanel model={modelFixture()} />);
      const trigger = screen.getByRole("button", { name });
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

  it("returns focus to the section heading when an apply trigger becomes unavailable", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    const { rerender } = render(<PlayerRadarAdminPanel model={model} />);
    await user.click(screen.getByRole("button", { name: "適用を確認する" }));
    rerender(
      <PlayerRadarAdminPanel
        model={{ ...model, applyDisabledReason: "最新の比較を確認してください。" }}
      />,
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "レーダーの採点基準" })).toHaveFocus(),
    );
  });

  it("compares the same raw result in one cell and confirms title-wide application using the reviewed identities", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    render(<PlayerRadarAdminPanel model={model} />);
    const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    const firstCell = within(table).getAllByRole("cell")[0]!;
    expect(firstCell).toHaveTextContent("現行 6点 → 候補 7点");
    expect(within(firstCell).getByText("2.25位")).toBeInTheDocument();
    expect(screen.getByText(/同じ記録での点数：現行 → 候補/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "適用を確認する" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("比較対象の作品の全シーズン・全マップに適用します");
    expect(dialog).toHaveTextContent("過去に見た点数も変わります");
    expect(dialog).toHaveTextContent("基準作成日時");
    expect(dialog).toHaveTextContent("48試合・12開催");
    expect(model.actions.apply).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "作品全体に適用する" }));
    expect(model.actions.apply).toHaveBeenCalledExactlyOnceWith({
      gameTitleId: "game-title",
      candidateId: "candidate-1",
      previewId: "preview-1",
      expectedCurrentBasisId: "basis-current",
      basisId: "basis-candidate",
    });
  });

  it("does not invent previous scores on the first application", () => {
    const model = modelFixture();
    model.currentBasis = null;
    model.preview!.before = null;
    model.preview!.beforeBasis = null;
    render(<PlayerRadarAdminPanel model={model} />);
    const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(24);
    for (const cell of cells) expect(cell).toHaveTextContent("現行 未採点 → 候補 7点");
    expect(within(table).queryByText("0点")).not.toBeInTheDocument();
  });

  it("requires refreshing a stale comparison and keeps calculation separate from state refresh", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.previewState = "stale";
    model.applyDisabledReason = "比較を更新してから適用してください。";
    render(<PlayerRadarAdminPanel model={model} />);
    expect(screen.getByRole("button", { name: "適用を確認する" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "基準の状態を更新" }));
    expect(model.actions.refresh.run).toHaveBeenCalledOnce();
    expect(model.actions.rebuildPreview.run).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "最新の記録で比較を計算する" }));
    expect(model.actions.rebuildPreview.run).toHaveBeenCalledOnce();
    expect(model.actions.apply).not.toHaveBeenCalled();
  });

  it("invalidates an open confirmation when the comparison changes and leaves the candidate intact on cancel", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    const { rerender } = render(<PlayerRadarAdminPanel model={model} />);
    await user.click(screen.getByRole("button", { name: "適用を確認する" }));
    rerender(
      <PlayerRadarAdminPanel
        model={{ ...model, preview: { ...model.preview!, previewId: "preview-2" } }}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeDisabled();
    expect(dialog).toHaveTextContent("比較または現行基準が変わりました");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(model.actions.apply).not.toHaveBeenCalled();
    expect(model.actions.withdraw.run).not.toHaveBeenCalled();
  });

  it("offers state reconciliation instead of labeling a lost response as a definite failure", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.communicationUnknown = true;
    model.applyDisabledReason = "操作の状態を確認してください。";
    render(<PlayerRadarAdminPanel model={model} />);
    expect(screen.getByText("操作の受付結果をまだ確認できません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この処理を再試行する" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "操作の状態を確認する" }));
    expect(model.actions.checkOperation.run).toHaveBeenCalledOnce();
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
    render(<PlayerRadarAdminPanel model={model} />);
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
    render(<PlayerRadarAdminPanel model={model} />);
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
      const after = model.preview!.after!;
      after.sample = { ...after.sample, matchCount, heldEventCount, quality: "reference" };
      for (const player of after.players) {
        for (const axis of player.axes) axis.sampleQuality = "reference";
      }
      render(<PlayerRadarAdminPanel model={model} />);
      expect(
        screen.getByText(`${reason}のため、点数を参考値として表示しています。`),
      ).toBeInTheDocument();
      const table = screen.getByRole("table", { name: "採点基準変更前後の比較" });
      expect(within(table).getAllByText("参考値")).toHaveLength(24);
      expect(within(table).getAllByText("7点")).toHaveLength(24);
    },
  );

  it("keeps saved monitoring evidence visible while acknowledging that evidence alone", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.review = {
      explanation: null,
      reasons: [
        {
          evidenceKey: "high-score-evidence",
          label: "平均順位で高得点が続いています。",
          acknowledged: false,
          evidence: [
            { label: "確認対象", value: "40試合・8開催" },
            { label: "1つ目の期間", value: "2026/01/01〜2026/02/01（20試合・4開催）" },
            { label: "2つ目の期間", value: "2026/03/01〜2026/04/01（20試合・4開催）" },
          ],
        },
      ],
    };
    render(<PlayerRadarAdminPanel model={model} />);
    const review = screen.getByRole("region", { name: "見直しの目安" });
    expect(within(review).getByText("40試合・8開催")).toBeInTheDocument();
    expect(within(review).getByText(/2026\/01\/01〜2026\/02\/01/u)).toBeInTheDocument();
    expect(within(review).getByText(/2026\/03\/01〜2026\/04\/01/u)).toBeInTheDocument();
    await user.click(within(review).getByRole("button", { name: "この目安を確認し、基準を継続" }));
    expect(model.actions.acknowledge).toHaveBeenCalledExactlyOnceWith("high-score-evidence");
    expect(model.actions.generate.run).not.toHaveBeenCalled();
    expect(model.actions.apply).not.toHaveBeenCalled();
  });
});

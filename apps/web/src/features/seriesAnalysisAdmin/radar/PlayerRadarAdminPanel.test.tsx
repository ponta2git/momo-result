import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdminPanel";
import {
  previewRadarThresholds,
  radarInputBasis,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";
import { pointAchievementCurveFixture } from "@/test/msw/playerRadarFixtures";

function modelFixture() {
  const model = makePlayerRadarEditorView();
  const input = structuredClone(model.editing!.current!.input);
  input.axes[0]!.thresholds[0] = 5;
  input.achievementCurve = pointAchievementCurveFixture;
  const basis = { ...radarInputBasis(model.currentBasis!, input), basisId: "basis-candidate" };
  model.candidate = {
    candidateId: "candidate-1",
    status: "ready",
    manuallyEdited: true,
    basis,
    source: basis.source,
    failureMessage: null,
    unavailableAxes: [],
  };
  model.editing!.candidate = {
    ...model.editing!.current!,
    basis,
    input,
    label: "変更案",
    expectedCandidateId: "candidate-1",
    savedCandidateId: "candidate-1",
  };
  model.previewState = "ready";
  model.applyDisabledReason = null;
  model.preview = {
    previewId: "preview-1",
    createdAt: "2026-10-12T00:00:00Z",
    evaluationState: "ready",
    before: model.editing!.evaluation!.before,
    after: previewRadarThresholds(model.editing!.evaluation!.raw, basis, input),
    beforeBasis: model.currentBasis,
    candidateBasis: basis,
  };
  model.editing!.reuseCandidate = vi.fn(async () => {});
  model.actions.refresh.run = vi.fn();
  model.actions.withdraw.run = vi.fn();
  model.actions.checkOperation.run = vi.fn();
  model.actions.generate.run = vi.fn();
  model.actions.acknowledge = vi.fn();
  model.actions.apply = vi.fn(async () => {});
  return model;
}

async function openApply(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "変更案を編集" }));
  await user.click(screen.getByRole("button", { name: "変更を適用" }));
  const dialog = screen.getByRole("alertdialog");
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeEnabled(),
  );
  return dialog;
}

describe("PlayerRadarAdminPanel", () => {
  it("opens its completed candidate only once and stays closed after discarding the edit", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.autoEditCandidateId = model.candidate!.candidateId;
    model.candidate!.status = "pending";
    const view = render(<PlayerRadarAdminPanel administration={model} />);
    expect(screen.queryByRole("region", { name: "採点境界の編集" })).not.toBeInTheDocument();
    model.candidate!.status = "ready";
    view.rerender(<PlayerRadarAdminPanel administration={{ ...model }} />);
    expect(await screen.findByRole("region", { name: "採点境界の編集" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "編集をやめる" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "編集内容を破棄する" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "採点境界の編集" })).not.toBeInTheDocument(),
    );
    view.rerender(<PlayerRadarAdminPanel administration={{ ...model }} />);
    expect(screen.queryByRole("region", { name: "採点境界の編集" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更案を編集" })).toBeEnabled();
  });

  it("shows only current boundaries before editing and opens comparison from the proposal editor", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    render(<PlayerRadarAdminPanel administration={model} />);
    const current = screen.getByRole("table", { name: "適用中の採点境界" });
    expect(current).toBeVisible();
    expect(current.querySelector("caption")).toHaveClass("sr-only");
    for (const cell of within(current).getAllByRole("cell")) {
      expect(cell).not.toHaveTextContent("適用中");
      expect(cell).not.toHaveTextContent("変更案");
    }
    expect(screen.queryByRole("table", { name: "採点境界の変更案" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "点数への影響" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この変更案を適用する" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "変更案を編集" }));
    expect(await screen.findByRole("table", { name: "採点基準変更前後の比較" })).toBeVisible();
    expect(screen.getByRole("button", { name: "変更を適用" })).toBeEnabled();
    expect(model.actions.apply).not.toHaveBeenCalled();
  });

  it("returns focus to the withdrawal trigger after Escape", async () => {
    const user = userEvent.setup();
    render(<PlayerRadarAdminPanel administration={modelFixture()} />);
    const trigger = screen.getByRole("button", { name: "変更案を取り下げる" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the section heading when the editor apply trigger becomes unavailable", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    const { rerender } = render(<PlayerRadarAdminPanel administration={model} />);
    await openApply(user);
    rerender(
      <PlayerRadarAdminPanel
        administration={{
          ...model,
          editing: { ...model.editing!, saveDisabledReason: "最新の状態を確認してください。" },
        }}
      />,
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "採点境界" })).toHaveFocus());
  });

  it("confirms title-wide application from the editor using the reviewed identities", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    render(<PlayerRadarAdminPanel administration={model} />);
    const dialog = await openApply(user);
    expect(dialog).toHaveTextContent("桃太郎電鉄2の全シーズン・全マップに適用します");
    expect(dialog).toHaveTextContent("過去の成績もこの基準で再採点します");
    expect(model.actions.apply).not.toHaveBeenCalled();
    expect(model.editing!.reuseCandidate).toHaveBeenCalledExactlyOnceWith("candidate-1");
    await user.click(within(dialog).getByRole("button", { name: "作品全体に適用する" }));
    expect(model.actions.apply).toHaveBeenCalledExactlyOnceWith({
      gameTitleId: model.gameTitleId,
      candidateId: "candidate-1",
      previewId: "preview-1",
      expectedCurrentBasisId: model.currentBasis!.basisId,
      basisId: "basis-candidate",
    });
  });

  it("waits for a fresh comparison inside confirmation before allowing application", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.previewState = "stale";
    model.applyDisabledReason = "最新の記録で比較を計算し、内容を確認してください。";
    render(<PlayerRadarAdminPanel administration={model} />);
    await user.click(screen.getByRole("button", { name: "変更案を編集" }));
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeDisabled();
    await waitFor(() =>
      expect(model.editing!.reuseCandidate).toHaveBeenCalledExactlyOnceWith("candidate-1"),
    );
    await user.click(within(dialog).getByRole("button", { name: "確認結果を更新" }));
    expect(model.actions.refresh.run).toHaveBeenCalledOnce();
    expect(model.actions.apply).not.toHaveBeenCalled();
  });

  it("invalidates an open confirmation when the comparison changes", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    const { rerender } = render(<PlayerRadarAdminPanel administration={model} />);
    const dialog = await openApply(user);
    rerender(
      <PlayerRadarAdminPanel
        administration={{ ...model, preview: { ...model.preview!, previewId: "preview-2" } }}
      />,
    );
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeDisabled();
    expect(dialog).toHaveTextContent("比較または適用中の基準が変わりました");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(model.actions.apply).not.toHaveBeenCalled();
    expect(model.actions.withdraw.run).not.toHaveBeenCalled();
  });

  it("offers state reconciliation instead of labeling a lost response as a definite failure", async () => {
    const user = userEvent.setup();
    const model = modelFixture();
    model.communicationUnknown = true;
    render(<PlayerRadarAdminPanel administration={model} />);
    expect(screen.getByText("操作の受付結果をまだ確認できません")).toBeVisible();
    expect(screen.queryByRole("button", { name: "この処理を再試行する" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "操作の状態を確認する" }));
    expect(model.actions.checkOperation.run).toHaveBeenCalledOnce();
  });

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
          evidence: [{ label: "確認対象", value: "40試合・8開催" }],
        },
      ],
    };
    render(<PlayerRadarAdminPanel administration={model} />);
    const review = screen.getByRole("region", { name: "見直しの目安" });
    expect(within(review).getByText("40試合・8開催")).toBeVisible();
    await user.click(within(review).getByRole("button", { name: "この目安を確認し、基準を継続" }));
    expect(model.actions.acknowledge).toHaveBeenCalledExactlyOnceWith("high-score-evidence");
    expect(model.actions.generate.run).not.toHaveBeenCalled();
    expect(model.actions.apply).not.toHaveBeenCalled();
  });
});

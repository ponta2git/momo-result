import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdminPanel";
import type { PlayerRadarAdministrationView } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import type { RadarManualSave } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import {
  previewRadarThresholds,
  radarInputBasis,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import { createDeferred } from "@/test/deferred";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";

function comparisonModel(
  original: PlayerRadarAdministrationView,
  request: RadarManualSave,
  ready: boolean,
): PlayerRadarAdministrationView {
  const editing = original.editing;
  const source = editing?.current;
  const evaluation = editing?.evaluation;
  if (!editing || !source || !evaluation) throw new Error("Missing editor fixture");
  const basis = { ...radarInputBasis(source.basis, request.manualInput), basisId: "manual-basis" };
  const after = previewRadarThresholds(evaluation.raw, basis, request.manualInput);
  return {
    ...original,
    candidate: {
      candidateId: "manual-candidate",
      status: ready ? "ready" : "pending",
      manuallyEdited: true,
      basis: ready ? basis : null,
      source: ready ? basis.source : null,
      failureMessage: null,
      unavailableAxes: [],
    },
    previewState: ready ? "ready" : "pending",
    preview: ready
      ? {
          previewId: "manual-preview",
          createdAt: evaluation.createdAt,
          evaluationState: "ready",
          before: evaluation.before,
          after,
          beforeBasis: original.currentBasis,
          candidateBasis: basis,
        }
      : null,
    operation: {
      operationId: "manual-operation",
      kind: "manual",
      status: ready ? "succeeded" : "running",
      title: ready ? "確認完了" : "確認中",
      detail: "",
    },
    applyDisabledReason: ready ? null : "正式な比較を確認してください。",
    editing: {
      ...editing,
      current: { ...source, expectedCandidateId: "manual-candidate" },
      candidate: {
        ...source,
        label: "入力した変更案",
        input: request.manualInput,
        expectedCandidateId: "manual-candidate",
        savedCandidateId: "manual-candidate",
      },
      evaluation: ready ? { ...evaluation, key: "manual-preview:latest", raw: after } : evaluation,
    },
  };
}

async function startManualApply() {
  const user = userEvent.setup();
  const model = makePlayerRadarEditorView();
  const editing = model.editing;
  if (!editing) throw new Error("Missing editor fixture");
  const accepted = createDeferred<{ candidateId: string; operationId: string }>();
  const save = vi.fn((_request: RadarManualSave) => accepted.promise);
  const apply = vi.fn(async () => {});
  const refresh = vi.fn();
  editing.save = save;
  model.actions.apply = apply;
  model.actions.refresh.run = refresh;
  const rendered = render(<PlayerRadarAdminPanel administration={model} />);
  await user.click(screen.getByRole("button", { name: "調整を始める" }));
  const input = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
  fireEvent.change(input, { target: { value: "4.95" } });
  await user.click(screen.getByRole("button", { name: "変更を適用" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "この基準を作品全体に適用しますか？",
  });
  expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
  const request = save.mock.calls[0]?.[0];
  if (!request) throw new Error("Manual input was not submitted");
  expect(request.manualInput.axes[0]?.thresholds[0]).toBe(4.95);
  expect(request.sourceBasisId).toBe(model.currentBasis?.basisId);
  expect(request.expectedCurrentBasisId).toBe(model.currentBasis?.basisId);
  expect(request.expectedCandidateId).toBeNull();
  return { user, model, accepted, save, apply, refresh, rendered, request, dialog };
}

describe("manual radar application confirmation", () => {
  it("opens immediately and waits for the formal comparison before applying its exact identities", async () => {
    const flow = await startManualApply();
    await act(async () =>
      flow.accepted.resolve({ candidateId: "manual-candidate", operationId: "manual-operation" }),
    );
    flow.rendered.rerender(
      <PlayerRadarAdminPanel administration={comparisonModel(flow.model, flow.request, false)} />,
    );
    const confirm = within(flow.dialog).getByRole("button", { name: "作品全体に適用する" });
    expect(confirm).toBeDisabled();
    expect(flow.apply).not.toHaveBeenCalled();
    await flow.user.click(within(flow.dialog).getByRole("button", { name: "確認結果を更新" }));
    expect(flow.refresh).toHaveBeenCalledTimes(1);
    flow.rendered.rerender(
      <PlayerRadarAdminPanel administration={comparisonModel(flow.model, flow.request, true)} />,
    );
    await waitFor(() => expect(confirm).toBeEnabled());
    await flow.user.click(confirm);
    expect(flow.apply).toHaveBeenCalledExactlyOnceWith({
      gameTitleId: flow.model.gameTitleId,
      candidateId: "manual-candidate",
      previewId: "manual-preview",
      expectedCurrentBasisId: flow.model.currentBasis?.basisId,
      basisId: "manual-basis",
    });
    expect(flow.save).toHaveBeenCalledTimes(1);
  });

  it("cancels without applying and keeps the visible input available when confirmation resumes", async () => {
    const flow = await startManualApply();
    await act(async () =>
      flow.accepted.resolve({ candidateId: "manual-candidate", operationId: "manual-operation" }),
    );
    flow.rendered.rerender(
      <PlayerRadarAdminPanel administration={comparisonModel(flow.model, flow.request, false)} />,
    );
    await flow.user.click(within(flow.dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(flow.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" })).toHaveValue(
      "4.95",
    );

    flow.rendered.rerender(
      <PlayerRadarAdminPanel administration={comparisonModel(flow.model, flow.request, true)} />,
    );
    await flow.user.click(screen.getByRole("button", { name: "変更を適用" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "この基準を作品全体に適用しますか？",
    });
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeEnabled();
    await flow.user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(flow.apply).not.toHaveBeenCalled();
    expect(flow.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" })).toHaveValue(
      "4.95",
    );
  });
});

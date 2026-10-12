import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/PlayerRadarAdminPanel";
import {
  previewRadarThresholds,
  radarInputBasis,
} from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import type { RadarManualInput } from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import { makePlayerRadarEditorModel } from "@/test/fixtures/playerRadarEditorModel";

afterEach(() => vi.useRealTimers());

describe("radar threshold input workflow", () => {
  it("saves visible decimal input before blur, preserves other original values, and supports per-field undo", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorModel();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel model={model} />);
    await user.click(screen.getByRole("button", { name: "適用中の基準を調整" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(9);
    const first = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    const next = screen.getByRole("textbox", { name: "平均順位 3点の境界（位以下）" });
    await user.clear(first);
    await user.type(first, "4.95");
    await user.keyboard("{Enter}");
    expect(next).toHaveFocus();
    await user.clear(next);
    await user.type(next, "4.35");
    await user.keyboard("{Escape}");
    expect(next).toHaveValue("4.3");
    expect(first).toHaveValue("4.95");
    expect(save).not.toHaveBeenCalled();
    // A programmatic keyboard/button activation does not depend on input blur committing state.
    await user.click(first);
    fireEvent.click(screen.getByRole("button", { name: "案を保存して比較" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const submitted = save.mock.calls[0]![0];
    expect(submitted.manualInput.axes[0]!.thresholds[0]).toBe(4.95);
    expect(submitted.manualInput.axes[2]!.thresholds[0]).toBe(77.80000000000001);
    expect(submitted.expectedCurrentBasisId).toBe(model.currentBasis!.basisId);
    expect(submitted.expectedCandidateId).toBeNull();
  });

  it("keeps an incomplete value across axis changes and opens the hidden invalid axis on save", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorModel();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel model={model} />);
    await user.click(screen.getByRole("button", { name: "適用中の基準を調整" }));
    const first = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(first);
    await user.type(first, "-");
    await user.click(screen.getByRole("tab", { name: "総資産（低め）" }));
    const asset = screen.getByRole("textbox", { name: "総資産（低め） 2点の境界（万円以上）" });
    await user.clear(asset);
    await user.type(asset, "-25.5");
    await user.click(screen.getByRole("button", { name: "案を保存して比較" }));
    const invalid = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    expect(invalid).toHaveFocus();
    expect(invalid).toHaveValue("-");
    expect(invalid).toHaveAttribute("aria-invalid", "true");
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "総資産（低め）" }));
    expect(
      screen.getByRole("textbox", { name: "総資産（低め） 2点の境界（万円以上）" }),
    ).toHaveValue("-25.5");
  });

  it("does not turn IME Enter into navigation, saving, or a valid pending preview", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorModel();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel model={model} />);
    await user.click(screen.getByRole("button", { name: "適用中の基準を調整" }));
    const input = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    input.focus();
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: "4.95" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    act(() => vi.advanceTimersByTime(350));
    expect(input).toHaveFocus();
    expect(screen.getByText(/入力を確認中です/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "案を保存して比較" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    act(() => vi.advanceTimersByTime(300));
    vi.useRealTimers();
    expect(
      screen.getByText("入力中の仮プレビューです。案はまだ適用されていません。"),
    ).toBeInTheDocument();
  });

  it("keeps the previous comparison visibly stale while a now-invalid input cancels the queued preview", async () => {
    const user = userEvent.setup();
    render(<PlayerRadarAdminPanel model={makePlayerRadarEditorModel()} />);
    await user.click(screen.getByRole("button", { name: "適用中の基準を調整" }));
    const comparison = await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    const previous = comparison.textContent;
    const input = screen.getByRole("textbox", { name: "平均順位 9点の境界（位以下）" });
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: "1.7" } });
    fireEvent.change(input, { target: { value: "" } });
    act(() => vi.advanceTimersByTime(350));
    vi.useRealTimers();
    expect(comparison.textContent).toBe(previous);
    expect(screen.getByText(/現在の入力を反映していません/u)).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("requires explicit reconfirmation after editing and reverting a formally compared saved candidate", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorModel();
    const input: RadarManualInput = structuredClone(model.editing!.current!.input);
    input.axes[0]!.thresholds[0] = 5;
    const basis = { ...radarInputBasis(model.currentBasis!, input), basisId: "saved-basis" };
    model.candidate = {
      candidateId: "saved-candidate",
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
      label: "保存済みの案",
      expectedCandidateId: "saved-candidate",
      savedCandidateId: "saved-candidate",
    };
    model.previewState = "ready";
    model.applyDisabledReason = null;
    model.preview = {
      previewId: "formal-preview",
      createdAt: "2026-10-12T00:00:00Z",
      evaluationState: "ready",
      before: model.editing!.evaluation!.before,
      after: previewRadarThresholds(model.editing!.evaluation!.raw, basis, input),
      beforeBasis: model.currentBasis,
      candidateBasis: basis,
    };
    const reuse = vi.fn(model.editing!.reuseCandidate);
    const save = vi.fn(model.editing!.save);
    model.editing!.reuseCandidate = reuse;
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel model={model} />);
    await user.click(screen.getByRole("button", { name: "保存済みの案を編集" }));
    const apply = screen.getByRole("button", { name: "この変更案を適用する" });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "案を保存して比較" }));
    await waitFor(() => expect(apply).toBeEnabled());
    const first = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(first);
    await user.type(first, "5.1");
    await user.keyboard("{Escape}");
    expect(first).toHaveValue("5");
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "案を保存して比較" }));
    await waitFor(() => expect(apply).toBeEnabled());
    expect(reuse).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("region", { name: "採点境界の編集" })).getByText(
        "保存済みの案を正式計算した比較です。",
      ),
    ).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlayerRadarAdminPanel } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdminPanel";
import {
  previewRadarThresholds,
  radarInputBasis,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import type { RadarManualInput } from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";

afterEach(() => vi.useRealTimers());

describe("radar threshold input workflow", () => {
  it("keeps edits when leaving is cancelled and discards them only after confirmation", async () => {
    const user = userEvent.setup();
    render(<PlayerRadarAdminPanel administration={makePlayerRadarEditorView()} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    const input = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(input);
    await user.type(input, "4.95");
    await user.click(screen.getByRole("button", { name: "編集をやめる" }));
    let dialog = screen.getByRole("alertdialog", { name: "編集内容を破棄しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(input).toHaveValue("4.95");
    expect(screen.getByRole("button", { name: "編集をやめる" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "編集をやめる" }));
    dialog = screen.getByRole("alertdialog", { name: "編集内容を破棄しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "編集内容を破棄する" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "採点境界の編集" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("table", { name: "適用中の採点境界" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    expect(screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" })).toHaveValue(
      "4.9",
    );
  });

  it("shows ordering constraints immediately on both affected boundaries without a form notice", async () => {
    const user = userEvent.setup();
    render(<PlayerRadarAdminPanel administration={makePlayerRadarEditorView()} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    const first = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    const next = screen.getByRole("textbox", { name: "平均順位 3点の境界（位以下）" });
    next.focus();
    fireEvent.change(next, { target: { value: "5" } });
    expect(next).toHaveFocus();
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(first).toHaveAccessibleDescription(/3点の境界（5位）より大きい値にしてください。/u);
    expect(next).toHaveAccessibleDescription(/2点の境界（4.9位）より小さい値にしてください。/u);
    expect(screen.getByText(/入力に不備があるため、比較を更新できません。/u)).toBeVisible();
    expect(screen.queryByText("採点境界の入力を確認してください")).not.toBeInTheDocument();
    fireEvent.change(first, { target: { value: "1" } });
    fireEvent.change(next, { target: { value: "2" } });
    expect(next).toHaveAccessibleDescription(/2点の境界（1位）より小さい値にしてください。/u);
    expect(next).toHaveAccessibleDescription(/4点の境界（3.7位）より大きい値にしてください。/u);
  });

  it("waits for blur for incomplete numbers and suppresses error emphasis during IME composition", async () => {
    const user = userEvent.setup();
    render(<PlayerRadarAdminPanel administration={makePlayerRadarEditorView()} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    const input = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(input);
    await user.type(input, "-");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/入力に不備があるため/u)).not.toBeInTheDocument();
    await user.tab();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/数値を最後まで入力してください。/u);
    expect(screen.getByText(/入力に不備があるため、比較を更新できません。/u)).toBeVisible();
    expect(screen.queryByText("採点境界の入力を確認してください")).not.toBeInTheDocument();
    fireEvent.compositionStart(input);
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.compositionEnd(input);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const last = screen.getByRole("textbox", { name: "平均順位 10点の境界（位以下）" });
    fireEvent.change(last, { target: { value: "0.5" } });
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(last).toHaveAccessibleDescription(/10点の境界は1位以上にしてください。/u);
  });

  it("saves visible decimal input before blur, preserves other original values, and supports per-field undo", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorView();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel administration={model} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
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
    fireEvent.click(screen.getByRole("button", { name: "変更を適用" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const submitted = save.mock.calls[0]![0];
    expect(submitted.manualInput.axes[0]!.thresholds[0]).toBe(4.95);
    expect(submitted.manualInput.axes[2]!.thresholds[0]).toBe(77.80000000000001);
    expect(submitted.expectedCurrentBasisId).toBe(model.currentBasis!.basisId);
    expect(submitted.expectedCandidateId).toBeNull();
  });

  it("keeps an incomplete value across axis changes and opens the hidden invalid axis on save", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorView();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel administration={model} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    const comparison = await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    expect(within(comparison).getAllByRole("row")).toHaveLength(2);
    expect(within(comparison).getByRole("rowheader", { name: "平均順位" })).toBeVisible();
    const first = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(first);
    await user.type(first, "-");
    await user.click(screen.getByRole("tab", { name: "総資産（低め）" }));
    const assetComparison = screen.getByRole("table", { name: "採点基準変更前後の比較" });
    expect(within(assetComparison).getAllByRole("row")).toHaveLength(2);
    expect(
      within(assetComparison).getByRole("rowheader", { name: "総資産（低め）" }),
    ).toBeVisible();
    expect(
      within(assetComparison).queryByRole("rowheader", { name: "平均順位" }),
    ).not.toBeInTheDocument();
    const asset = screen.getByRole("textbox", { name: "総資産（低め） 2点の境界（万円以上）" });
    await user.clear(asset);
    await user.type(asset, "-25.5");
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
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
    const model = makePlayerRadarEditorView();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel administration={model} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    const input = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    input.focus();
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: "4.95" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    act(() => vi.advanceTimersByTime(350));
    expect(input).toHaveFocus();
    expect(screen.getByText(/入力を確認中です/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更を適用" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    act(() => vi.advanceTimersByTime(300));
    vi.useRealTimers();
    expect(screen.getByText("入力中の比較です。まだ適用されていません。")).toBeInTheDocument();
  });

  it("starts a usable new edit after discarding an unfinished IME composition", async () => {
    const user = userEvent.setup();
    const model = makePlayerRadarEditorView();
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    render(<PlayerRadarAdminPanel administration={model} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
    fireEvent.compositionStart(
      screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" }),
    );
    await user.click(screen.getByRole("button", { name: "編集をやめる" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "編集内容を破棄する",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "調整を始める" }));
    const input = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(input);
    await user.type(input, "4.95");
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0].manualInput.axes[0]!.thresholds[0]).toBe(4.95);
  });

  it("keeps the previous comparison visibly stale while a now-invalid input cancels the queued preview", async () => {
    const user = userEvent.setup();
    render(<PlayerRadarAdminPanel administration={makePlayerRadarEditorView()} />);
    await user.click(screen.getByRole("button", { name: "調整を始める" }));
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
    const model = makePlayerRadarEditorView();
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
    render(<PlayerRadarAdminPanel administration={model} />);
    await user.click(screen.getByRole("button", { name: "変更案を編集" }));
    expect(screen.queryByRole("button", { name: "案を保存して比較" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この変更案を適用する" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    let dialog = screen.getByRole("alertdialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    const first = screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(first);
    await user.type(first, "5.1");
    await user.keyboard("{Escape}");
    expect(first).toHaveValue("5");
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    dialog = screen.getByRole("alertdialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeEnabled(),
    );
    expect(reuse).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});

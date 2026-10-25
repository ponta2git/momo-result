import { act, renderHook } from "@testing-library/react";
import { Activity } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RadarManualSave } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import { previewRadarThresholds } from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import { useRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/radar/useRadarThresholdEditor";
import { createDeferred } from "@/test/deferred";
import { makePlayerRadarEditorView } from "@/test/fixtures/playerRadarEditorView";
import { pointAchievementCurveFixture } from "@/test/msw/playerRadarFixtures";

describe("radar editor saved identity", () => {
  it("treats a different inherited legacy curve as a change even when the six axes match the current basis", async () => {
    const model = makePlayerRadarEditorView();
    const source = structuredClone(model.editing!.current!);
    source.basis = {
      ...source.basis,
      basisId: "different-legacy",
      achievementCurve: { thresholds: [0, 20, 40, 60, 90] },
    };
    source.input.axes[0]!.thresholds[0] = 5;
    source.basis.axes[0]!.thresholds[0]!.rawValue = 5;
    source.expectedCandidateId = "legacy-candidate";
    source.savedCandidateId = "legacy-candidate";
    source.sourceCandidateId = "legacy-candidate";
    source.sourceBasisId = source.basis.basisId;
    model.candidate = {
      candidateId: "legacy-candidate",
      status: "ready",
      basis: source.basis,
      source: source.basis.source,
      failureMessage: null,
      unavailableAxes: [],
    };
    model.editing!.candidate = source;
    const save = vi.fn(model.editing!.save);
    model.editing!.save = save;
    const { result } = renderHook(() => useRadarThresholdEditor(model));
    act(() => result.current.beginFromCandidate());
    act(() => result.current.change("averageRank", 0, "4.9"));
    expect(result.current.noChangeFromCurrent).toBe(false);
    await act(async () => {
      await result.current.requestApply();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![0].manualInput).not.toHaveProperty("achievementCurve");
  });

  it("keeps the settled preview while draft text changes and publishes it after the debounce", () => {
    vi.useFakeTimers();
    try {
      const model = makePlayerRadarEditorView();
      const { result } = renderHook(() => useRadarThresholdEditor(model));
      act(() => result.current.beginFromCurrent());
      act(() => vi.advanceTimersByTime(300));
      const settled = result.current.preview;
      expect(settled).not.toBeNull();
      expect(result.current.ready).toBe(true);

      act(() => result.current.change("averageRank", 0, "4.9"));
      expect(result.current.drafts?.averageRank[0]).toBe("4.9");
      expect(result.current.ready).toBe(false);
      expect(result.current.preview).toBe(settled);
      act(() => result.current.change("averageRank", 0, "4.95"));
      expect(result.current.preview).toBe(settled);

      act(() => vi.advanceTimersByTime(300));
      expect(result.current.ready).toBe(true);
      expect(result.current.preview).not.toBe(settled);
      expect(
        result.current.preview?.candidateBasis.axes.find((axis) => axis.axisId === "averageRank")
          ?.thresholds[0]?.rawValue,
      ).toBe(4.95);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles preparation while Activity is hidden and recovers its authorized receipt with the input intact", async () => {
    const model = makePlayerRadarEditorView();
    const editing = model.editing!;
    const gate = createDeferred();
    const save = vi.fn(async (_request: RadarManualSave) => {
      await gate.promise;
      throw new DOMException("権限を確認できません", "AbortError");
    });
    editing.save = save;
    let visible = true;
    const { result, rerender } = renderHook((value) => useRadarThresholdEditor(value), {
      initialProps: model,
      wrapper: ({ children }: { children: ReactNode }) => (
        <Activity mode={visible ? "visible" : "hidden"}>{children}</Activity>
      ),
    });
    act(() => result.current.beginFromCurrent());
    act(() => result.current.change("averageRank", 0, "4.950"));
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.requestApply();
    });
    expect(result.current.preparingApply).toBe(true);
    const request = save.mock.calls[0]![0];
    visible = false;
    rerender({ ...model, editing: { ...editing, permissionReason: "権限確認中" } });
    await act(async () => {
      gate.resolve();
      await pending;
    });
    visible = true;
    const candidate = {
      candidateId: "accepted-hidden-save",
      status: "pending" as const,
      basis: null,
      source: null,
      failureMessage: null,
      unavailableAxes: [],
    };
    rerender({
      ...model,
      candidate,
      editing: {
        ...editing,
        acceptedSave: {
          candidateId: candidate.candidateId,
          operationId: "hidden-operation",
          request,
        },
      },
    });
    expect(result.current.preparingApply).toBe(false);
    expect(result.current.replacesCandidate).toBe(true);
    expect(result.current.drafts?.averageRank[0]).toBe("4.950");
    expect(result.current.contextChanged).toBe(false);
    expect(result.current.applyError).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "discards only this edit's prepared candidate and retains input on failure (%s)",
    async (fails) => {
      const model = makePlayerRadarEditorView();
      const editing = model.editing!;
      const discard = vi.fn(async () => {
        if (fails) throw new Error("discard failed");
      });
      editing.discard = discard;
      const { result } = renderHook(() => useRadarThresholdEditor(model));
      act(() => result.current.beginFromCurrent());
      act(() => result.current.change("averageRank", 0, "4.95"));
      await act(async () => {
        await result.current.requestApply();
      });
      await act(async () => {
        if (fails) await expect(result.current.discard()).rejects.toThrow();
        else await result.current.discard();
      });
      expect(discard).toHaveBeenCalledWith({
        candidateId: "saved-candidate",
        operationId: "saved-operation",
      });
      expect(result.current.active).toBe(fails);
      if (fails) expect(result.current.drafts?.averageRank[0]).toBe("4.95");
    },
  );

  it("requires reconfirmation for a new formal evaluation but preserves it across scope changes", async () => {
    const model = makePlayerRadarEditorView();
    const editing = model.editing;
    const current = editing?.current;
    const evaluation = editing?.evaluation;
    if (!editing || !current || !evaluation) throw new Error("Missing editor fixture");
    current.input.achievementCurve = pointAchievementCurveFixture;
    current.basis.achievementCurve = pointAchievementCurveFixture;
    editing.current = { ...current, expectedCandidateId: "saved", savedCandidateId: "saved" };
    model.candidate = {
      candidateId: "saved",
      status: "ready",
      basis: current.basis,
      source: current.basis.source,
      failureMessage: null,
      unavailableAxes: [],
    };
    model.previewState = "ready";
    model.preview = {
      previewId: "formal-one",
      createdAt: evaluation.createdAt,
      evaluationState: "ready",
      before: evaluation.before,
      after: previewRadarThresholds(evaluation.raw, current.basis, current.input),
      beforeBasis: current.basis,
      candidateBasis: current.basis,
    };
    const { result, rerender } = renderHook((value) => useRadarThresholdEditor(value), {
      initialProps: model,
    });
    act(() => result.current.beginFromCurrent());
    await act(async () => {
      await result.current.requestApply();
    });
    expect(result.current.canApply).toBe(true);

    const scoped = { ...model, previewFilter: { ...model.previewFilter, mapMasterId: "east" } };
    rerender(scoped);
    expect(result.current.canApply).toBe(true);
    expect(result.current.comparisonChanged).toBe(false);

    rerender({ ...scoped, preview: { ...model.preview, previewId: "formal-two" } });
    expect(result.current.canApply).toBe(false);
    expect(result.current.comparisonChanged).toBe(true);
    await act(async () => {
      await result.current.requestApply();
    });
    expect(result.current.canApply).toBe(true);
    expect(result.current.comparisonChanged).toBe(false);
  });

  it.each([
    new TypeError("Connection lost after acceptance"),
    new DOMException("権限を確認できません", "AbortError"),
  ])(
    "recovers an interrupted save only from its matching authorized receipt (%s)",
    async (failure) => {
      const model = makePlayerRadarEditorView();
      const editing = model.editing;
      const source = editing?.current;
      if (!editing || !source) throw new Error("Missing editor fixture");
      const save = vi.fn(
        async (
          _request: RadarManualSave,
        ): Promise<{ candidateId: string; operationId: string }> => {
          throw failure;
        },
      );
      editing.save = save;
      const { result, rerender } = renderHook((value) => useRadarThresholdEditor(value), {
        initialProps: model,
      });
      act(() => result.current.beginFromCurrent());
      act(() => result.current.change("averageRank", 0, "4.95"));
      await act(async () => {
        await result.current.requestApply();
      });
      const request = save.mock.calls[0]?.[0];
      if (!request) throw new Error("Save request was not captured");
      expect(result.current.replacesCandidate).toBe(false);
      expect(result.current.applyError).toContain("受付結果はまだ不明");

      const candidate = {
        candidateId: "accepted-manual",
        status: "pending" as const,
        basis: null,
        source: null,
        failureMessage: null,
        unavailableAxes: [],
      };
      rerender({
        ...model,
        candidate,
        editing: {
          ...editing,
          acceptedSave: {
            candidateId: candidate.candidateId,
            operationId: "accepted-manual-operation",
            request: { ...request, sourceBasisId: "another-editing-source" },
          },
        },
      });
      expect(result.current.replacesCandidate).toBe(false);
      expect(result.current.contextChanged).toBe(true);

      const receipt = {
        candidateId: candidate.candidateId,
        operationId: "accepted-manual-operation",
        request,
      };
      rerender({
        ...model,
        candidate,
        editing: {
          ...editing,
          acceptedSave: receipt,
          permissionReason: "権限確認中",
        },
      });
      expect(result.current.replacesCandidate).toBe(false);

      rerender({ ...model, candidate, editing: { ...editing, acceptedSave: receipt } });
      expect(result.current.replacesCandidate).toBe(true);
      expect(result.current.drafts?.averageRank[0]).toBe("4.95");
      expect(result.current.contextChanged).toBe(false);
      expect(result.current.applyError).toBeNull();
      expect(result.current.canApply).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "reconciles a recovered application without discarding newer input (edited again: %s)",
    async (editedAgain) => {
      const model = makePlayerRadarEditorView();
      const editing = model.editing!;
      const { result, rerender } = renderHook((value) => useRadarThresholdEditor(value), {
        initialProps: model,
      });
      act(() => result.current.beginFromCurrent());
      act(() => result.current.change("averageRank", 0, "4.95"));
      await act(async () => {
        await result.current.requestApply();
      });
      if (editedAgain) act(() => result.current.change("averageRank", 0, "5.1"));
      const acceptedApply = { operationId: "recovered-apply", candidateId: "saved-candidate" };
      rerender({
        ...model,
        editing: { ...editing, acceptedApply, permissionReason: "権限を確認中" },
      });
      expect(result.current.active).toBe(true);
      rerender({ ...model, editing: { ...editing, acceptedApply } });
      expect(result.current.active).toBe(editedAgain);
      expect(result.current.isNavigationAllowed()).toBe(!editedAgain);
      if (editedAgain) expect(result.current.drafts?.averageRank[0]).toBe("5.1");
    },
  );

  it("does not treat an invalid generated candidate as the active shared save identity", () => {
    const model = makePlayerRadarEditorView();
    const source = model.editing?.current;
    if (!source) throw new Error("Missing editor fixture");
    model.candidate = {
      candidateId: "invalid-old-candidate",
      status: "invalid",
      basis: null,
      source: null,
      failureMessage: "source changed",
      unavailableAxes: [],
    };
    const { result } = renderHook(() => useRadarThresholdEditor(model));
    act(() => result.current.beginFromCurrent());
    expect(result.current.contextChanged).toBe(false);
  });
});

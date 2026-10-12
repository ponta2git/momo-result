import { act, renderHook } from "@testing-library/react";
import { Activity } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RadarManualSave } from "@/features/seriesAnalysisAdmin/radarThresholdEditorModel";
import { useRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/useRadarThresholdEditor";
import { createDeferred } from "@/test/deferred";
import { makePlayerRadarEditorModel } from "@/test/fixtures/playerRadarEditorModel";

describe("radar editor saved identity", () => {
  it("settles preparation while Activity is hidden and recovers its authorized receipt with the input intact", async () => {
    const model = makePlayerRadarEditorModel();
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
    act(() => result.current.begin(editing.current!));
    act(() => result.current.change("averageRank", 0, "4.950"));
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.prepareApply();
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
    expect(result.current.session?.saved?.candidateId).toBe(candidate.candidateId);
    expect(result.current.session?.drafts.averageRank[0]).toBe("4.950");
    expect(result.current.contextChanged).toBe(false);
    expect(result.current.applyError).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "discards only this edit's prepared candidate and retains input on failure (%s)",
    async (fails) => {
      const model = makePlayerRadarEditorModel();
      const editing = model.editing!;
      const discard = vi.fn(async () => {
        if (fails) throw new Error("discard failed");
      });
      editing.discard = discard;
      const { result } = renderHook(() => useRadarThresholdEditor(model));
      act(() => result.current.begin(editing.current!));
      act(() => result.current.change("averageRank", 0, "4.95"));
      await act(async () => {
        await result.current.prepareApply();
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
      if (fails) expect(result.current.session?.drafts.averageRank[0]).toBe("4.95");
    },
  );

  it("requires reconfirmation for a new formal evaluation but preserves it across scope changes", async () => {
    const model = makePlayerRadarEditorModel();
    const editing = model.editing;
    const current = editing?.current;
    const evaluation = editing?.evaluation;
    if (!editing || !current || !evaluation) throw new Error("Missing editor fixture");
    const source = { ...current, expectedCandidateId: "saved", savedCandidateId: "saved" };
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
      after: evaluation.raw,
      beforeBasis: current.basis,
      candidateBasis: current.basis,
    };
    const { result, rerender } = renderHook((value) => useRadarThresholdEditor(value), {
      initialProps: model,
    });
    act(() => result.current.begin(source));
    await act(async () => {
      await result.current.prepareApply();
    });
    expect(result.current.canApply).toBe(true);
    expect(result.current.session?.confirmedPreviewId).toBe("formal-one");

    const scoped = { ...model, previewFilter: { ...model.previewFilter, mapMasterId: "east" } };
    rerender(scoped);
    expect(result.current.canApply).toBe(true);
    expect(result.current.comparisonChanged).toBe(false);

    rerender({ ...scoped, preview: { ...model.preview, previewId: "formal-two" } });
    expect(result.current.canApply).toBe(false);
    expect(result.current.comparisonChanged).toBe(true);
    await act(async () => {
      await result.current.prepareApply();
    });
    expect(result.current.canApply).toBe(true);
    expect(result.current.comparisonChanged).toBe(false);
    expect(result.current.session?.confirmedPreviewId).toBe("formal-two");
  });

  it.each([
    new TypeError("Connection lost after acceptance"),
    new DOMException("権限を確認できません", "AbortError"),
  ])(
    "recovers an interrupted save only from its matching authorized receipt (%s)",
    async (failure) => {
      const model = makePlayerRadarEditorModel();
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
      act(() => result.current.begin(source));
      act(() => result.current.change("averageRank", 0, "4.95"));
      await act(async () => {
        await result.current.prepareApply();
      });
      const request = save.mock.calls[0]?.[0];
      if (!request) throw new Error("Save request was not captured");
      expect(result.current.session?.saved).toBeNull();
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
      expect(result.current.session?.saved).toBeNull();
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
      expect(result.current.session?.saved).toBeNull();

      rerender({ ...model, candidate, editing: { ...editing, acceptedSave: receipt } });
      expect(result.current.session?.saved?.candidateId).toBe(candidate.candidateId);
      expect(result.current.session?.confirmed).toBe(true);
      expect(result.current.session?.drafts.averageRank[0]).toBe("4.95");
      expect(result.current.contextChanged).toBe(false);
      expect(result.current.applyError).toBeNull();
      expect(result.current.canApply).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "reconciles a recovered application without discarding newer input (edited again: %s)",
    async (editedAgain) => {
      const model = makePlayerRadarEditorModel();
      const editing = model.editing!;
      const { result, rerender } = renderHook((value) => useRadarThresholdEditor(value), {
        initialProps: model,
      });
      act(() => result.current.begin(editing.current!));
      act(() => result.current.change("averageRank", 0, "4.95"));
      await act(async () => {
        await result.current.prepareApply();
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
      expect(result.current.navigationAllowedRef.current).toBe(!editedAgain);
      if (editedAgain) expect(result.current.session?.drafts.averageRank[0]).toBe("5.1");
    },
  );

  it("does not treat an invalid generated candidate as the active shared save identity", () => {
    const model = makePlayerRadarEditorModel();
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
    act(() => result.current.begin(source));
    expect(result.current.contextChanged).toBe(false);
  });
});

import { useCallback, useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker, useNavigate } from "react-router-dom";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type {
  OcrSubmissionProgress,
  OcrSubmissionResult,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import type { OcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { formatApiError } from "@/shared/api/problemDetails";
import { showToast } from "@/shared/ui/feedback/Toast";

type SelectedGameTitle = {
  id: string;
  layoutFamily?: string | null;
  name?: string;
};

export type OcrSubmissionPlan = {
  selectedGameTitle: SelectedGameTitle | undefined;
  selectedSlotLabels: string[];
  setup: SetupFormValues;
  setupSummary: {
    gameTitle: string;
    map: string;
    owner: string;
    season: string;
  };
  slots: CaptureSlotState[];
};

export type OcrStartDialogState =
  | { status: "closed" }
  | { plan: OcrSubmissionPlan; status: "confirming" }
  | {
      plan: OcrSubmissionPlan;
      progress: OcrSubmissionProgress | null;
      status: "submitting";
    }
  | {
      createdJobCount: number;
      failedJobCount: number;
      plan: OcrSubmissionPlan;
      status: "partial_result";
    }
  | { message: string; plan: OcrSubmissionPlan; status: "recoverable_failure" }
  | { message: string; plan: OcrSubmissionPlan; status: "handoff_required" };

const matchesOcrRunningUrl = "/matches?status=ocr_running&sort=updated_desc";

export function useOcrStartFlow({
  submission,
  updateSlot,
}: {
  submission: OcrCaptureMutations;
  updateSlot: (slot: CaptureSlotState) => void;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<OcrStartDialogState>({ status: "closed" });
  const intentionalNavigationRef = useRef(false);
  const locked = state.status === "submitting";
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      locked &&
      !intentionalNavigationRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!locked) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [locked],
    ),
  );

  useEffect(() => {
    if (!locked && blocker.state === "blocked") {
      blocker.reset();
    }
  }, [blocker, locked]);

  async function submitPlan(plan: OcrSubmissionPlan) {
    intentionalNavigationRef.current = false;
    setState({ plan, progress: null, status: "submitting" });

    let result: OcrSubmissionResult | undefined;
    try {
      result = await submission.submit({
        onProgress: (progress) => {
          setState((current) =>
            current.status === "submitting" ? { ...current, progress } : current,
          );
        },
        selectedGameTitle: plan.selectedGameTitle,
        setup: plan.setup,
        slots: plan.slots,
        updateSlot,
      });
    } catch (error) {
      setState({
        message: formatApiError(error, "読み取りの準備中に問題が発生しました"),
        plan,
        status: "recoverable_failure",
      });
      return;
    }

    if (!result) return;
    handleResult(plan, result);
  }

  function handleResult(plan: OcrSubmissionPlan, result: OcrSubmissionResult) {
    if (result.status === "started") {
      intentionalNavigationRef.current = true;
      if (blocker.state === "blocked") {
        blocker.reset();
      }
      setState({ status: "closed" });
      showToast({
        title: `${result.createdJobCount}件の読み取りを開始しました。`,
        tone: "success",
      });
      navigate(matchesOcrRunningUrl, { replace: true });
      return;
    }
    if (result.status === "partial_started") {
      setState({
        createdJobCount: result.createdJobCount,
        failedJobCount: result.failedJobCount,
        plan,
        status: "partial_result",
      });
      return;
    }
    if (result.status === "failed_cleanup_failed") {
      setState({
        message: formatApiError(
          result.cleanupError,
          "確定前の記録を取り消せませんでした。重複操作を避け、試合一覧で状態を確認してください",
        ),
        plan,
        status: "handoff_required",
      });
      return;
    }

    const message =
      result.status === "draft_create_failed"
        ? formatApiError(result.error, "確定前の記録を作成できませんでした")
        : result.status === "invalid"
          ? result.message
          : result.status === "empty"
            ? "読み取る画像がありません。画像を確認してから、もう一度お試しください。"
            : "画像を送信できませんでした。確定前の記録は取り消しました。";
    setState({ message, plan, status: "recoverable_failure" });
  }

  async function confirm() {
    if (state.status !== "confirming" && state.status !== "recoverable_failure") return;
    await submitPlan(state.plan);
  }

  function close() {
    if (state.status === "confirming" || state.status === "recoverable_failure") {
      setState({ status: "closed" });
    }
  }

  function viewMatches() {
    intentionalNavigationRef.current = true;
    if (blocker.state === "blocked") {
      blocker.reset();
    }
    setState({ status: "closed" });
    navigate(matchesOcrRunningUrl, { replace: true });
  }

  return {
    close,
    confirm,
    locked,
    open: (plan: OcrSubmissionPlan) => setState({ plan, status: "confirming" }),
    state,
    viewMatches,
  };
}

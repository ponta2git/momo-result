import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useBeforeUnload, useBlocker, useNavigate } from "react-router-dom";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import type { OcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import type {
  OcrSubmissionProgress,
  OcrSubmissionResult,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { OcrCaptureMutations } from "@/features/ocrCapture/useOcrCaptureMutations";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { showToast } from "@/shared/ui/feedback/Toast";

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
  | { canEdit: boolean; message: string; plan: OcrSubmissionPlan; status: "recoverable_failure" };

const incompleteMatchesUrl = "/matches?status=incomplete&sort=updated_desc";

function ocrResultDestination(plan: OcrSubmissionPlan): string {
  return plan.setup.heldEventId
    ? `/held-events/${encodeURIComponent(plan.setup.heldEventId)}`
    : incompleteMatchesUrl;
}

export function useOcrStartFlow({
  submission,
  updateSlot,
}: {
  submission: OcrCaptureMutations;
  updateSlot: (slot: CaptureSlotState) => void;
}) {
  const navigate = useNavigate();
  const [isNavigating, startNavigation] = useTransition();
  const [state, setState] = useState<OcrStartDialogState>({ status: "closed" });
  const intentionalNavigationRef = useRef(false);
  const locked = state.status === "submitting" || isNavigating;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      locked &&
      !intentionalNavigationRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!locked || intentionalNavigationRef.current) return;
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

  async function submitPlan(plan: OcrSubmissionPlan, noUncertainAcceptance: boolean) {
    intentionalNavigationRef.current = false;
    setState({ plan, progress: null, status: "submitting" });

    let result: OcrSubmissionResult | undefined;
    try {
      result = await submission.submit({
        plan,
        onProgress: (progress) => {
          setState((current) =>
            current.status === "submitting" ? { ...current, progress } : current,
          );
        },
        updateSlot,
      });
    } catch (error) {
      setState({
        canEdit: false,
        message: formatApiError(error, "読み取りの準備中に問題が発生しました"),
        plan,
        status: "recoverable_failure",
      });
      return;
    }

    if (!result) return;
    handleResult(plan, result, noUncertainAcceptance);
  }

  function handleResult(
    plan: OcrSubmissionPlan,
    result: OcrSubmissionResult,
    noUncertainAcceptance: boolean,
  ) {
    if (result.status === "started") {
      showToast({
        title: `${result.createdJobCount}件の読み取りを開始しました。`,
        tone: "success",
      });
      navigateToResult(ocrResultDestination(plan));
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

    const message =
      result.status === "draft_create_failed"
        ? formatApiError(result.error, "確定前の記録を作成できませんでした")
        : result.status === "invalid"
          ? result.message
          : result.status === "empty"
            ? "読み取る画像がありません。画像を確認してから、もう一度お試しください。"
            : "送信の完了を確認できませんでした。同じ内容で再試行すると、受け付け済みの処理から再開します。";
    const canEdit =
      noUncertainAcceptance &&
      (result.status === "invalid" ||
        result.status === "empty" ||
        (result.status === "draft_create_failed" && isDefinitiveRejection(result.error)));
    setState({ canEdit, message, plan, status: "recoverable_failure" });
  }

  async function confirm() {
    if (
      state.status !== "confirming" &&
      state.status !== "recoverable_failure" &&
      state.status !== "partial_result"
    )
      return;
    // A later rejected retry cannot disprove that an earlier request was accepted.
    await submitPlan(
      state.plan,
      state.status === "confirming" || (state.status === "recoverable_failure" && state.canEdit),
    );
  }

  function close() {
    if (
      state.status === "confirming" ||
      (state.status === "recoverable_failure" && state.canEdit)
    ) {
      setState({ status: "closed" });
    }
  }

  function navigateToResult(destination: string) {
    if (isNavigating) return;
    intentionalNavigationRef.current = true;
    if (blocker.state === "blocked") {
      blocker.reset();
    }
    startNavigation(async () => {
      setState({ status: "closed" });
      await navigate(destination, { replace: true });
    });
  }

  function viewMatches() {
    navigateToResult("plan" in state ? ocrResultDestination(state.plan) : incompleteMatchesUrl);
  }

  return {
    close,
    confirm,
    locked,
    isNavigating,
    open: (plan: OcrSubmissionPlan) => setState({ plan, status: "confirming" }),
    state,
    viewMatches,
  };
}

function isDefinitiveRejection(error: unknown): boolean {
  const { status } = normalizeUnknownApiError(error);
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

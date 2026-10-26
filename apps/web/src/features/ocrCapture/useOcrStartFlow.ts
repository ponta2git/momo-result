import { useCallback, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useNavigate } from "react-router-dom";

import {
  buildOcrStartDialogView,
  resolveOcrStartResult,
} from "@/features/ocrCapture/ocrStartState";
import type { OcrStartState } from "@/features/ocrCapture/ocrStartState";
import type { OcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import type {
  OcrSlotReceipt,
  OcrSubmissionResult,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import type { OcrSubmission } from "@/features/ocrCapture/useOcrSubmission";
import { formatApiError } from "@/shared/api/problemDetails";
import { showToast } from "@/shared/ui/feedback/Toast";

const draftsUrl = "/drafts";

function ocrResultDestination(plan: OcrSubmissionPlan): string {
  return plan.setup.heldEventId
    ? `/held-events/${encodeURIComponent(plan.setup.heldEventId)}`
    : draftsUrl;
}

export function useOcrStartFlow({
  submission,
  onSlotReceipt,
}: {
  submission: OcrSubmission;
  onSlotReceipt: (receipt: OcrSlotReceipt) => void;
}) {
  const navigate = useNavigate();
  const [isNavigating, startNavigation] = useTransition();
  const [state, setState] = useState<OcrStartState>({ status: "closed" });
  const intentionalNavigationRef = useRef(false);
  const activeRef = useRef(true);
  const locked = state.status === "submitting" || isNavigating;
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const navigateToResult = useCallback(
    (destination: string) => {
      if (isNavigating) return;
      intentionalNavigationRef.current = true;
      startNavigation(async () => {
        setState({ status: "closed" });
        await navigate(destination, { replace: true });
      });
    },
    [isNavigating, navigate, startNavigation],
  );

  const handleResult = useCallback(
    (plan: OcrSubmissionPlan, result: OcrSubmissionResult, noUncertainAcceptance: boolean) => {
      const next = resolveOcrStartResult(plan, result, noUncertainAcceptance);
      if (next.kind === "started") {
        showToast({
          title: `${next.createdJobCount}件の読み取りを開始しました。`,
          tone: "success",
        });
        navigateToResult(ocrResultDestination(plan));
        return;
      }
      setState(next.state);
    },
    [navigateToResult],
  );
  const submit = submission.submit;
  const submitPlan = useCallback(
    async (plan: OcrSubmissionPlan, noUncertainAcceptance: boolean, restart = false) => {
      intentionalNavigationRef.current = false;
      setState({ plan, progress: null, status: "submitting" });

      let result: OcrSubmissionResult | undefined;
      try {
        result = await submit({
          plan,
          restart,
          onProgress: (progress) => {
            if (!activeRef.current) return;
            setState((current) =>
              current.status === "submitting" ? { ...current, progress } : current,
            );
          },
          onSlotReceipt: (receipt) => {
            if (activeRef.current) onSlotReceipt(receipt);
          },
        });
      } catch (error) {
        if (!activeRef.current) return;
        setState({
          canEdit: false,
          message: formatApiError(error, "読み取りの準備中に問題が発生しました"),
          plan,
          status: "recoverable_failure",
        });
        return;
      }

      if (!result || !activeRef.current) return;
      handleResult(plan, result, noUncertainAcceptance);
    },
    [submit, onSlotReceipt, handleResult],
  );

  const confirm = useCallback(async () => {
    if (
      state.status !== "confirming" &&
      state.status !== "recoverable_failure" &&
      state.status !== "partial_result" &&
      state.status !== "submission_closed"
    )
      return;
    // A later rejected retry cannot disprove that an earlier request was accepted.
    await submitPlan(
      state.plan,
      state.status === "confirming" || (state.status === "recoverable_failure" && state.canEdit),
      state.status === "submission_closed" && state.canRestart,
    );
  }, [state, submitPlan]);

  const close = useCallback(() => {
    if (
      state.status === "confirming" ||
      (state.status === "recoverable_failure" && state.canEdit)
    ) {
      setState({ status: "closed" });
    }
  }, [state]);

  const viewMatches = useCallback(() => {
    navigateToResult("plan" in state ? ocrResultDestination(state.plan) : draftsUrl);
  }, [state, navigateToResult]);
  const open = useCallback(
    (plan: OcrSubmissionPlan) => setState({ plan, status: "confirming" }),
    [],
  );
  const isNavigationAllowed = useCallback(() => intentionalNavigationRef.current, []);
  const dialog = useMemo(() => buildOcrStartDialogView(state), [state]);

  return {
    close,
    confirm,
    locked,
    isNavigationAllowed,
    isNavigating,
    open,
    dialog,
    viewMatches,
  };
}

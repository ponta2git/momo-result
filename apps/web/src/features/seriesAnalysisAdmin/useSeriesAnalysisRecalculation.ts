import { useEffect, useRef } from "react";

import { useAnalysisRecalculationSubmission } from "@/features/seriesAnalysisAdmin/analysisAdminQueryAdapter";
import { recalculationTargetForTitle } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
import type { AnalysisAdminTitle } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
import type { SeriesAnalysisRecalculationAccepted } from "@/shared/api/seriesAnalysis";
import type { AuthorizationLease, AuthorizationOperations } from "@/shared/auth/authorization";

export function useSeriesAnalysisRecalculation(authorization: AuthorizationOperations) {
  const activeCommand = useRef<AuthorizationLease | undefined>(undefined);
  const hasPendingCommand = () =>
    Boolean(activeCommand.current && authorization.isCurrent(activeCommand.current));
  const mounted = useRef(false);
  const handledAcceptance = useRef<SeriesAnalysisRecalculationAccepted | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submission = useAnalysisRecalculationSubmission({
    canSubmit: ({ lease }) => mounted.current && authorization.canCommit(lease),
    onFailure: (error, { lease }) => {
      if (mounted.current) authorization.reportError(error, lease);
    },
    onFinish: ({ lease }) => {
      if (activeCommand.current === lease) activeCommand.current = undefined;
    },
  });
  const { reconcileAcceptance } = submission;
  // A 202 received during an auth check remains a receipt; only its authorized owner reconciles it.
  useEffect(() => {
    const response = submission.accepted;
    const request = submission.submitted;
    if (
      !response ||
      !request ||
      handledAcceptance.current === response ||
      !authorization.canCommit(request.lease)
    )
      return;
    handledAcceptance.current = response;
    reconcileAcceptance();
  }, [authorization, submission.accepted, submission.submitted, reconcileAcceptance]);
  const current = submission.submitted
    ? authorization.isCurrent(submission.submitted.lease)
    : false;
  return {
    target: submission.submitted?.target,
    response: current ? submission.accepted : undefined,
    error: current ? submission.error : null,
    pending: current && submission.pending,
    clearFeedback: () => {
      if (!hasPendingCommand()) submission.clear();
    },
    recalculateAll: async (titleCount: number) => {
      if (hasPendingCommand() || !titleCount) return;
      const lease = authorization.begin("admin");
      if (!lease) return;
      activeCommand.current = lease;
      await submission.submitAndWait({ target: { kind: "all" }, lease });
    },
    recalculateTitle: (title: AnalysisAdminTitle | null) => {
      const target = recalculationTargetForTitle(title);
      if (hasPendingCommand() || !target) return;
      const lease = authorization.begin("operations");
      if (!lease) return;
      activeCommand.current = lease;
      submission.submit({ target, lease });
    },
  };
}

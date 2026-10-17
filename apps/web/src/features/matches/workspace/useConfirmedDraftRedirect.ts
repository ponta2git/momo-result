import { useCallback, useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import {
  confirmedDraftDestination,
  confirmedDraftMessages,
} from "@/features/matches/confirmedDraftNavigation";
import { useMatchDraftResource } from "@/features/matches/useMatchDraftResource";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/matchWorkspacePanelTypes";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";

export function useConfirmedDraftRedirect({
  notify,
  onBeforeRedirect,
}: {
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onBeforeRedirect?: () => void;
}) {
  const navigate = useNavigate();
  const { readLatest, confirmationRecorded, releaseReviewImages } = useMatchDraftResource();
  const redirectedConfirmedDraftRef = useRef<string | null>(null);
  const activeRef = useRef(true);
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const redirectConfirmedDraft = useCallback(
    (detail: MatchDraftDetailResponse | undefined, message: string): boolean => {
      if (!activeRef.current) return false;
      const destination = confirmedDraftDestination(detail);
      if (!destination) {
        return false;
      }
      if (redirectedConfirmedDraftRef.current === destination.matchId) {
        return true;
      }

      redirectedConfirmedDraftRef.current = destination.matchId;
      if (detail) releaseReviewImages(detail.matchDraftId);
      confirmationRecorded();
      notify(message, "warning");
      onBeforeRedirect?.();
      navigate(destination.path, { replace: true });
      return true;
    },
    [confirmationRecorded, navigate, notify, onBeforeRedirect, releaseReviewImages],
  );

  const handleConfirmConflict = useCallback(
    async (draftId: string): Promise<boolean> => {
      try {
        const detail = await readLatest(draftId);
        return redirectConfirmedDraft(detail, confirmedDraftMessages.confirmConflict);
      } catch {
        return false;
      }
    },
    [readLatest, redirectConfirmedDraft],
  );

  return {
    handleConfirmConflict,
    redirectConfirmedDraft,
  };
}

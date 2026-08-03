import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  confirmedDraftDestination,
  confirmedDraftMessages,
} from "@/features/matches/confirmedDraftNavigation";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";
import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { getMatchDraftDetail } from "@/shared/api/matchDrafts";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import { matchKeys } from "@/shared/api/queryKeys";

export function useConfirmedDraftRedirect({
  notify,
  onBeforeRedirect,
  setValidationMessage,
  useSampleDrafts,
}: {
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onBeforeRedirect?: () => void;
  setValidationMessage: (message: string) => void;
  useSampleDrafts: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmedDraftRedirecting, setConfirmedDraftRedirecting] = useState(false);
  const redirectedConfirmedDraftRef = useRef<string | null>(null);

  const fetchLatestDraftDetail = useCallback(
    (draftId: string) =>
      queryClient.fetchQuery({
        queryKey: matchKeys.draft.detail(draftId),
        queryFn: ({ signal }) => getMatchDraftDetail(draftId, { signal }),
        staleTime: 0,
      }),
    [queryClient],
  );

  const redirectConfirmedDraft = useCallback(
    (detail: MatchDraftDetailResponse | undefined, message: string): boolean => {
      const destination = confirmedDraftDestination(detail);
      if (!destination) {
        return false;
      }
      if (redirectedConfirmedDraftRef.current === destination.matchId) {
        return true;
      }

      redirectedConfirmedDraftRef.current = destination.matchId;
      setConfirmedDraftRedirecting(true);
      void invalidateAfterMatchConfirmed(queryClient);
      notify(message, "warning");
      onBeforeRedirect?.();
      navigate(destination.path, { replace: true });
      return true;
    },
    [navigate, notify, onBeforeRedirect, queryClient],
  );

  const handleConfirmConflict = useCallback(
    async (draftId: string): Promise<boolean> => {
      try {
        const detail = await fetchLatestDraftDetail(draftId);
        return redirectConfirmedDraft(detail, confirmedDraftMessages.confirmConflict);
      } catch {
        return false;
      }
    },
    [fetchLatestDraftDetail, redirectConfirmedDraft],
  );

  const ensureDraftIsOpenForConfirm = useCallback(
    async (draftId: string | undefined): Promise<boolean> => {
      if (!draftId || useSampleDrafts) {
        return true;
      }

      setValidationMessage("");
      try {
        const detail = await fetchLatestDraftDetail(draftId);
        return !redirectConfirmedDraft(detail, confirmedDraftMessages.confirmConflict);
      } catch {
        setValidationMessage(confirmedDraftMessages.statusCheckFailed);
        return false;
      }
    },
    [fetchLatestDraftDetail, redirectConfirmedDraft, setValidationMessage, useSampleDrafts],
  );

  return {
    confirmedDraftRedirecting,
    ensureDraftIsOpenForConfirm,
    handleConfirmConflict,
    redirectConfirmedDraft,
  };
}

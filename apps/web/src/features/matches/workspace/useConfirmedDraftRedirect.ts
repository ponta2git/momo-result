import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
import { evictDraftSourceImageBlobs } from "@/shared/api/sourceImageQueries";
import { withReturnTo } from "@/shared/navigation/returnTo";

export function useConfirmedDraftRedirect({
  notify,
  onBeforeRedirect,
  returnTo,
}: {
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onBeforeRedirect?: () => void;
  returnTo?: string | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmedDraftRedirecting, setConfirmedDraftRedirecting] = useState(false);
  const redirectedConfirmedDraftRef = useRef<string | null>(null);
  const activeRef = useRef(true);
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

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
      if (!activeRef.current) return false;
      const destination = confirmedDraftDestination(detail);
      if (!destination) {
        return false;
      }
      if (redirectedConfirmedDraftRef.current === destination.matchId) {
        return true;
      }

      redirectedConfirmedDraftRef.current = destination.matchId;
      if (detail) evictDraftSourceImageBlobs(queryClient, detail.matchDraftId);
      setConfirmedDraftRedirecting(true);
      void invalidateAfterMatchConfirmed(queryClient);
      notify(message, "warning");
      onBeforeRedirect?.();
      navigate(withReturnTo(destination.path, returnTo), { replace: true });
      return true;
    },
    [navigate, notify, onBeforeRedirect, queryClient, returnTo],
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

  return {
    confirmedDraftRedirecting,
    handleConfirmConflict,
    redirectConfirmedDraft,
  };
}

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  confirmedDraftDestination,
  confirmedDraftMessages,
} from "@/features/matches/confirmedDraftNavigation";
import type { MatchListAction } from "@/features/matches/list/matchListTypes";
import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { matchDraftDetailQueryOptions } from "@/shared/api/queryOptions";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { showToast } from "@/shared/ui/feedback/Toast";

export type ConfirmedDraftNavigationCommand = {
  checkingIds: ReadonlySet<string>;
  run: (action: MatchListAction) => Promise<void>;
};

/** Confirms a possibly stale draft destination before allowing row navigation. */
export function useConfirmedDraftNavigationCommand(
  listReturnTo: string,
): ConfirmedDraftNavigationCommand {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const checkingIdsRef = useRef(new Set<string>());
  const [checkingIds, setCheckingIds] = useState<ReadonlySet<string>>(() => new Set());

  const setChecking = (draftId: string, checking: boolean) => {
    const nextIds = new Set(checkingIdsRef.current);
    if (checking) nextIds.add(draftId);
    else nextIds.delete(draftId);
    checkingIdsRef.current = nextIds;
    setCheckingIds(nextIds);
  };

  const run = async (action: MatchListAction) => {
    const draftId = action.draftStatusCheck?.draftId;
    if (!draftId || !action.href || checkingIdsRef.current.has(draftId)) return;

    setChecking(draftId, true);
    try {
      const detail = await queryClient.fetchQuery({
        ...matchDraftDetailQueryOptions(draftId),
        staleTime: 0,
      });
      const destination = confirmedDraftDestination(detail);
      if (destination) {
        void invalidateAfterMatchConfirmed(queryClient);
        showToast({ title: confirmedDraftMessages.listRedirect, tone: "warning" });
        navigate(withReturnTo(destination.path, listReturnTo));
        return;
      }
      navigate(action.href);
    } catch {
      showToast({ title: confirmedDraftMessages.statusCheckFailed, tone: "warning" });
    } finally {
      setChecking(draftId, false);
    }
  };

  return { checkingIds, run };
}

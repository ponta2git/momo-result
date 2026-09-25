import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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
  errors: Readonly<Record<string, string>>;
  run: (action: MatchListAction) => Promise<void>;
};

type NavigationOwner = {
  active: boolean;
  checkingIds: Set<string>;
  latestIntent: number;
  scope: string;
};

function emptyPresentation(scope: string) {
  return { scope, checkingIds: new Set<string>(), errors: {} as Record<string, string> };
}

/** A read may finish after navigation; only the latest intent in its original route owns UI effects. */
export function useConfirmedDraftNavigationCommand(
  listReturnTo: string,
): ConfirmedDraftNavigationCommand {
  const navigate = useNavigate();
  const { key: scope } = useLocation();
  const queryClient = useQueryClient();
  const ownerRef = useRef<NavigationOwner | null>(null);
  const [presentation, setPresentation] = useState(() => emptyPresentation(scope));
  if (presentation.scope !== scope) setPresentation(emptyPresentation(scope));

  useEffect(() => {
    const owner: NavigationOwner = { active: true, checkingIds: new Set(), latestIntent: 0, scope };
    ownerRef.current = owner;
    return () => {
      // Do not cancel the shared cache request: another screen may be using its result.
      owner.active = false;
    };
  }, [scope]);

  const run = useCallback(
    async (action: MatchListAction) => {
      const draftId = action.draftStatusCheck?.draftId;
      const owner = ownerRef.current;
      if (
        !draftId ||
        !action.href ||
        action.disabled ||
        !owner?.active ||
        owner.scope !== scope ||
        owner.checkingIds.has(draftId)
      )
        return;

      const intent = ++owner.latestIntent;
      const ownsNavigation = () => owner.active && owner.latestIntent === intent;
      owner.checkingIds.add(draftId);
      setPresentation((current) => {
        const errors = { ...current.errors };
        delete errors[draftId];
        return { scope, errors, checkingIds: new Set(owner.checkingIds) };
      });
      try {
        const detail = await queryClient.fetchQuery({
          ...matchDraftDetailQueryOptions(draftId),
          staleTime: 0,
        });
        if (!ownsNavigation()) return;
        const destination = confirmedDraftDestination(detail);
        if (destination) {
          void invalidateAfterMatchConfirmed(queryClient);
          showToast({ title: confirmedDraftMessages.listRedirect, tone: "warning" });
          navigate(withReturnTo(destination.path, listReturnTo));
          return;
        }
        navigate(action.href);
      } catch {
        if (ownsNavigation()) {
          setPresentation((current) => ({
            ...current,
            errors: { ...current.errors, [draftId]: confirmedDraftMessages.statusCheckFailed },
          }));
        }
      } finally {
        owner.checkingIds.delete(draftId);
        if (owner.active) {
          setPresentation((current) => ({
            ...current,
            checkingIds: new Set(owner.checkingIds),
          }));
        }
      }
    },
    [listReturnTo, navigate, queryClient, scope],
  );

  return { checkingIds: presentation.checkingIds, errors: presentation.errors, run };
}

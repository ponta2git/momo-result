import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  confirmedDraftDestination,
  confirmedDraftMessages,
} from "@/features/matches/confirmedDraftNavigation";
import type { DraftAction } from "@/features/matches/drafts/draftsTypes";
import { useMatchDraftResource } from "@/features/matches/useMatchDraftResource";
import { showToast } from "@/shared/ui/feedback/Toast";

export type ConfirmedDraftNavigation = {
  checkingIds: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  run: (action: DraftAction) => Promise<void>;
};

type DraftNavigationOwner = {
  active: boolean;
  checkingIds: Set<string>;
  latestIntentId: number;
  scope: string;
};

function emptyNavigationFeedback(scope: string) {
  return { scope, checkingIds: new Set<string>(), errors: {} as Record<string, string> };
}

/** A read may finish after navigation; only the latest intent in its original route owns UI effects. */
export function useConfirmedDraftNavigation(): ConfirmedDraftNavigation {
  const navigate = useNavigate();
  const { key: scope } = useLocation();
  const { readLatest, confirmationRecorded } = useMatchDraftResource();
  const ownerRef = useRef<DraftNavigationOwner | null>(null);
  const [feedback, setFeedback] = useState(() => emptyNavigationFeedback(scope));
  if (feedback.scope !== scope) setFeedback(emptyNavigationFeedback(scope));

  useLayoutEffect(() => {
    const owner: DraftNavigationOwner = {
      active: true,
      checkingIds: new Set(),
      latestIntentId: 0,
      scope,
    };
    ownerRef.current = owner;
    return () => {
      // Do not cancel the shared cache request: another screen may be using its result.
      owner.active = false;
    };
  }, [scope]);

  const run = useCallback(
    async (action: DraftAction) => {
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

      const intentId = ++owner.latestIntentId;
      const ownsNavigation = () => owner.active && owner.latestIntentId === intentId;
      owner.checkingIds.add(draftId);
      setFeedback((current) => {
        const errors = { ...current.errors };
        delete errors[draftId];
        return { scope, errors, checkingIds: new Set(owner.checkingIds) };
      });
      try {
        const detail = await readLatest(draftId);
        if (!ownsNavigation()) return;
        const destination = confirmedDraftDestination(detail);
        if (destination) {
          confirmationRecorded();
          showToast({ title: confirmedDraftMessages.listRedirect, tone: "warning" });
          navigate(destination.path);
          return;
        }
        navigate(action.href);
      } catch {
        if (ownsNavigation()) {
          setFeedback((current) => ({
            ...current,
            errors: { ...current.errors, [draftId]: confirmedDraftMessages.statusCheckFailed },
          }));
        }
      } finally {
        owner.checkingIds.delete(draftId);
        if (owner.active) {
          setFeedback((current) => ({
            ...current,
            checkingIds: new Set(owner.checkingIds),
          }));
        }
      }
    },
    [confirmationRecorded, navigate, readLatest, scope],
  );

  return { checkingIds: feedback.checkingIds, errors: feedback.errors, run };
}

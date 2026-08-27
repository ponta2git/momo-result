import { useEffect } from "react";
import type { Dispatch } from "react";

import { confirmedDraftMessages } from "@/features/matches/confirmedDraftNavigation";
import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";

export function useMatchWorkspaceLifecycleEffects({
  dispatch,
  draftDetail,
  initialHeldEventPatch,
  mode,
  redirectConfirmedDraft,
  useSampleDrafts,
}: {
  dispatch: Dispatch<MatchFormAction>;
  draftDetail: MatchDraftDetailResponse | undefined;
  initialHeldEventPatch: Partial<MatchFormValues> | undefined;
  mode: WorkspaceMode;
  redirectConfirmedDraft: (
    detail: MatchDraftDetailResponse | undefined,
    message: string,
  ) => boolean;
  useSampleDrafts: boolean;
}) {
  useEffect(() => {
    if (mode === "edit" || useSampleDrafts) {
      return;
    }
    redirectConfirmedDraft(draftDetail, confirmedDraftMessages.loadRedirect);
  }, [draftDetail, mode, redirectConfirmedDraft, useSampleDrafts]);

  useEffect(() => {
    if (!initialHeldEventPatch) return;
    dispatch({
      patch: initialHeldEventPatch,
      type: "patch_root",
    });
  }, [dispatch, initialHeldEventPatch]);
}

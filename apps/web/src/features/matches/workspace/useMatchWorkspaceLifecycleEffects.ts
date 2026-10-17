import { useEffect } from "react";

import { confirmedDraftMessages } from "@/features/matches/confirmedDraftNavigation";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";

export function useMatchWorkspaceLifecycleEffects({
  draftDetail,
  mode,
  redirectConfirmedDraft,
  useSampleDrafts,
}: {
  draftDetail: MatchDraftDetailResponse | undefined;
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
}

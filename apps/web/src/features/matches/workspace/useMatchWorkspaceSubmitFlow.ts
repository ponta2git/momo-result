import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { useConfirmedDraftRedirect } from "@/features/matches/workspace/useConfirmedDraftRedirect";
import { useMatchWorkspaceConfirmAction } from "@/features/matches/workspace/useMatchWorkspaceConfirmAction";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";

export function useMatchWorkspaceSubmitFlow({
  matchId,
  notify,
  onPersistedSuccess,
  setConfirmOpen,
  setValidationMessage,
  useSampleDrafts,
  values,
}: {
  matchId: string | undefined;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onPersistedSuccess: () => void;
  setConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setValidationMessage: Dispatch<SetStateAction<string>>;
  useSampleDrafts: boolean;
  values: MatchFormValues;
}) {
  const confirmedDraft = useConfirmedDraftRedirect({
    notify,
    onBeforeRedirect: onPersistedSuccess,
    setValidationMessage,
    useSampleDrafts,
  });
  const mutations = useMatchWorkspaceMutations({
    matchId,
    onConfirmConflict: confirmedDraft.handleConfirmConflict,
    onConfirmSuccess: () => setConfirmOpen(false),
    onError: setValidationMessage,
    onPersistedSuccess,
  });
  const confirmAction = useMatchWorkspaceConfirmAction({
    confirmMutation: mutations.confirmMutation,
    ensureDraftIsOpenForConfirm: confirmedDraft.ensureDraftIsOpenForConfirm,
    values,
  });
  const { cancelDraftMutation } = mutations;
  const cancelDraftConfirmed = useCallback(async () => {
    if (!values.matchDraftId) {
      return;
    }
    setValidationMessage("");
    await cancelDraftMutation.mutateAsync(values.matchDraftId);
  }, [cancelDraftMutation, setValidationMessage, values.matchDraftId]);

  return { cancelDraftConfirmed, confirmAction, confirmedDraft, mutations };
}

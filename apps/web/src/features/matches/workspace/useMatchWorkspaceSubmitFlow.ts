import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { useConfirmedDraftRedirect } from "@/features/matches/workspace/useConfirmedDraftRedirect";
import { useMatchWorkspaceConfirmAction } from "@/features/matches/workspace/useMatchWorkspaceConfirmAction";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import type { WorkspaceNoticeTone } from "@/features/matches/workspace/useWorkspaceNotice";

export function useMatchWorkspaceSubmitFlow({
  matchId,
  mode,
  notify,
  onPersistedSuccess,
  setConfirmOpen,
  setValidationMessage,
  returnTo,
  useSampleDrafts,
  values,
}: {
  matchId: string | undefined;
  mode: WorkspaceMode;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  onPersistedSuccess: () => void;
  setConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setValidationMessage: Dispatch<SetStateAction<string>>;
  returnTo?: string | undefined;
  useSampleDrafts: boolean;
  values: MatchFormValues;
}) {
  const confirmedDraft = useConfirmedDraftRedirect({
    notify,
    onBeforeRedirect: onPersistedSuccess,
    setValidationMessage,
    returnTo,
    useSampleDrafts,
  });
  const mutations = useMatchWorkspaceMutations({
    heldEventId: values.heldEventId,
    matchId,
    mode,
    onConfirmConflict: confirmedDraft.handleConfirmConflict,
    onConfirmSuccess: () => setConfirmOpen(false),
    onError: setValidationMessage,
    onPersistedSuccess,
    returnTo,
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

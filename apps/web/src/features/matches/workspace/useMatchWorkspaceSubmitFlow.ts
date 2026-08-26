import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchWorkspaceOperationError,
  MatchWorkspaceOperationErrorKind,
} from "@/features/matches/workspace/matchWorkspaceOperationError";
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
  setOperationError,
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
  setOperationError: Dispatch<SetStateAction<MatchWorkspaceOperationError | null>>;
  setValidationMessage: Dispatch<SetStateAction<string>>;
  returnTo?: string | undefined;
  useSampleDrafts: boolean;
  values: MatchFormValues;
}) {
  const confirmedDraft = useConfirmedDraftRedirect({
    notify,
    onBeforeRedirect: onPersistedSuccess,
    onStatusCheckError: (message) => {
      setConfirmOpen(false);
      setOperationError({ kind: "draftStatus", message });
    },
    onStatusCheckStart: () => setOperationError(null),
    returnTo,
    useSampleDrafts,
  });
  const mutations = useMatchWorkspaceMutations({
    heldEventId: values.heldEventId,
    matchId,
    mode,
    onConfirmConflict: confirmedDraft.handleConfirmConflict,
    onConfirmSuccess: () => setConfirmOpen(false),
    onError: (kind, message) => {
      if (kind === "confirm") setConfirmOpen(false);
      setOperationError({ kind, message });
    },
    onOperationStart: (_kind: MatchWorkspaceOperationErrorKind) => setOperationError(null),
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
    setOperationError(null);
    setValidationMessage("");
    await cancelDraftMutation.mutateAsync(values.matchDraftId).catch(() => undefined);
  }, [cancelDraftMutation, setOperationError, setValidationMessage, values.matchDraftId]);

  return { cancelDraftConfirmed, confirmAction, confirmedDraft, mutations };
}

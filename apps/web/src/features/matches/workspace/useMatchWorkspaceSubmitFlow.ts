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
  const handleStatusCheckError = useCallback(
    (message: string) => {
      setConfirmOpen(false);
      setOperationError({ kind: "draftStatus", message });
    },
    [setConfirmOpen, setOperationError],
  );
  const handleOperationStart = useCallback(() => setOperationError(null), [setOperationError]);
  const confirmedDraft = useConfirmedDraftRedirect({
    notify,
    onBeforeRedirect: onPersistedSuccess,
    onStatusCheckError: handleStatusCheckError,
    onStatusCheckStart: handleOperationStart,
    returnTo,
    useSampleDrafts,
  });
  const handleConfirmSuccess = useCallback(() => setConfirmOpen(false), [setConfirmOpen]);
  const handleMutationError = useCallback(
    (kind: MatchWorkspaceOperationErrorKind, message: string) => {
      if (kind === "confirm") setConfirmOpen(false);
      setOperationError({ kind, message });
    },
    [setConfirmOpen, setOperationError],
  );
  const mutations = useMatchWorkspaceMutations({
    heldEventId: values.heldEventId,
    matchId,
    mode,
    onConfirmConflict: confirmedDraft.handleConfirmConflict,
    onConfirmSuccess: handleConfirmSuccess,
    onError: handleMutationError,
    onOperationStart: handleOperationStart,
    onPersistedSuccess,
    returnTo,
  });
  const confirmAction = useMatchWorkspaceConfirmAction({
    confirmMutation: mutations.confirmMutation,
    ensureDraftIsOpenForConfirm: confirmedDraft.ensureDraftIsOpenForConfirm,
    values,
  });
  const { cancelDraftMutation } = mutations;
  const cancelDraft = cancelDraftMutation.mutateAsync;
  const cancelDraftConfirmed = useCallback(async () => {
    if (!values.matchDraftId) {
      return;
    }
    setOperationError(null);
    setValidationMessage("");
    await cancelDraft(values.matchDraftId).catch(() => undefined);
  }, [cancelDraft, setOperationError, setValidationMessage, values.matchDraftId]);

  return { cancelDraftConfirmed, confirmAction, confirmedDraft, mutations };
}

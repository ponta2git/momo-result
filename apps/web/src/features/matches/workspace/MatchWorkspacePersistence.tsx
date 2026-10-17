import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Location } from "react-router-dom";

import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceEditingStore } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type {
  MatchWorkspaceCancellationModel,
  MatchWorkspaceMastersNavigationModel,
  MatchWorkspaceRecoveryModel,
  MatchWorkspaceSubmitModel,
  WorkspaceNoticeTone,
} from "@/features/matches/workspace/matchWorkspacePanelTypes";
import { workspaceSubmissionView } from "@/features/matches/workspace/matchWorkspaceView";
import type { buildMatchWorkspaceView } from "@/features/matches/workspace/matchWorkspaceView";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspaceMasterNavigation } from "@/features/matches/workspace/useMatchWorkspaceMasterNavigation";
import { useMatchWorkspacePersistenceUi } from "@/features/matches/workspace/useMatchWorkspacePersistenceUi";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceSessionDraft } from "@/features/matches/workspace/useMatchWorkspaceSessionDraft";
import { useMatchWorkspaceSubmitFlow } from "@/features/matches/workspace/useMatchWorkspaceSubmitFlow";
import { useMatchWorkspaceValidation } from "@/features/matches/workspace/useMatchWorkspaceValidation";
import { useWorkspaceReadView } from "@/features/matches/workspace/useWorkspaceReadView";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";

export type MatchWorkspacePersistenceInput = {
  accountId: string | undefined;
  canManageMasters: boolean;
  canNavigateToMasters: () => boolean;
  createEventPending: boolean;
  draftDetail: MatchDraftDetailResponse | undefined;
  editing: MatchWorkspaceEditingStore;
  enabled: boolean;
  matchId: string | undefined;
  mode: WorkspaceMode;
  notify: (message: string, tone?: WorkspaceNoticeTone) => void;
  notifyToast: (message: string, tone?: WorkspaceNoticeTone) => void;
  useSampleDrafts: boolean;
  view: ReturnType<typeof buildMatchWorkspaceView>;
  workspaceKey: string;
  workspaceLoading: boolean;
};

type WorkspacePersistenceControls = {
  persistence: {
    cancellation: MatchWorkspaceCancellationModel;
    recovery: MatchWorkspaceRecoveryModel | null;
    submit: MatchWorkspaceSubmitModel;
  };
  masters: MatchWorkspaceMastersNavigationModel;
};
type WorkspaceInteraction = {
  disabled: boolean;
  errorPathSet: ReadonlySet<string>;
  validationFocusRequest: { path: string; sequence: number } | null;
};
const ControlsContext = createContext<WorkspacePersistenceControls | null>(null);
const InteractionContext = createContext<WorkspaceInteraction | null>(null);
export function useWorkspacePersistenceControls() {
  const value = useContext(ControlsContext);
  if (!value) throw new Error("Workspace persistence is unavailable");
  return value;
}
export function useWorkspaceInteraction() {
  const value = useContext(InteractionContext);
  if (!value) throw new Error("Workspace interaction is unavailable");
  return value;
}

/** IO/guard lifecycle subscribes here, independently of the page and editor panels. */
export function MatchWorkspacePersistence({
  input,
  preservesInput,
  children,
}: {
  input: MatchWorkspacePersistenceInput;
  preservesInput: (current: Location, next: Location) => boolean;
  children: ReactNode;
}) {
  const { editing, mode, view } = input;
  const {
    cancelDraftConfirmOpen,
    confirmOpen,
    operationError: currentOperationError,
    setCancelDraftConfirmOpen,
    setConfirmOpen,
    setOperationError,
    setShowValidationErrors,
    setValidationFocusRequest,
    setValidationMessage,
    showValidationErrors,
    validationFocusRequest,
    validationMessage,
  } = useMatchWorkspacePersistenceUi();
  const notify = input.notify;
  const draft = useWorkspaceReadView(editing.persistence);
  const confirmation = useWorkspaceReadView(editing.confirmation);
  const restore = useCallback(
    (saved: Parameters<typeof editing.restore>[0]) => {
      editing.restore(saved);
      notify("一時保存した入力内容とOCR確認状況を復元しました。", "success");
    },
    [editing, notify],
  );
  const session = useMatchWorkspaceSessionDraft({
    accountId: input.accountId,
    ...draft,
    enabled: input.enabled && !view.confirmedDraftLoaded,
    mode,
    onRestore: restore,
    readCurrentDraft: editing.persistence.getSnapshot,
    workspaceKey: input.workspaceKey,
  });
  const submit = useMatchWorkspaceSubmitFlow({
    matchId: input.matchId,
    notify: input.notifyToast,
    onPersistedSuccess: session.markCommitted,
    setConfirmOpen: setConfirmOpen,
    setOperationError: setOperationError,
    setValidationMessage: setValidationMessage,
    values: editing.resourceSelection.getSnapshot(),
    readLatestValues: editing.readLatestValues,
  });
  useMatchWorkspaceLifecycleEffects({
    draftDetail: input.draftDetail,
    mode,
    redirectConfirmedDraft: submit.confirmedDraft.redirectConfirmedDraft,
    useSampleDrafts: input.useSampleDrafts,
  });
  const masterNavigation = useMatchWorkspaceMasterNavigation({
    canManageMasters: input.canManageMasters,
    canNavigateToMasters: input.canNavigateToMasters,
    mode,
    notify: input.notify,
    saveBeforeNavigate: session.saveBeforeNavigate,
  });
  const requestValidationFocus = useCallback(
    (path: string) =>
      setValidationFocusRequest((current) => ({
        path,
        sequence: (current?.sequence ?? 0) + 1,
      })),
    [setValidationFocusRequest],
  );
  const onPrimaryAction = useMatchWorkspacePrimaryAction({
    mode,
    onValidationFailure: requestValidationFocus,
    setConfirmOpen: setConfirmOpen,
    setShowValidationErrors: setShowValidationErrors,
    setValidationMessage: setValidationMessage,
    update: submit.mutations.updateMutation.mutate,
    readLatestValues: editing.readLatestValues,
  });
  const validation = useMatchWorkspaceValidation({
    mode,
    showValidationErrors: showValidationErrors,
    values: draft.values,
  });
  // Keep display subscribers stable when validation returns the same set of paths.
  const errorPathsKey = JSON.stringify([...validation.visibleErrorPathSet].toSorted());
  const errorPathSet = useMemo(
    () => new Set<string>(JSON.parse(errorPathsKey) as string[]),
    [errorPathsKey],
  );
  const busy =
    submit.mutations.isMutating || submit.confirmation.pending || masterNavigation.isPending;
  const operationError = useMemo(
    () =>
      currentOperationError ? toMatchWorkspaceOperationErrorView(currentOperationError) : null,
    [currentOperationError],
  );
  const submissionView = useMemo(
    () =>
      workspaceSubmissionView({
        mode,
        busy,
        createEventPending: input.createEventPending,
        workspaceLoading: input.workspaceLoading,
        confirmOpen,
        cancelDraftConfirmOpen,
        operationError: currentOperationError,
        validationMessage,
        valid: validation.validation.success,
        firstValidationMessage: validation.validation.firstMessage,
      }),
    [
      mode,
      busy,
      input.createEventPending,
      input.workspaceLoading,
      confirmOpen,
      cancelDraftConfirmOpen,
      currentOperationError,
      validationMessage,
      validation.validation.success,
      validation.validation.firstMessage,
    ],
  );
  const interaction = useMemo(
    () => ({ disabled: busy, errorPathSet, validationFocusRequest: validationFocusRequest }),
    [busy, errorPathSet, validationFocusRequest],
  );
  const controls = useMemo<WorkspacePersistenceControls>(
    () => ({
      masters: {
        pending: masterNavigation.isPending,
        show: masterNavigation.available,
        onNavigate: masterNavigation.navigateToMasters,
      },
      persistence: {
        cancellation: {
          allowed: view.canCancelDraft,
          dialog: {
            open: cancelDraftConfirmOpen,
            pending: submit.mutations.cancelDraftMutation.isPending,
            onConfirm: submit.cancelDraftConfirmed,
            onOpenChange: setCancelDraftConfirmOpen,
          },
          disabled: busy || input.createEventPending,
          error: currentOperationError?.kind === "cancelDraft" ? operationError : null,
          onTrigger: () => setCancelDraftConfirmOpen(true),
        },
        recovery: session.recovery
          ? {
              savedAt: session.recovery.savedAt,
              onDiscard: session.discardRecovery,
              onRestore: session.restoreRecovery,
            }
          : null,
        submit: {
          action: { label: submissionView.label, onRun: onPrimaryAction },
          availability: submissionView.availability,
          feedback: submissionView.feedback,
        },
      },
    }),
    [
      masterNavigation.isPending,
      masterNavigation.available,
      masterNavigation.navigateToMasters,
      view.canCancelDraft,
      cancelDraftConfirmOpen,
      setCancelDraftConfirmOpen,
      submit.mutations.cancelDraftMutation.isPending,
      submit.cancelDraftConfirmed,
      busy,
      input.createEventPending,
      currentOperationError?.kind,
      operationError,
      session.recovery,
      session.discardRecovery,
      session.restoreRecovery,
      onPrimaryAction,
      submissionView,
    ],
  );
  return (
    <InteractionContext value={interaction}>
      <ControlsContext value={controls}>{children}</ControlsContext>
      {confirmOpen ? (
        <MatchConfirmDialog
          model={{
            actions: {
              onClose: () => setConfirmOpen(false),
              onConfirm: submit.confirmation.action,
            },
            feedback: { validationMessage: validationMessage },
            pending: submit.confirmation.pending,
            review: {
              changedCount: confirmation.changedCount,
              totalCount: confirmation.totalCount,
              unresolvedCount: confirmation.unresolvedCount,
            },
            summary: {
              gameTitleName: view.selectedGameTitle?.name,
              heldEvent: view.selectedHeldEvent,
              mapName: view.selectedMap?.name,
              seasonName: view.selectedSeason?.name,
            },
            values: confirmation,
          }}
        />
      ) : null}
      <UnsavedChangesGuard
        model={{
          dirty: session.dirty,
          isNavigationAllowed: session.isNavigationAllowed,
          onDiscard: session.markCommitted,
          saveBeforeLeave: session.saveBeforeLeave,
        }}
        pending={busy || input.createEventPending}
        preservesInput={preservesInput}
      />
    </InteractionContext>
  );
}

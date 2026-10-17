import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Location } from "react-router-dom";

import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceEditingStore } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type {
  MatchWorkspaceCancellationView,
  MatchWorkspaceMastersNavigationView,
  MatchWorkspaceRecoveryView,
  MatchWorkspaceSubmitView,
  WorkspaceNoticeTone,
} from "@/features/matches/workspace/matchWorkspacePanelViews";
import { buildMatchWorkspaceSubmitView } from "@/features/matches/workspace/matchWorkspaceView";
import type { buildMatchWorkspaceView } from "@/features/matches/workspace/matchWorkspaceView";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspaceMasterNavigation } from "@/features/matches/workspace/useMatchWorkspaceMasterNavigation";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceSessionDraft } from "@/features/matches/workspace/useMatchWorkspaceSessionDraft";
import { useMatchWorkspaceSubmitFlow } from "@/features/matches/workspace/useMatchWorkspaceSubmitFlow";
import { useMatchWorkspaceValidation } from "@/features/matches/workspace/useMatchWorkspaceValidation";
import { useWorkspaceSnapshot } from "@/features/matches/workspace/useWorkspaceSnapshot";
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
    cancellation: MatchWorkspaceCancellationView;
    recovery: MatchWorkspaceRecoveryView | null;
    submit: MatchWorkspaceSubmitView;
  };
  masters: MatchWorkspaceMastersNavigationView;
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
  const [validationMessage, setValidationMessage] = useState("");
  const [operationError, setOperationError] = useState<MatchWorkspaceOperationError | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [validationFocusRequest, setValidationFocusRequest] = useState<{
    path: string;
    sequence: number;
  } | null>(null);
  const notify = input.notify;
  const editingSnapshot = useWorkspaceSnapshot(editing.persistence);
  const confirmationSnapshot = useWorkspaceSnapshot(editing.confirmation);
  const restore = useCallback(
    (saved: Parameters<typeof editing.restore>[0]) => {
      editing.restore(saved);
      notify("一時保存した入力内容とOCR確認状況を復元しました。", "success");
    },
    [editing, notify],
  );
  const sessionDraft = useMatchWorkspaceSessionDraft({
    accountId: input.accountId,
    ...editingSnapshot,
    enabled: input.enabled && !view.confirmedDraftLoaded,
    mode,
    onRestore: restore,
    readCurrentDraft: editing.persistence.getSnapshot,
    workspaceKey: input.workspaceKey,
  });
  const submitFlow = useMatchWorkspaceSubmitFlow({
    matchId: input.matchId,
    notify: input.notifyToast,
    onPersistedSuccess: sessionDraft.markCommitted,
    setConfirmOpen: setConfirmOpen,
    setOperationError: setOperationError,
    setValidationMessage: setValidationMessage,
    values: editing.resourceSelection.getSnapshot(),
    readLatestValues: editing.readLatestValues,
  });
  useMatchWorkspaceLifecycleEffects({
    draftDetail: input.draftDetail,
    mode,
    redirectConfirmedDraft: submitFlow.confirmedDraft.redirectConfirmedDraft,
    useSampleDrafts: input.useSampleDrafts,
  });
  const masterNavigation = useMatchWorkspaceMasterNavigation({
    canManageMasters: input.canManageMasters,
    canNavigateToMasters: input.canNavigateToMasters,
    mode,
    notify: input.notify,
    saveBeforeNavigate: sessionDraft.saveBeforeNavigate,
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
    saveChanges: submitFlow.saveChanges,
    readLatestValues: editing.readLatestValues,
  });
  const validation = useMatchWorkspaceValidation({
    mode,
    showValidationErrors: showValidationErrors,
    values: editingSnapshot.values,
  });
  // Keep display subscribers stable when validation returns the same set of paths.
  const errorPathsKey = JSON.stringify([...validation.visibleErrorPathSet].toSorted());
  const errorPathSet = useMemo(
    () => new Set<string>(JSON.parse(errorPathsKey) as string[]),
    [errorPathsKey],
  );
  const busy = submitFlow.pending || submitFlow.confirmation.pending || masterNavigation.isPending;
  const operationErrorView = useMemo(
    () => (operationError ? toMatchWorkspaceOperationErrorView(operationError) : null),
    [operationError],
  );
  const submissionView = useMemo(
    () =>
      buildMatchWorkspaceSubmitView({
        mode,
        busy,
        createEventPending: input.createEventPending,
        workspaceLoading: input.workspaceLoading,
        confirmOpen,
        cancelDraftConfirmOpen,
        operationError,
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
      operationError,
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
            pending: submitFlow.cancelDraftPending,
            onConfirm: submitFlow.cancelDraftConfirmed,
            onOpenChange: setCancelDraftConfirmOpen,
          },
          disabled: busy || input.createEventPending,
          error: operationError?.kind === "cancelDraft" ? operationErrorView : null,
          onTrigger: () => setCancelDraftConfirmOpen(true),
        },
        recovery: sessionDraft.recovery
          ? {
              savedAt: sessionDraft.recovery.savedAt,
              onDiscard: sessionDraft.discardRecovery,
              onRestore: sessionDraft.restoreRecovery,
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
      submitFlow.cancelDraftPending,
      submitFlow.cancelDraftConfirmed,
      busy,
      input.createEventPending,
      operationError?.kind,
      operationErrorView,
      sessionDraft.recovery,
      sessionDraft.discardRecovery,
      sessionDraft.restoreRecovery,
      onPrimaryAction,
      submissionView,
    ],
  );
  return (
    <InteractionContext value={interaction}>
      <ControlsContext value={controls}>{children}</ControlsContext>
      {confirmOpen ? (
        <MatchConfirmDialog
          view={{
            actions: {
              onClose: () => setConfirmOpen(false),
              onConfirm: submitFlow.confirmation.action,
            },
            feedback: { validationMessage: validationMessage },
            pending: submitFlow.confirmation.pending,
            review: {
              changedCount: confirmationSnapshot.changedCount,
              totalCount: confirmationSnapshot.totalCount,
              unresolvedCount: confirmationSnapshot.unresolvedCount,
            },
            summary: {
              gameTitleName: view.selectedGameTitle?.name,
              heldEvent: view.selectedHeldEvent,
              mapName: view.selectedMap?.name,
              seasonName: view.selectedSeason?.name,
            },
            values: confirmationSnapshot,
          }}
        />
      ) : null}
      <UnsavedChangesGuard
        model={{
          dirty: sessionDraft.dirty,
          isNavigationAllowed: sessionDraft.isNavigationAllowed,
          onDiscard: sessionDraft.markCommitted,
          saveBeforeLeave: sessionDraft.saveBeforeLeave,
        }}
        pending={busy || input.createEventPending}
        preservesInput={preservesInput}
      />
    </InteractionContext>
  );
}

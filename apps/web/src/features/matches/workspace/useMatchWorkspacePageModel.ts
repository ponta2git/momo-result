import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { matchSetupValues } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspacePageModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import {
  buildMatchWorkspaceView,
  isMatchWorkspaceLoading,
} from "@/features/matches/workspace/matchWorkspaceView";
import { useMatchWorkspaceFormHandlers } from "@/features/matches/workspace/useMatchWorkspaceFormHandlers";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspaceLocalState } from "@/features/matches/workspace/useMatchWorkspaceLocalState";
import { useMatchWorkspaceMasterNavigation } from "@/features/matches/workspace/useMatchWorkspaceMasterNavigation";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useMatchWorkspaceReviewSession } from "@/features/matches/workspace/useMatchWorkspaceReviewSession";
import { useMatchWorkspaceSubmitFlow } from "@/features/matches/workspace/useMatchWorkspaceSubmitFlow";
import { useMatchWorkspaceValidation } from "@/features/matches/workspace/useMatchWorkspaceValidation";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";

type MatchWorkspacePageModelParams = {
  accountId?: string | undefined;
  canManageMasters: boolean;
  canNavigateToMasters: () => boolean;
  matchDraftId?: string | undefined;
  matchId?: string | undefined;
  matchSessionId?: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId?: string | undefined;
};

function workspaceLoadingCopy(mode: WorkspaceMode) {
  const labelByMode = {
    create: "試合作成を準備中",
    edit: "試合編集を読み込み中",
    review: "OCR結果を読み込み中",
  } as const satisfies Record<WorkspaceMode, string>;
  return { loadingLabel: labelByMode[mode] };
}

function validationFeedback(firstMessage: string | undefined, success: boolean): string {
  return success ? "確定前の確認へ進めます" : (firstMessage ?? "入力内容に不足があります");
}

export function useMatchWorkspacePageModel({
  accountId,
  canManageMasters,
  canNavigateToMasters,
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspacePageModelParams): MatchWorkspacePageModel {
  const [searchParams] = useSearchParams();
  const { notice, notify, notifyToast } = useWorkspaceNotice();
  const local = useMatchWorkspaceLocalState();
  const { dispatch, setValidationFocusRequest, setWorkspaceData, state } = local;
  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const workspaceKey = matchSessionId ?? matchDraftId ?? matchId ?? mode;
  const {
    heldEventPicker,
    load,
    resources,
    review: remoteReview,
  } = useMatchWorkspaceQueries({
    gameTitleId: state.values.gameTitleId,
    heldEventId: state.values.heldEventId,
    matchDraftId,
    matchDraftSourceImagesId: state.values.matchDraftId,
    matchId,
    mode,
    preferredHeldEventId,
    useSampleDrafts,
  });
  const {
    draftDetail,
    gameTitleItems,
    heldEventItems,
    mapItems,
    matchDetail,
    memberAliases,
    ocrDrafts,
    seasonItems,
    sourceImageItems,
  } = resources;

  const createEventMutation = useWorkspaceHeldEventCreation({
    dispatch,
    notify,
    setOperationError: local.setOperationError,
  });

  const initializeWorkspace = useCallback(
    (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => {
      dispatch({ payload: values, type: "replace" });
      setWorkspaceData(workspaceData);
    },
    [dispatch, setWorkspaceData],
  );
  const initialization = useMatchWorkspaceInit({
    dispatch,
    draftDetail,
    heldEventId: state.values.heldEventId,
    heldEvents: heldEventItems,
    matchDetail,
    matchDraftId,
    memberAliases,
    mode,
    ocrDrafts,
    onInitialize: initializeWorkspace,
    nowIsoFactory: local.nowIsoFactory,
    preferredHeldEventId,
    preferredHeldEventPending: load.preferredHeldEventPending,
    reviewDraftIdList: remoteReview.draftIdList,
    reviewDraftIds: remoteReview.draftIds,
    sourceImages: sourceImageItems,
    useSampleDrafts,
  });

  const validationState = useMatchWorkspaceValidation({
    mode,
    showValidationErrors: local.showValidationErrors,
    values: state.values,
  });
  const view = buildMatchWorkspaceView({
    draftDetail,
    gameTitleItems,
    heldEventItems,
    mapItems,
    matchId,
    mode,
    reviewStatus: remoteReview.status,
    seasonItems,
    sourceImages: initialization.snapshot?.sourceImages,
    useSampleDrafts,
    values: state.values,
  });
  const reviewSession = useMatchWorkspaceReviewSession({
    accountId,
    confirmedDraftLoaded: view.confirmedDraftLoaded,
    dispatch,
    draftTrackingEnabled: initialization.status === "ready",
    mode,
    notify,
    reviewKey: workspaceKey,
    values: state.values,
    workspaceData: local.workspaceData,
  });
  const { reviewState, sessionDraft } = reviewSession;
  const submitFlow = useMatchWorkspaceSubmitFlow({
    matchId,
    notify: notifyToast,
    onPersistedSuccess: sessionDraft.markCommitted,
    setConfirmOpen: local.setConfirmOpen,
    setOperationError: local.setOperationError,
    setValidationMessage: local.setValidationMessage,
    values: state.values,
  });
  const {
    confirmedDraft: { confirmedDraftRedirecting, redirectConfirmedDraft },
    mutations,
  } = submitFlow;

  useMatchWorkspaceLifecycleEffects({
    draftDetail,
    mode,
    redirectConfirmedDraft,
    useSampleDrafts,
  });
  const masterNavigation = useMatchWorkspaceMasterNavigation({
    canManageMasters,
    canNavigateToMasters,
    mode,
    notify,
    saveBeforeNavigate: sessionDraft.saveBeforeNavigate,
  });
  const formActions = useMatchWorkspaceFormHandlers({
    createHeldEvent: createEventMutation.mutate,
    dispatch,
    eventDraftValue: local.eventDraftValue,
    onReviewFieldChange: reviewState.markFieldChanged,
    onReviewPlayOrderChange: reviewState.markPlayOrderChanged,
    workspaceData: local.workspaceData,
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
    setConfirmOpen: local.setConfirmOpen,
    setShowValidationErrors: local.setShowValidationErrors,
    setValidationMessage: local.setValidationMessage,
    update: mutations.updateMutation.mutate,
    values: state.values,
  });
  const workspaceLoading = isMatchWorkspaceLoading({
    confirmedDraftRedirecting,
    confirmedDraftLoaded: view.confirmedDraftLoaded,
    waitingForData: initialization.status === "waiting-for-data",
    reviewBlocked: remoteReview.blocked,
    initializationFailed: load.initializationFailed,
  });

  const busy =
    mutations.isMutating || submitFlow.confirmation.pending || masterNavigation.isPending;
  const operationErrorView = local.operationError
    ? toMatchWorkspaceOperationErrorView(local.operationError)
    : null;
  const validationErrorView = local.validationMessage
    ? {
        detail: local.validationMessage,
        nextStep:
          "入力内容は保存・確定されていません。表示された項目を修正して、もう一度実行してください。",
        title: "入力内容を確認してください",
      }
    : null;

  return {
    editor: {
      disabled: busy,
      note:
        mode === "edit"
          ? null
          : {
              error: validationState.visibleErrorPathSet.has("noteBody"),
              onChange: (value) => formActions.onPatchRoot({ noteBody: value }),
              value: state.values.noteBody,
            },
      navigation: {
        masters: {
          pending: masterNavigation.isPending,
          show: masterNavigation.available,
          onNavigate: masterNavigation.navigateToMasters,
        },
      },
      persistence: {
        cancellation: {
          allowed: view.canCancelDraft,
          dialog: {
            open: local.cancelDraftConfirmOpen,
            pending: mutations.cancelDraftMutation.isPending,
            onConfirm: submitFlow.cancelDraftConfirmed,
            onOpenChange: local.setCancelDraftConfirmOpen,
          },
          disabled: busy || createEventMutation.isPending,
          error: local.operationError?.kind === "cancelDraft" ? operationErrorView : null,
          onTrigger: () => local.setCancelDraftConfirmOpen(true),
        },
        recovery: sessionDraft.recovery
          ? {
              savedAt: sessionDraft.recovery.savedAt,
              onDiscard: sessionDraft.discardRecovery,
              onRestore: sessionDraft.restoreRecovery,
            }
          : null,
        submit: {
          action: {
            label: mode === "edit" ? "保存" : "確定前の確認へ進む",
            onRun: onPrimaryAction,
          },
          availability: {
            disabled: workspaceLoading || busy || createEventMutation.isPending,
            pending: busy && !local.confirmOpen && !local.cancelDraftConfirmOpen,
          },
          feedback: {
            error:
              local.operationError?.kind === "heldEventCreation" ||
              local.operationError?.kind === "cancelDraft"
                ? validationErrorView
                : (operationErrorView ?? validationErrorView),
            message: createEventMutation.isPending
              ? "開催の作成が完了すると、入力内容を保存・確定できます。"
              : validationFeedback(
                  validationState.validation.firstMessage,
                  validationState.validation.success,
                ),
          },
        },
      },
      scoreGrid: {
        actions: {
          onAcknowledgeReviewCell: reviewState.acknowledgeCell,
          onIncidentChange: formActions.onIncidentChange,
          onNumericDraftChange: formActions.onNumericDraftChange,
          onPlayerChange: formActions.onPlayerChange,
          onPlayOrderChange: formActions.onPlayOrderChange,
          onPreferImageKindChange: local.setPreferredImageKind,
          onReviewCellFocus: reviewState.focusCell,
        },
        data: {
          errorPathSet: validationState.visibleErrorPathSet,
          lastSyncedPlayerIndex: state.lastSyncedPlayerIndex,
          numericDrafts: state.values.numericDrafts,
          validationFocusRequest: local.validationFocusRequest,
          originalPlayers: local.workspaceData?.originalPlayers,
          players: state.values.players,
          review: {
            acknowledgedCellIds: reviewState.acknowledgedCellIds,
            activeCellId: reviewState.activeCellId,
            items: reviewState.items,
          },
        },
      },
      setup: {
        eventCreation: {
          action: {
            pending: createEventMutation.isPending,
            onCreate: formActions.onCreateEvent,
          },
          feedback: {
            error: local.operationError?.kind === "heldEventCreation" ? operationErrorView : null,
          },
          input: {
            value: local.eventDraftValue,
            onChange: local.setEventDraftValue,
          },
        },
        fields: {
          actions: {
            onGameTitleChange: formActions.onGameTitleChange,
            onPatchRoot: formActions.onPatchRoot,
          },
          options: {
            gameTitleItems: view.gameTitleItems,
            heldEventPicker: heldEventPicker,
            heldEvents: view.heldEvents,
            mapItems: view.mapItems,
            seasonItems: view.seasonItems,
          },
          validation: {
            errorPathSet: validationState.visibleErrorPathSet,
            focusRequest: local.validationFocusRequest,
          },
          values: matchSetupValues(state.values),
        },
      },
      sourceImagePanel:
        view.hasSourceImagePanel && view.matchDraftIdForImages
          ? {
              accountId: accountId,
              loading: load.sourceImagesLoading,
              matchDraftId: view.matchDraftIdForImages,
              preferredKind: local.preferredImageKind,
              sourceImages: view.sourceImages,
              snapshotChanged: initialization.snapshot?.revision !== draftDetail?.updatedAt,
            }
          : null,
      warnings: local.workspaceData?.warnings ?? [],
      notice: notice,
    },
    loading: {
      base: load.base,
      edit: load.edit,
      workspace: {
        blocked: load.initializationFailed,
        copy: workspaceLoadingCopy(mode),
        loading: workspaceLoading,
      },
    },
    navigation: {
      pending: busy || createEventMutation.isPending,
      guard: {
        dirty: sessionDraft.dirty,
        navigationAllowedRef: sessionDraft.navigationAllowedRef,
        onDiscard: sessionDraft.markCommitted,
        saveBeforeLeave: sessionDraft.saveBeforeLeave,
      },
      toolbar: {
        exit: {
          href: view.exitHref,
          label: mode === "edit" ? "編集をやめる" : "入力をやめる",
        },
        sample: useSampleDrafts,
      },
    },
    persistence: {
      confirmation: local.confirmOpen
        ? {
            actions: {
              onClose: () => local.setConfirmOpen(false),
              onConfirm: submitFlow.confirmation.action,
            },
            feedback: { validationMessage: local.validationMessage },
            pending: submitFlow.confirmation.pending,
            review: {
              changedCount: reviewState.changedCount,
              totalCount: reviewState.items.length,
              unresolvedCount: reviewState.unresolvedCount,
            },
            summary: {
              gameTitleName: view.selectedGameTitle?.name,
              heldEvent: view.selectedHeldEvent,
              mapName: view.selectedMap?.name,
              seasonName: view.selectedSeason?.name,
            },
            values: state.values,
          }
        : null,
    },
    review: {
      blocked: remoteReview.blocked
        ? {
            feedback: {
              error: local.operationError?.kind === "draftStatus" ? operationErrorView : null,
            },
            refresh: remoteReview.refresh,
          }
        : null,
    },
    validationFocusRequest: local.validationFocusRequest,
  };
}

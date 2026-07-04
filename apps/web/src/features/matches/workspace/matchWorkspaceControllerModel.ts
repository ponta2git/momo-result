import type { NormalizedApiError } from "@/shared/api/problemDetails";

import type { MatchFormReducerState } from "./matchFormReducer";
import type { MatchWorkspaceInitialData, WorkspaceMode } from "./matchFormTypes";
import type { SourceImageItem, SourceImageKind } from "./sourceImages/sourceImageTypes";
import type { useMatchWorkspaceFormHandlers } from "./useMatchWorkspaceFormHandlers";
import type { useMatchWorkspaceValidation } from "./useMatchWorkspaceValidation";
import type { useMatchWorkspaceViewModel } from "./useMatchWorkspaceViewModel";

type MatchWorkspaceControllerModelArgs = {
  baseErrors: NormalizedApiError[];
  cancelDraftConfirmOpen: boolean;
  cancelDraftPending: boolean;
  closeConfirm: () => void;
  confirmAction: (formData: FormData) => void | Promise<void>;
  confirmOpen: boolean;
  createEventPending: boolean;
  editLoadFailed: boolean;
  editLoading: boolean;
  eventDraftValue: string;
  formHandlers: ReturnType<typeof useMatchWorkspaceFormHandlers>;
  isMutating: boolean;
  isNavigatingToMasters: boolean;
  isOcrRunningBlocked: boolean;
  mode: WorkspaceMode;
  notice: string;
  preferredImageKind: SourceImageKind;
  returnTo: string | null | undefined;
  sourceImageLoading: boolean;
  sourceImages: SourceImageItem[] | undefined;
  state: MatchFormReducerState;
  useSampleDrafts: boolean;
  validationState: ReturnType<typeof useMatchWorkspaceValidation>;
  validationMessage: string;
  viewModel: ReturnType<typeof useMatchWorkspaceViewModel>;
  workspaceLoading: boolean;
  workspaceData: MatchWorkspaceInitialData | null;
  onCancelDraftConfirm: () => void | Promise<void>;
  onCancelDraftOpenChange: (open: boolean) => void;
  onCancelDraftTrigger: () => void;
  onEventDraftChange: (value: string) => void;
  onNavigateToMasters: () => void;
  onPreferImageKindChange: (kind: SourceImageKind) => void;
  onPrimaryAction: () => void;
  onRefreshReviewStatus: () => Promise<void>;
  refreshingReviewStatus: boolean;
};

function workspaceLoadingCopy(mode: WorkspaceMode) {
  if (mode === "review") {
    return {
      description: "OCR結果と確定前の記録を取得しています。",
      title: "OCR結果を読み込み中",
    };
  }

  return {
    description: "試合条件と入力フォームを準備しています。",
    title: "試合作成を準備中",
  };
}

function validationFeedback({
  firstMessage,
  success,
}: {
  firstMessage: string | undefined;
  success: boolean;
}) {
  return success ? "確定前の確認へ進めます" : (firstMessage ?? "入力内容に不足があります");
}

export function buildMatchWorkspaceControllerModel(args: MatchWorkspaceControllerModelArgs) {
  const { validation, visibleErrorPathSet } = args.validationState;
  const { state, viewModel } = args;

  return {
    baseErrors: args.baseErrors,
    blockedNotice: args.isOcrRunningBlocked
      ? {
          onRefreshReviewStatus: args.onRefreshReviewStatus,
          refreshingReviewStatus: args.refreshingReviewStatus,
        }
      : null,
    confirmDialog: args.confirmOpen
      ? {
          confirmAction: args.confirmAction,
          gameTitleName: viewModel.selectedGameTitle?.name,
          heldEvent: viewModel.selectedHeldEvent,
          mapName: viewModel.selectedMap?.name,
          seasonName: viewModel.selectedSeason?.name,
          validationMessage: args.validationMessage,
          values: state.values,
          onCancel: args.closeConfirm,
        }
      : null,
    editor: {
      scoreGrid: {
        errorPathSet: visibleErrorPathSet,
        lastSyncedPlayerIndex: state.lastSyncedPlayerIndex,
        originalPlayers: args.workspaceData?.originalPlayers,
        players: state.values.players,
        onIncidentChange: args.formHandlers.onIncidentChange,
        onPlayerChange: args.formHandlers.onPlayerChange,
        onPlayOrderChange: args.formHandlers.onPlayOrderChange,
        onPreferImageKindChange: args.onPreferImageKindChange,
      },
      sourceImagePanel:
        viewModel.hasSourceImagePanel && viewModel.matchDraftIdForImages
          ? {
              loading: args.sourceImageLoading,
              matchDraftId: viewModel.matchDraftIdForImages,
              preferredKind: args.preferredImageKind,
              sourceImages: args.sourceImages,
            }
          : null,
      validationMessage: args.validationMessage,
      warnings: args.workspaceData?.warnings ?? [],
    },
    formActions: {
      actionLabel: args.mode === "edit" ? "保存" : "確定前の確認へ進む",
      disabled: args.workspaceLoading,
      message: validationFeedback({
        firstMessage: validation.firstMessage,
        success: validation.success,
      }),
      pending: args.isMutating,
      onPrimaryAction: args.onPrimaryAction,
    },
    header: {
      cancelDraft: {
        canCancel: viewModel.canCancelDraft,
        confirmOpen: args.cancelDraftConfirmOpen,
        confirmPending: args.cancelDraftPending,
        disabled: args.isMutating,
        onConfirm: args.onCancelDraftConfirm,
        onOpenChange: args.onCancelDraftOpenChange,
        onTrigger: args.onCancelDraftTrigger,
      },
      mastersNavigation: {
        show: (args.mode === "review" || args.mode === "create") && Boolean(args.returnTo),
        pending: args.isNavigatingToMasters,
        onClick: args.onNavigateToMasters,
      },
      pageDescription: viewModel.pageDescription,
      pageTitle: viewModel.pageTitle,
      useSampleDrafts: args.useSampleDrafts,
    },
    liveMessage: args.notice || args.validationMessage,
    loadState: {
      editLoadFailed: args.editLoadFailed,
      editLoading: args.editLoading,
      workspaceLoading: args.workspaceLoading,
      workspaceLoadingCopy: workspaceLoadingCopy(args.mode),
    },
    setup: {
      createEventPending: args.createEventPending,
      errorPathSet: visibleErrorPathSet,
      eventDraftValue: args.eventDraftValue,
      gameTitleItems: viewModel.gameTitleItems,
      heldEvents: viewModel.heldEvents,
      mapItems: viewModel.mapItems,
      seasonItems: viewModel.seasonItems,
      values: state.values,
      onCreateEvent: args.formHandlers.onCreateEvent,
      onEventDraftChange: args.onEventDraftChange,
      onGameTitleChange: args.formHandlers.onGameTitleChange,
      onPatchRoot: args.formHandlers.onPatchRoot,
    },
  };
}

export type MatchWorkspaceControllerModel = ReturnType<typeof buildMatchWorkspaceControllerModel>;

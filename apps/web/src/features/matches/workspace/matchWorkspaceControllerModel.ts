import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";

import type { WorkspaceMode } from "./matchFormTypes";
import type { MatchWorkspaceControllerModelArgs } from "./matchWorkspaceControllerModelInput";

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
  const { handlers, state, validation, workspaceData } = args.form;
  const { mode, useSampleDrafts, view } = args.workspace;
  const { visibleErrorPathSet } = validation.result;
  const operationErrorView = args.persistence.error
    ? toMatchWorkspaceOperationErrorView(args.persistence.error)
    : null;
  const validationErrorView = validation.message
    ? {
        detail: validation.message,
        nextStep:
          "入力内容は保存・確定されていません。表示された項目を修正して、もう一度実行してください。",
        title: "入力内容を確認してください",
      }
    : null;

  return {
    editor: {
      navigation: {
        masters: args.navigation.masters,
      },
      persistence: {
        cancellation: {
          allowed: args.persistence.cancellation.allowed,
          dialog: {
            open: args.persistence.cancellation.confirmOpen,
            pending: args.persistence.cancellation.pending,
            onConfirm: args.persistence.cancellation.onConfirm,
            onOpenChange: args.persistence.cancellation.onOpenChange,
          },
          disabled: args.persistence.busy,
          error: args.persistence.error?.kind === "cancelDraft" ? operationErrorView : null,
          onTrigger: args.persistence.cancellation.onTrigger,
        },
        recovery: args.persistence.recovery.recovery
          ? {
              savedAt: args.persistence.recovery.recovery.savedAt,
              onDiscard: args.persistence.recovery.discardRecovery,
              onRestore: args.persistence.recovery.restoreRecovery,
            }
          : null,
        submit: {
          action: {
            label: mode === "edit" ? "保存" : "確定前の確認へ進む",
            onRun: args.persistence.onPrimaryAction,
          },
          availability: {
            disabled: args.loading.workspace.loading,
            pending: args.persistence.busy,
          },
          feedback: {
            error:
              args.persistence.error?.kind === "heldEventCreation" ||
              args.persistence.error?.kind === "cancelDraft"
                ? validationErrorView
                : (operationErrorView ?? validationErrorView),
            message: validationFeedback({
              firstMessage: validation.result.validation.firstMessage,
              success: validation.result.validation.success,
            }),
          },
        },
      },
      scoreGrid: {
        actions: {
          onAcknowledgeReviewCell: args.review.state.acknowledgeCell,
          onIncidentChange: handlers.onIncidentChange,
          onPlayerChange: handlers.onPlayerChange,
          onPlayOrderChange: handlers.onPlayOrderChange,
          onPreferImageKindChange: args.sourceImages.onPreferredKindChange,
          onReviewCellFocus: args.review.state.focusCell,
        },
        data: {
          errorPathSet: visibleErrorPathSet,
          lastSyncedPlayerIndex: state.lastSyncedPlayerIndex,
          originalPlayers: workspaceData?.originalPlayers,
          players: state.values.players,
          review: {
            acknowledgedCellIds: args.review.state.acknowledgedCellIds,
            activeCellId: args.review.state.activeCellId,
            items: args.review.state.items,
          },
        },
      },
      setup: {
        eventCreation: {
          action: {
            pending: args.setup.eventCreation.pending,
            onCreate: handlers.onCreateEvent,
          },
          feedback: {
            error: args.persistence.error?.kind === "heldEventCreation" ? operationErrorView : null,
          },
          input: {
            value: args.setup.eventCreation.draftValue,
            onChange: args.setup.eventCreation.onDraftChange,
          },
        },
        fields: {
          actions: {
            onGameTitleChange: handlers.onGameTitleChange,
            onPatchRoot: handlers.onPatchRoot,
          },
          options: {
            gameTitleItems: view.gameTitleItems,
            heldEventPicker: args.setup.heldEventPicker,
            heldEvents: view.heldEvents,
            mapItems: view.mapItems,
            seasonItems: view.seasonItems,
          },
          validation: {
            errorPathSet: visibleErrorPathSet,
          },
          values: state.values,
        },
      },
      sourceImagePanel:
        view.hasSourceImagePanel && view.matchDraftIdForImages
          ? {
              loading: args.sourceImages.loading,
              matchDraftId: view.matchDraftIdForImages,
              preferredKind: args.sourceImages.preferredKind,
              sourceImages: args.sourceImages.items,
            }
          : null,
      warnings: workspaceData?.warnings ?? [],
    },
    loading: {
      base: args.loading.base,
      edit: args.loading.edit,
      workspace: {
        copy: workspaceLoadingCopy(mode),
        loading: args.loading.workspace.loading,
      },
    },
    navigation: {
      guard: args.navigation.guard,
      header: {
        description: view.pageDescription,
        exit: args.navigation.exit,
        sample: useSampleDrafts,
        title: view.pageTitle,
      },
    },
    persistence: {
      confirmation: args.persistence.confirmation.open
        ? {
            actions: {
              onClose: args.persistence.confirmation.onClose,
              onConfirm: args.persistence.confirmation.onConfirm,
            },
            feedback: {
              validationMessage: validation.message,
            },
            pending: args.persistence.busy,
            review: {
              changedCount: args.review.state.changedCount,
              totalCount: args.review.state.items.length,
              unresolvedCount: args.review.state.unresolvedCount,
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
      blocked: args.review.blocked
        ? {
            feedback: {
              error: args.persistence.error?.kind === "draftStatus" ? operationErrorView : null,
            },
            refresh: args.review.statusRefresh,
          }
        : null,
    },
    validationFocusRequest: validation.focusRequest,
  };
}

export type MatchWorkspaceControllerModel = ReturnType<typeof buildMatchWorkspaceControllerModel>;

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspacePageModelInput } from "@/features/matches/workspace/matchWorkspacePageCapabilities";
import type { MatchWorkspacePageModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";

function workspaceLoadingCopy(mode: WorkspaceMode) {
  return mode === "review"
    ? {
        description: "OCR結果と確定前の記録を取得しています。",
        title: "OCR結果を読み込み中",
      }
    : {
        description: "試合条件と入力フォームを準備しています。",
        title: "試合作成を準備中",
      };
}

function validationFeedback(firstMessage: string | undefined, success: boolean): string {
  return success ? "確定前の確認へ進めます" : (firstMessage ?? "入力内容に不足があります");
}

/** Converts feature capabilities into the display-only contract consumed by MatchWorkspacePage. */
export function buildMatchWorkspacePageModel(
  input: MatchWorkspacePageModelInput,
): MatchWorkspacePageModel {
  const { actions, state, validation, validationMessage, workspaceData } = input.form;
  const { mode, useSampleDrafts, view } = input.workspace;
  const operationErrorView = input.persistence.error
    ? toMatchWorkspaceOperationErrorView(input.persistence.error)
    : null;
  const validationErrorView = validationMessage
    ? {
        detail: validationMessage,
        nextStep:
          "入力内容は保存・確定されていません。表示された項目を修正して、もう一度実行してください。",
        title: "入力内容を確認してください",
      }
    : null;

  return {
    editor: {
      navigation: {
        masters: {
          pending: input.navigation.masters.pending,
          show: input.navigation.masters.returnAvailable,
          onNavigate: input.navigation.masters.onNavigate,
        },
      },
      persistence: {
        cancellation: {
          allowed: view.canCancelDraft,
          dialog: {
            open: input.persistence.cancellation.confirmOpen,
            pending: input.persistence.cancellation.pending,
            onConfirm: input.persistence.cancellation.onConfirm,
            onOpenChange: input.persistence.cancellation.onOpenChange,
          },
          disabled: input.persistence.busy,
          error: input.persistence.error?.kind === "cancelDraft" ? operationErrorView : null,
          onTrigger: input.persistence.cancellation.onTrigger,
        },
        recovery: input.draftSession.recovery
          ? {
              savedAt: input.draftSession.recovery.savedAt,
              onDiscard: input.draftSession.discardRecovery,
              onRestore: input.draftSession.restoreRecovery,
            }
          : null,
        submit: {
          action: {
            label: mode === "edit" ? "保存" : "確定前の確認へ進む",
            onRun: input.persistence.onPrimaryAction,
          },
          availability: {
            disabled: input.loading.workspaceLoading,
            pending: input.persistence.busy,
          },
          feedback: {
            error:
              input.persistence.error?.kind === "heldEventCreation" ||
              input.persistence.error?.kind === "cancelDraft"
                ? validationErrorView
                : (operationErrorView ?? validationErrorView),
            message: validationFeedback(
              validation.validation.firstMessage,
              validation.validation.success,
            ),
          },
        },
      },
      scoreGrid: {
        actions: {
          onAcknowledgeReviewCell: input.review.state.acknowledgeCell,
          onIncidentChange: actions.onIncidentChange,
          onPlayerChange: actions.onPlayerChange,
          onPlayOrderChange: actions.onPlayOrderChange,
          onPreferImageKindChange: input.sourceImages.onPreferredKindChange,
          onReviewCellFocus: input.review.state.focusCell,
        },
        data: {
          errorPathSet: validation.visibleErrorPathSet,
          lastSyncedPlayerIndex: state.lastSyncedPlayerIndex,
          originalPlayers: workspaceData?.originalPlayers,
          players: state.values.players,
          review: {
            acknowledgedCellIds: input.review.state.acknowledgedCellIds,
            activeCellId: input.review.state.activeCellId,
            items: input.review.state.items,
          },
        },
      },
      setup: {
        eventCreation: {
          action: {
            pending: input.setup.eventCreation.pending,
            onCreate: actions.onCreateEvent,
          },
          feedback: {
            error:
              input.persistence.error?.kind === "heldEventCreation" ? operationErrorView : null,
          },
          input: {
            value: input.setup.eventCreation.draftValue,
            onChange: input.setup.eventCreation.onDraftChange,
          },
        },
        fields: {
          actions: {
            onGameTitleChange: actions.onGameTitleChange,
            onPatchRoot: actions.onPatchRoot,
          },
          options: {
            gameTitleItems: view.gameTitleItems,
            heldEventPicker: input.setup.heldEventPicker,
            heldEvents: view.heldEvents,
            mapItems: view.mapItems,
            seasonItems: view.seasonItems,
          },
          validation: { errorPathSet: validation.visibleErrorPathSet },
          values: state.values,
        },
      },
      sourceImagePanel:
        view.hasSourceImagePanel && view.matchDraftIdForImages
          ? {
              loading: input.sourceImages.loading,
              matchDraftId: view.matchDraftIdForImages,
              preferredKind: input.sourceImages.preferredKind,
              sourceImages: input.sourceImages.items,
            }
          : null,
      warnings: workspaceData?.warnings ?? [],
    },
    loading: {
      base: input.loading.base,
      edit: input.loading.edit,
      workspace: {
        copy: workspaceLoadingCopy(mode),
        loading: input.loading.workspaceLoading,
      },
    },
    navigation: {
      guard: {
        dirty: input.draftSession.dirty,
        navigationAllowedRef: input.draftSession.navigationAllowedRef,
        onDiscard: input.draftSession.markCommitted,
      },
      header: {
        description: view.pageDescription,
        exit: {
          href: input.navigation.exitHref,
          label: mode === "edit" ? "編集をやめる" : "入力をやめる",
        },
        sample: useSampleDrafts,
        title: view.pageTitle,
      },
    },
    persistence: {
      confirmation: input.persistence.confirmation.open
        ? {
            actions: {
              onClose: input.persistence.confirmation.onClose,
              onConfirm: input.persistence.confirmation.onConfirm,
            },
            feedback: { validationMessage },
            pending: input.persistence.busy,
            review: {
              changedCount: input.review.state.changedCount,
              totalCount: input.review.state.items.length,
              unresolvedCount: input.review.state.unresolvedCount,
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
      blocked: input.review.blocked
        ? {
            feedback: {
              error: input.persistence.error?.kind === "draftStatus" ? operationErrorView : null,
            },
            refresh: input.review.statusRefresh,
          }
        : null,
    },
    validationFocusRequest: input.form.focusRequest,
  };
}

import { useCallback, useReducer, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useConfirmedDraftRedirect } from "@/features/matches/workspace/useConfirmedDraftRedirect";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceConfirmAction } from "@/features/matches/workspace/useMatchWorkspaceConfirmAction";
import { useMatchWorkspaceFormHandlers } from "@/features/matches/workspace/useMatchWorkspaceFormHandlers";
import { useMatchWorkspaceHandoffNavigation } from "@/features/matches/workspace/useMatchWorkspaceHandoffNavigation";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useMatchWorkspaceSourceImages } from "@/features/matches/workspace/useMatchWorkspaceSourceImages";
import { useMatchWorkspaceValidation } from "@/features/matches/workspace/useMatchWorkspaceValidation";
import { useMatchWorkspaceViewModel } from "@/features/matches/workspace/useMatchWorkspaceViewModel";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";
import { currentLocalIsoMinute } from "@/features/matches/workspace/workspaceDerivations";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";

export type MatchWorkspaceControllerParams = {
  matchDraftId?: string | undefined;
  matchId?: string | undefined;
  matchSessionId?: string | undefined;
  mode: WorkspaceMode;
};

export function useMatchWorkspaceController({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
}: MatchWorkspaceControllerParams) {
  const [searchParams] = useSearchParams();

  const { notice, notify } = useWorkspaceNotice();
  const [validationMessage, setValidationMessage] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState<string>(currentLocalIsoMinute);
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const emptyFormFactory = useCallback(
    () => createEmptyMatchForm(nowIsoFactory()),
    [nowIsoFactory],
  );
  const [state, dispatch] = useReducer(matchFormReducer, null, () =>
    createMatchFormReducerState(emptyFormFactory()),
  );

  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const hasHandoff = searchParams.has("handoffId");
  const handoffSessionId = matchSessionId ?? matchDraftId ?? mode;

  const {
    confirmedDraftRedirecting,
    ensureDraftIsOpenForConfirm,
    handleConfirmConflict,
    redirectConfirmedDraft,
  } = useConfirmedDraftRedirect({
    notify,
    setValidationMessage,
    useSampleDrafts,
  });

  const queries = useMatchWorkspaceQueries({
    gameTitleId: state.values.gameTitleId,
    matchDraftId,
    matchDraftSourceImagesId: state.values.matchDraftId,
    matchId,
    mode,
    searchParams,
    useSampleDrafts,
  });

  const {
    derived: { baseErrors, isOcrRunningBlocked, refreshingReviewStatus, reviewStatus },
    draftDetailQuery,
    gameTitlesQuery,
    heldEventsQuery,
    mapMastersQuery,
    memberAliasesQuery,
    matchDetailQuery,
    ocrDraftsQuery,
    reviewDraftIdList,
    reviewDraftIds,
    seasonMastersQuery,
    sourceImageQuery,
  } = queries;

  const createEventMutation = useWorkspaceHeldEventCreation({
    onError: setValidationMessage,
    onSelectCreatedEvent: (event) => {
      dispatch({
        patch: {
          heldEventId: event.id,
          matchNoInEvent: event.matchCount + 1,
          playedAt: event.heldAt,
        },
        type: "patch_root",
      });
    },
    onSuccessNotice: (message) => notify(message, "success"),
  });

  const { cancelDraftMutation, confirmMutation, isMutating, updateMutation } =
    useMatchWorkspaceMutations({
      matchId,
      onConfirmConflict: handleConfirmConflict,
      onConfirmSuccess: () => setConfirmOpen(false),
      onError: setValidationMessage,
    });

  const confirmAction = useMatchWorkspaceConfirmAction({
    confirmMutation,
    ensureDraftIsOpenForConfirm,
    values: state.values,
  });

  const { isInitialized } = useMatchWorkspaceInit({
    draftDetail: draftDetailQuery.data ?? undefined,
    draftDetailLoading: draftDetailQuery.isLoading,
    emptyFormFactory,
    matchDetail: matchDetailQuery.data ?? undefined,
    matchDraftId,
    matchId,
    memberAliases: memberAliasesQuery.data?.items ?? [],
    mode,
    ocrDrafts: ocrDraftsQuery.data ?? undefined,
    ocrDraftsError: shouldShowQueryError(ocrDraftsQuery),
    onInitialize: (values, workspaceInitial) => {
      dispatch({ payload: values, type: "replace" });
      setWorkspaceData(workspaceInitial);
    },
    nowIsoFactory,
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
  });

  const { returnTo } = useMasterHandoffRestore({
    handoffSessionId,
    isInitialized,
    mode,
    onRestore: (payload) => {
      dispatch({
        payload: {
          ...state.values,
          ...payload.values,
          ...(state.values.matchDraftId ? { matchDraftId: state.values.matchDraftId } : {}),
        },
        type: "replace",
      });
      notify("設定管理から戻ったため、入力内容を復元しました。", "success");
    },
    onRestoreFailed: () => {
      notify("設定管理から戻りましたが、入力内容を復元できませんでした。", "warning");
    },
    searchParams,
  });

  const { validation, visibleErrorPathSet } = useMatchWorkspaceValidation({
    mode,
    showValidationErrors,
    values: state.values,
  });
  const viewModel = useMatchWorkspaceViewModel({
    draftDetail: draftDetailQuery.data,
    gameTitleItems: gameTitlesQuery.data?.items,
    heldEventItems: heldEventsQuery.data?.items,
    mapItems: mapMastersQuery.data?.items,
    mode,
    reviewStatus,
    seasonItems: seasonMastersQuery.data?.items,
    useSampleDrafts,
    values: state.values,
  });
  const { confirmedDraftLoaded, heldEvents, matchDraftIdForImages } = viewModel;

  useMatchWorkspaceLifecycleEffects({
    dispatch,
    draftDetail: draftDetailQuery.data,
    hasHandoff,
    heldEventId: state.values.heldEventId,
    heldEvents,
    isInitialized,
    mode,
    redirectConfirmedDraft,
    useSampleDrafts,
  });

  const handleCancelDraftConfirmed = async () => {
    const targetDraftId = state.values.matchDraftId;
    if (!targetDraftId) {
      return;
    }
    setValidationMessage("");
    await cancelDraftMutation.mutateAsync(targetDraftId);
  };

  const { isPending: isNavigatingToMasters, navigateToMasters: handleNavigateToMasters } =
    useMatchWorkspaceHandoffNavigation({
      handoffSessionId,
      notify,
      returnTo,
      values: state.values,
    });

  const sourceImages = useMatchWorkspaceSourceImages({
    items: sourceImageQuery.data?.items,
    matchDraftId: matchDraftIdForImages,
  });

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const formHandlers = useMatchWorkspaceFormHandlers({
    createHeldEvent: createEventMutation.mutate,
    dispatch,
    eventDraftValue,
    workspaceData,
  });
  const onPrimaryAction = useMatchWorkspacePrimaryAction({
    mode,
    setConfirmOpen,
    setShowValidationErrors,
    setValidationMessage,
    update: updateMutation.mutate,
    values: state.values,
  });
  const refreshReviewStatus = useCallback(async () => {
    await Promise.all([draftDetailQuery.refetch(), ocrDraftsQuery.refetch()]);
  }, [draftDetailQuery, ocrDraftsQuery]);

  return {
    ...formHandlers,
    ...viewModel,
    baseErrors,
    cancelDraftConfirmOpen,
    cancelDraftMutation,
    closeConfirm,
    confirmAction,
    confirmOpen,
    createEventMutation,
    editLoadFailed: mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery),
    editLoading: mode === "edit" && isInitialQueryLoading(matchDetailQuery),
    eventDraftValue,
    handleCancelDraftConfirmed,
    handleNavigateToMasters,
    isInitialized,
    isNavigatingToMasters,
    isMutating,
    isOcrRunningBlocked,
    notice,
    preferredImageKind,
    refreshReviewStatus,
    refreshingReviewStatus,
    returnTo,
    reviewStatus,
    setCancelDraftConfirmOpen,
    setEventDraftValue,
    setPreferredImageKind,
    setShowValidationErrors,
    setValidationMessage,
    showValidationErrors,
    sourceImageLoading: sourceImageQuery.isLoading,
    sourceImages,
    state,
    updateMutation,
    useSampleDrafts,
    validation,
    validationMessage,
    visibleErrorPathSet,
    workspaceLoading: confirmedDraftRedirecting || confirmedDraftLoaded || !isInitialized,
    workspaceData,
    onPrimaryAction,
  };
}

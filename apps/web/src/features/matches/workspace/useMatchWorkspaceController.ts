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
import { buildMatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import type { MatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceFormHandlers } from "@/features/matches/workspace/useMatchWorkspaceFormHandlers";
import { useMatchWorkspaceHandoffNavigation } from "@/features/matches/workspace/useMatchWorkspaceHandoffNavigation";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useMatchWorkspaceReviewSession } from "@/features/matches/workspace/useMatchWorkspaceReviewSession";
import { useMatchWorkspaceSourceImages } from "@/features/matches/workspace/useMatchWorkspaceSourceImages";
import { useMatchWorkspaceSubmitFlow } from "@/features/matches/workspace/useMatchWorkspaceSubmitFlow";
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
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

export type MatchWorkspaceControllerParams = {
  matchDraftId?: string | undefined;
  matchId?: string | undefined;
  matchSessionId?: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId?: string | undefined;
};

export function useMatchWorkspaceController({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspaceControllerParams) {
  const [searchParams] = useSearchParams();
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const { notify } = useWorkspaceNotice();
  const [validationMessage, setValidationMessage] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [validationFocusRequest, setValidationFocusRequest] = useState<{
    path: string;
    sequence: number;
  } | null>(null);
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
  const queries = useMatchWorkspaceQueries({
    gameTitleId: state.values.gameTitleId,
    matchDraftId,
    matchDraftSourceImagesId: state.values.matchDraftId,
    matchId,
    mode,
    preferredHeldEventId,
    searchParams,
    useSampleDrafts,
  });
  const {
    derived: { baseErrors, isOcrRunningBlocked, refreshingReviewStatus, reviewStatus },
    draftDetailQuery,
    gameTitlesQuery,
    heldEventItems,
    mapMastersQuery,
    memberAliasesQuery,
    matchDetailQuery,
    ocrDraftsQuery,
    preferredHeldEventPending,
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
          matchNoInEvent: event.nextMatchNo,
          playedAt: event.heldAt,
        },
        type: "patch_root",
      });
    },
    onSuccessNotice: (message) => notify(message, "success"),
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

  const { returnTo: masterReturnTo } = useMasterHandoffRestore({
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
    heldEventItems,
    mapItems: mapMastersQuery.data?.items,
    mode,
    reviewStatus,
    seasonItems: seasonMastersQuery.data?.items,
    useSampleDrafts,
    values: state.values,
  });
  const { confirmedDraftLoaded, heldEvents, matchDraftIdForImages } = viewModel;

  const { reviewState, sessionDraft } = useMatchWorkspaceReviewSession({
    confirmedDraftLoaded,
    dispatch,
    isInitialized,
    mode,
    notify,
    reviewKey: handoffSessionId,
    values: state.values,
    workspaceData,
  });
  const {
    cancelDraftConfirmed: handleCancelDraftConfirmed,
    confirmAction,
    confirmedDraft: { confirmedDraftRedirecting, redirectConfirmedDraft },
    mutations: { cancelDraftMutation, isMutating, updateMutation },
  } = useMatchWorkspaceSubmitFlow({
    matchId,
    mode,
    notify,
    onPersistedSuccess: sessionDraft.markCommitted,
    setConfirmOpen,
    setValidationMessage,
    returnTo: contextualReturnTo,
    useSampleDrafts,
    values: state.values,
  });

  useMatchWorkspaceLifecycleEffects({
    dispatch,
    draftDetail: draftDetailQuery.data,
    hasHandoff,
    heldEventId: state.values.heldEventId,
    heldEvents,
    isInitialized,
    mode,
    preferredHeldEventId,
    preferredHeldEventPending,
    redirectConfirmedDraft,
    useSampleDrafts,
  });

  const { isPending: isNavigatingToMasters, navigateToMasters: handleNavigateToMasters } =
    useMatchWorkspaceHandoffNavigation({
      handoffSessionId,
      notify,
      onBeforeNavigate: sessionDraft.allowNavigation,
      returnTo: masterReturnTo,
      values: state.values,
    });

  const sourceImages = useMatchWorkspaceSourceImages({
    items: sourceImageQuery.data?.items,
    matchDraftId: matchDraftIdForImages,
  });

  const formHandlers = useMatchWorkspaceFormHandlers({
    createHeldEvent: createEventMutation.mutate,
    dispatch,
    eventDraftValue,
    onReviewFieldChange: reviewState.markFieldChanged,
    onReviewPlayOrderChange: reviewState.markPlayOrderChanged,
    workspaceData,
  });
  const onPrimaryAction = useMatchWorkspacePrimaryAction({
    mode,
    onValidationFailure: (path) =>
      setValidationFocusRequest((current) => ({
        path,
        sequence: (current?.sequence ?? 0) + 1,
      })),
    setConfirmOpen,
    setShowValidationErrors,
    setValidationMessage,
    update: updateMutation.mutate,
    values: state.values,
  });
  const refreshReviewStatus = useCallback(async () => {
    await Promise.all([draftDetailQuery.refetch(), ocrDraftsQuery.refetch()]);
  }, [draftDetailQuery, ocrDraftsQuery]);

  const workspaceLoading = confirmedDraftRedirecting || confirmedDraftLoaded || !isInitialized;
  const cancelHref =
    contextualReturnTo ??
    (mode === "edit" && matchId
      ? `/matches/${encodeURIComponent(matchId)}`
      : state.values.heldEventId
        ? `/held-events/${encodeURIComponent(state.values.heldEventId)}`
        : "/matches");

  return buildMatchWorkspaceControllerModel({
    baseErrors,
    cancelDraftConfirmOpen,
    cancelDraftPending: cancelDraftMutation.isPending,
    cancelHref,
    cancelLabel: mode === "edit" ? "編集をやめる" : "入力をやめる",
    closeConfirm: () => setConfirmOpen(false),
    confirmAction,
    confirmOpen,
    createEventPending: createEventMutation.isPending,
    editLoadFailed: mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery),
    editLoading: mode === "edit" && isInitialQueryLoading(matchDetailQuery),
    eventDraftValue,
    formHandlers,
    isMutating,
    isNavigatingToMasters,
    isOcrRunningBlocked,
    mode,
    preferredImageKind,
    refreshingReviewStatus,
    returnTo: masterReturnTo,
    reviewState,
    sessionDraft,
    sourceImageLoading: sourceImageQuery.isLoading,
    sourceImages,
    state,
    useSampleDrafts,
    validationState: { validation, visibleErrorPathSet },
    validationMessage,
    validationFocusRequest,
    viewModel,
    workspaceData,
    workspaceLoading,
    onCancelDraftConfirm: handleCancelDraftConfirmed,
    onCancelDraftOpenChange: setCancelDraftConfirmOpen,
    onCancelDraftTrigger: () => setCancelDraftConfirmOpen(true),
    onEventDraftChange: setEventDraftValue,
    onNavigateToMasters: handleNavigateToMasters,
    onPreferImageKindChange: setPreferredImageKind,
    onPrimaryAction,
    onRefreshReviewStatus: refreshReviewStatus,
  });
}

export type MatchWorkspaceController = MatchWorkspaceControllerModel;

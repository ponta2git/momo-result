import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { buildMatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import type { MatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import { createMatchWorkspaceControllerModelInput } from "@/features/matches/workspace/matchWorkspaceControllerModelInput";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceFormHandlers } from "@/features/matches/workspace/useMatchWorkspaceFormHandlers";
import { useMatchWorkspaceHandoffNavigation } from "@/features/matches/workspace/useMatchWorkspaceHandoffNavigation";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspaceLocalState } from "@/features/matches/workspace/useMatchWorkspaceLocalState";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useMatchWorkspaceReviewSession } from "@/features/matches/workspace/useMatchWorkspaceReviewSession";
import { useMatchWorkspaceSourceImages } from "@/features/matches/workspace/useMatchWorkspaceSourceImages";
import { useMatchWorkspaceSubmitFlow } from "@/features/matches/workspace/useMatchWorkspaceSubmitFlow";
import { useMatchWorkspaceValidation } from "@/features/matches/workspace/useMatchWorkspaceValidation";
import { useMatchWorkspaceViewModel } from "@/features/matches/workspace/useMatchWorkspaceViewModel";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useAuth } from "@/shared/auth/useAuth";
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
  const auth = useAuth();
  const accountId = auth.auth?.accountId;
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const { notify } = useWorkspaceNotice();
  const local = useMatchWorkspaceLocalState();
  const { dispatch, state } = local;
  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const hasHandoff = searchParams.has("handoffId");
  const handoffSessionId = matchSessionId ?? matchDraftId ?? mode;
  const queries = useMatchWorkspaceQueries({
    gameTitleId: state.values.gameTitleId,
    heldEventId: state.values.heldEventId,
    matchDraftId,
    matchDraftSourceImagesId: state.values.matchDraftId,
    matchId,
    mode,
    preferredHeldEventId,
    searchParams,
    useSampleDrafts,
  });
  const {
    derived: { reviewStatus },
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
    onError: (message) => local.setOperationError({ kind: "heldEventCreation", message }),
    onOperationStart: () => local.setOperationError(null),
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
    emptyFormFactory: local.emptyFormFactory,
    matchDetail: matchDetailQuery.data ?? undefined,
    matchDraftId,
    matchId,
    memberAliases: memberAliasesQuery.data?.items ?? [],
    mode,
    ocrDrafts: ocrDraftsQuery.data ?? undefined,
    ocrDraftsError: shouldShowQueryError(ocrDraftsQuery),
    onInitialize: (values, workspaceInitial) => {
      dispatch({ payload: values, type: "replace" });
      local.setWorkspaceData(workspaceInitial);
    },
    nowIsoFactory: local.nowIsoFactory,
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
  });

  const { returnTo: masterReturnTo } = useMasterHandoffRestore({
    accountId,
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
    showValidationErrors: local.showValidationErrors,
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

  const reviewSession = useMatchWorkspaceReviewSession({
    accountId,
    confirmedDraftLoaded,
    dispatch,
    isInitialized,
    mode,
    notify,
    reviewKey: handoffSessionId,
    values: state.values,
    workspaceData: local.workspaceData,
  });
  const { reviewState, sessionDraft } = reviewSession;
  const submitFlow = useMatchWorkspaceSubmitFlow({
    matchId,
    mode,
    notify,
    onPersistedSuccess: sessionDraft.markCommitted,
    setConfirmOpen: local.setConfirmOpen,
    setOperationError: local.setOperationError,
    setValidationMessage: local.setValidationMessage,
    returnTo: contextualReturnTo,
    useSampleDrafts,
    values: state.values,
  });
  const {
    confirmedDraft: { confirmedDraftRedirecting, redirectConfirmedDraft },
    mutations: { updateMutation },
  } = submitFlow;

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

  const handoffNavigation = useMatchWorkspaceHandoffNavigation({
    accountId,
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
    eventDraftValue: local.eventDraftValue,
    onReviewFieldChange: reviewState.markFieldChanged,
    onReviewPlayOrderChange: reviewState.markPlayOrderChanged,
    workspaceData: local.workspaceData,
  });
  const onPrimaryAction = useMatchWorkspacePrimaryAction({
    mode,
    onValidationFailure: (path) =>
      local.setValidationFocusRequest((current) => ({
        path,
        sequence: (current?.sequence ?? 0) + 1,
      })),
    setConfirmOpen: local.setConfirmOpen,
    setShowValidationErrors: local.setShowValidationErrors,
    setValidationMessage: local.setValidationMessage,
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

  const modelInput = createMatchWorkspaceControllerModelInput({
    form: {
      handlers: formHandlers,
      local,
      validation: { validation, visibleErrorPathSet },
    },
    loading: {
      queries,
      workspace: workspaceLoading,
    },
    navigation: {
      exitHref: cancelHref,
      handoff: handoffNavigation,
      masterReturnTo,
    },
    persistence: {
      flow: submitFlow,
      onPrimaryAction,
    },
    review: {
      onRefreshStatus: refreshReviewStatus,
      session: reviewSession,
    },
    setup: {
      eventCreation: createEventMutation,
    },
    sourceImages,
    workspace: {
      mode,
      useSampleDrafts,
      view: viewModel,
    },
  });

  return buildMatchWorkspaceControllerModel(modelInput);
}

export type MatchWorkspaceController = MatchWorkspaceControllerModel;

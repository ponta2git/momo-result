import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { buildMatchWorkspacePageModel } from "@/features/matches/workspace/matchWorkspacePageModel";
import type { MatchWorkspacePageModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { buildMatchWorkspaceView } from "@/features/matches/workspace/matchWorkspaceView";
import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useMatchWorkspaceFormHandlers } from "@/features/matches/workspace/useMatchWorkspaceFormHandlers";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceLifecycleEffects } from "@/features/matches/workspace/useMatchWorkspaceLifecycleEffects";
import { useMatchWorkspaceLocalState } from "@/features/matches/workspace/useMatchWorkspaceLocalState";
import { useMatchWorkspaceMasterHandoff } from "@/features/matches/workspace/useMatchWorkspaceMasterHandoff";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useMatchWorkspaceReviewSession } from "@/features/matches/workspace/useMatchWorkspaceReviewSession";
import { useMatchWorkspaceSubmitFlow } from "@/features/matches/workspace/useMatchWorkspaceSubmitFlow";
import { useMatchWorkspaceValidation } from "@/features/matches/workspace/useMatchWorkspaceValidation";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";
import {
  heldEventPatchById,
  latestHeldEventPatch,
} from "@/features/matches/workspace/workspaceViewModel";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useAuth } from "@/shared/auth/useAuth";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

type MatchWorkspacePageModelParams = {
  matchDraftId?: string | undefined;
  matchId?: string | undefined;
  matchSessionId?: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId?: string | undefined;
};

export function useMatchWorkspacePageModel({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspacePageModelParams): MatchWorkspacePageModel {
  const [searchParams] = useSearchParams();
  const accountId = useAuth().auth?.accountId;
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const { notify } = useWorkspaceNotice();
  const local = useMatchWorkspaceLocalState();
  const { dispatch, setValidationFocusRequest, setWorkspaceData, state } = local;
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
    derived,
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
  const { isInitialized } = useMatchWorkspaceInit({
    draftDetail: draftDetailQuery.data ?? undefined,
    emptyFormFactory: local.emptyFormFactory,
    matchDetail: matchDetailQuery.data ?? undefined,
    matchDraftId,
    matchId,
    memberAliases: memberAliasesQuery.data?.items ?? [],
    mode,
    ocrDrafts: ocrDraftsQuery.data ?? undefined,
    onInitialize: initializeWorkspace,
    nowIsoFactory: local.nowIsoFactory,
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
  });

  const validationState = useMatchWorkspaceValidation({
    mode,
    showValidationErrors: local.showValidationErrors,
    values: state.values,
  });
  const view = buildMatchWorkspaceView({
    draftDetail: draftDetailQuery.data,
    gameTitleItems: gameTitlesQuery.data?.items,
    heldEventItems,
    mapItems: mapMastersQuery.data?.items,
    mode,
    reviewStatus: derived.reviewStatus,
    seasonItems: seasonMastersQuery.data?.items,
    useSampleDrafts,
    values: state.values,
  });
  const initialHeldEventPatch =
    isInitialized &&
    !hasHandoff &&
    mode !== "edit" &&
    !state.values.heldEventId &&
    !preferredHeldEventPending
      ? (heldEventPatchById(view.heldEvents, preferredHeldEventId) ??
        latestHeldEventPatch(view.heldEvents))
      : undefined;
  const draftTrackingEnabled =
    isInitialized &&
    !hasHandoff &&
    !preferredHeldEventPending &&
    initialHeldEventPatch === undefined;
  const reviewSession = useMatchWorkspaceReviewSession({
    accountId,
    confirmedDraftLoaded: view.confirmedDraftLoaded,
    dispatch,
    draftTrackingEnabled,
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
    mutations,
  } = submitFlow;

  useMatchWorkspaceLifecycleEffects({
    dispatch,
    draftDetail: draftDetailQuery.data,
    initialHeldEventPatch,
    mode,
    redirectConfirmedDraft,
    useSampleDrafts,
  });
  const masterHandoff = useMatchWorkspaceMasterHandoff({
    accountId,
    dispatch,
    handoffSessionId,
    isInitialized,
    mode,
    notify,
    onBeforeNavigate: sessionDraft.allowNavigation,
    searchParams,
    values: state.values,
  });
  const sourceImageDraftId = view.matchDraftIdForImages;
  const sourceImages = sourceImageDraftId
    ? (sourceImageQuery.data?.items ?? []).flatMap((item) => {
        const descriptor = toSourceImageDescriptor(sourceImageDraftId, item);
        return descriptor ? [descriptor] : [];
      })
    : [];
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
  const refetchDraftDetail = draftDetailQuery.refetch;
  const refetchOcrDrafts = ocrDraftsQuery.refetch;
  const refreshReviewStatus = useCallback(async () => {
    await Promise.all([refetchDraftDetail(), refetchOcrDrafts()]);
  }, [refetchDraftDetail, refetchOcrDrafts]);
  const initializationSourceFailed =
    mode !== "edit" &&
    !useSampleDrafts &&
    ((Boolean(matchDraftId) &&
      draftDetailQuery.data === undefined &&
      shouldShowQueryError(draftDetailQuery)) ||
      (mode === "review" &&
        reviewDraftIdList.length > 0 &&
        ocrDraftsQuery.data === undefined &&
        shouldShowQueryError(ocrDraftsQuery)));
  const workspaceLoading =
    confirmedDraftRedirecting ||
    view.confirmedDraftLoaded ||
    (!isInitialized && !initializationSourceFailed);
  const exitHref =
    contextualReturnTo ??
    (mode === "edit" && matchId
      ? `/matches/${encodeURIComponent(matchId)}`
      : state.values.heldEventId
        ? `/held-events/${encodeURIComponent(state.values.heldEventId)}`
        : "/matches");

  return buildMatchWorkspacePageModel({
    draftSession: sessionDraft,
    form: {
      actions: formActions,
      focusRequest: local.validationFocusRequest,
      state,
      validation: validationState,
      validationMessage: local.validationMessage,
      workspaceData: local.workspaceData,
    },
    loading: {
      base: {
        errors: derived.baseErrors,
        retrying: derived.retryingBaseQueries,
        onRetry: derived.retryBaseQueries,
      },
      edit: {
        failureKind: derived.editLoadFailureKind,
        loading: mode === "edit" && isInitialQueryLoading(matchDetailQuery),
        retrying: matchDetailQuery.isFetching,
        onRetry: derived.retryEdit,
      },
      workspaceLoading,
      workspaceBlocked: initializationSourceFailed,
    },
    navigation: {
      exitHref,
      masters: {
        pending: masterHandoff.isPending,
        returnAvailable: masterHandoff.returnAvailable,
        onNavigate: masterHandoff.navigateToMasters,
      },
    },
    persistence: {
      busy: mutations.isMutating,
      cancellation: {
        confirmOpen: local.cancelDraftConfirmOpen,
        pending: mutations.cancelDraftMutation.isPending,
        onConfirm: submitFlow.cancelDraftConfirmed,
        onOpenChange: local.setCancelDraftConfirmOpen,
        onTrigger: () => local.setCancelDraftConfirmOpen(true),
      },
      confirmation: {
        open: local.confirmOpen,
        onClose: () => local.setConfirmOpen(false),
        onConfirm: submitFlow.confirmAction,
      },
      error: local.operationError,
      onPrimaryAction,
    },
    review: {
      blocked: derived.isOcrRunningBlocked,
      state: reviewState,
      statusRefresh: {
        pending: derived.refreshingReviewStatus,
        onRefresh: refreshReviewStatus,
      },
    },
    setup: {
      eventCreation: {
        draftValue: local.eventDraftValue,
        pending: createEventMutation.isPending,
        onDraftChange: local.setEventDraftValue,
      },
      heldEventPicker: queries.heldEventPicker,
    },
    sourceImages: {
      items: sourceImages,
      loading: sourceImageQuery.isLoading,
      preferredKind: local.preferredImageKind,
      onPreferredKindChange: local.setPreferredImageKind,
    },
    workspace: { mode, useSampleDrafts, view },
  });
}

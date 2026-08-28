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
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

type MatchWorkspacePageModelParams = {
  accountId?: string | undefined;
  matchDraftId?: string | undefined;
  matchId?: string | undefined;
  matchSessionId?: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId?: string | undefined;
};

export function useMatchWorkspacePageModel({
  accountId,
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
  preferredHeldEventId,
}: MatchWorkspacePageModelParams): MatchWorkspacePageModel {
  const [searchParams] = useSearchParams();
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const { notify } = useWorkspaceNotice();
  const local = useMatchWorkspaceLocalState();
  const { dispatch, setValidationFocusRequest, setWorkspaceData, state } = local;
  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const hasHandoff = searchParams.has("handoffId");
  const handoffSessionId = matchSessionId ?? matchDraftId ?? mode;
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
    searchParams,
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
  const { isInitialized } = useMatchWorkspaceInit({
    draftDetail,
    emptyFormFactory: local.emptyFormFactory,
    matchDetail,
    matchDraftId,
    memberAliases,
    mode,
    ocrDrafts,
    onInitialize: initializeWorkspace,
    nowIsoFactory: local.nowIsoFactory,
    reviewDraftIdList: remoteReview.draftIdList,
    reviewDraftIds: remoteReview.draftIds,
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
    mode,
    reviewStatus: remoteReview.status,
    seasonItems,
    useSampleDrafts,
    values: state.values,
  });
  const initialHeldEventPatch =
    isInitialized &&
    !hasHandoff &&
    mode !== "edit" &&
    !state.values.heldEventId &&
    !load.preferredHeldEventPending
      ? (heldEventPatchById(view.heldEvents, preferredHeldEventId) ??
        latestHeldEventPatch(view.heldEvents))
      : undefined;
  const draftTrackingEnabled =
    isInitialized &&
    !hasHandoff &&
    !load.preferredHeldEventPending &&
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
    draftDetail,
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
    ? (sourceImageItems ?? []).flatMap((item) => {
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
  const workspaceLoading =
    confirmedDraftRedirecting ||
    view.confirmedDraftLoaded ||
    (!isInitialized && !load.initializationFailed);
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
      base: load.base,
      edit: load.edit,
      workspaceLoading,
      workspaceBlocked: load.initializationFailed,
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
      busy: mutations.isMutating || submitFlow.confirmation.pending,
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
        onConfirm: submitFlow.confirmation.action,
        pending: submitFlow.confirmation.pending,
      },
      error: local.operationError,
      onPrimaryAction,
    },
    review: {
      blocked: remoteReview.blocked,
      state: reviewState,
      statusRefresh: remoteReview.refresh,
    },
    setup: {
      eventCreation: {
        draftValue: local.eventDraftValue,
        pending: createEventMutation.isPending,
        onDraftChange: local.setEventDraftValue,
      },
      heldEventPicker,
    },
    sourceImages: {
      items: sourceImages,
      loading: load.sourceImagesLoading,
      preferredKind: local.preferredImageKind,
      onPreferredKindChange: local.setPreferredImageKind,
    },
    workspace: { mode, useSampleDrafts, view },
  });
}

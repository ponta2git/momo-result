import { useQueryClient } from "@tanstack/react-query";
import {
  useActionState,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  confirmedDraftDestination,
  confirmedDraftMessages,
} from "@/features/matches/confirmedDraftNavigation";
import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import { toConfirmMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type {
  IncidentKey,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceHandoffNavigation } from "@/features/matches/workspace/useMatchWorkspaceHandoffNavigation";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import { useMatchWorkspacePrimaryAction } from "@/features/matches/workspace/useMatchWorkspacePrimaryAction";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import { useWorkspaceNotice } from "@/features/matches/workspace/useWorkspaceNotice";
import {
  currentLocalIsoMinute,
  toIsoFromLocal,
} from "@/features/matches/workspace/workspaceDerivations";
import {
  buildWorkspacePageCopy,
  latestHeldEventPatch,
} from "@/features/matches/workspace/workspaceViewModel";
import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { getMatchDraftDetail } from "@/shared/api/matchDrafts";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { matchKeys } from "@/shared/api/queryKeys";
import { isCancelableDraftStatus } from "@/shared/domain/draftStatus";

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { notice, notify } = useWorkspaceNotice();
  const [validationMessage, setValidationMessage] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmedDraftRedirecting, setConfirmedDraftRedirecting] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState<string>(currentLocalIsoMinute);
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const redirectedConfirmedDraftRef = useRef<string | null>(null);
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

  const fetchLatestDraftDetail = useCallback(
    (draftId: string) =>
      queryClient.fetchQuery({
        queryKey: matchKeys.draft.detail(draftId),
        queryFn: ({ signal }) => getMatchDraftDetail(draftId, { signal }),
        staleTime: 0,
      }),
    [queryClient],
  );

  const redirectConfirmedDraft = useCallback(
    (detail: MatchDraftDetailResponse | undefined, message: string): boolean => {
      const destination = confirmedDraftDestination(detail);
      if (!destination) {
        return false;
      }
      if (redirectedConfirmedDraftRef.current === destination.matchId) {
        return true;
      }

      redirectedConfirmedDraftRef.current = destination.matchId;
      setConfirmedDraftRedirecting(true);
      void invalidateAfterMatchConfirmed(queryClient);
      notify(message, "warning");
      navigate(destination.path, { replace: true });
      return true;
    },
    [navigate, notify, queryClient],
  );

  const handleConfirmConflict = useCallback(
    async (draftId: string): Promise<boolean> => {
      try {
        const detail = await fetchLatestDraftDetail(draftId);
        return redirectConfirmedDraft(detail, confirmedDraftMessages.confirmConflict);
      } catch {
        return false;
      }
    },
    [fetchLatestDraftDetail, redirectConfirmedDraft],
  );

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

  const ensureDraftIsOpenForConfirm = useCallback(
    async (draftId: string | undefined): Promise<boolean> => {
      if (!draftId || useSampleDrafts) {
        return true;
      }

      setValidationMessage("");
      try {
        const detail = await fetchLatestDraftDetail(draftId);
        return !redirectConfirmedDraft(detail, confirmedDraftMessages.confirmConflict);
      } catch {
        setValidationMessage(confirmedDraftMessages.statusCheckFailed);
        return false;
      }
    },
    [fetchLatestDraftDetail, redirectConfirmedDraft, useSampleDrafts],
  );

  const [, confirmAction] = useActionState<null, FormData>(async () => {
    const request = toConfirmMatchRequest(state.values);
    const canConfirm = await ensureDraftIsOpenForConfirm(request.matchDraftId);
    if (!canConfirm) {
      return null;
    }

    await confirmMutation.mutateAsync(request).catch(() => undefined);
    return null;
  }, null);

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

  const deferredValuesForValidation = useDeferredValue(state.values);
  const validation = useMemo(
    () => validateMatchForm(deferredValuesForValidation),
    [deferredValuesForValidation],
  );
  const emptyErrorPathSet = useMemo(() => new Set<string>(), []);
  const visibleErrorPathSet =
    showValidationErrors || mode !== "create" ? validation.pathSet : emptyErrorPathSet;
  const heldEvents = useMemo(
    () => heldEventsQuery.data?.items ?? [],
    [heldEventsQuery.data?.items],
  );
  const gameTitleItems = gameTitlesQuery.data?.items ?? [];
  const mapItems = mapMastersQuery.data?.items ?? [];
  const seasonItems = seasonMastersQuery.data?.items ?? [];
  const selectedHeldEvent = heldEvents.find((event) => event.id === state.values.heldEventId);
  const selectedGameTitle = gameTitleItems.find((item) => item.id === state.values.gameTitleId);
  const selectedMap = mapItems.find((item) => item.id === state.values.mapMasterId);
  const selectedSeason = seasonItems.find((item) => item.id === state.values.seasonMasterId);
  const matchDraftIdForImages = state.values.matchDraftId;
  const hasSourceImagePanel = mode !== "edit" && Boolean(matchDraftIdForImages);
  const confirmedDraftLoaded =
    mode !== "edit" &&
    !useSampleDrafts &&
    Boolean(confirmedDraftDestination(draftDetailQuery.data));

  useEffect(() => {
    if (mode === "edit" || useSampleDrafts) {
      return;
    }
    redirectConfirmedDraft(draftDetailQuery.data, confirmedDraftMessages.loadRedirect);
  }, [draftDetailQuery.data, mode, redirectConfirmedDraft, useSampleDrafts]);

  useEffect(() => {
    if (
      !isInitialized ||
      hasHandoff ||
      mode === "edit" ||
      state.values.heldEventId ||
      heldEvents.length === 0
    ) {
      return;
    }
    const patch = latestHeldEventPatch(heldEvents);
    if (!patch) {
      return;
    }
    dispatch({
      patch,
      type: "patch_root",
    });
  }, [hasHandoff, heldEvents, isInitialized, mode, state.values.heldEventId]);

  const canCancelDraft =
    mode !== "edit" &&
    !useSampleDrafts &&
    Boolean(draftDetailQuery.data) &&
    Boolean(state.values.matchDraftId) &&
    isCancelableDraftStatus(reviewStatus);

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

  const pageCopy = buildWorkspacePageCopy({ mode, reviewStatus });

  const sourceImages =
    matchDraftIdForImages === undefined
      ? []
      : (sourceImageQuery.data?.items ?? []).flatMap((item) => {
          const descriptor = toSourceImageDescriptor(matchDraftIdForImages, item);
          return descriptor ? [descriptor] : [];
        });

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const onCreateEvent = useCallback(() => {
    createEventMutation.mutate({
      heldAt: toIsoFromLocal(eventDraftValue),
    });
  }, [createEventMutation, eventDraftValue]);
  const onGameTitleChange = useCallback((gameTitleId: string) => {
    dispatch({
      patch: {
        gameTitleId,
        mapMasterId: "",
        seasonMasterId: "",
      },
      type: "patch_root",
    });
  }, []);
  const onIncidentChange = useCallback((index: number, key: IncidentKey, value: number) => {
    dispatch({ index, key, type: "patch_incident", value });
  }, []);
  const onPatchRoot = useCallback(
    (patch: Partial<typeof state.values>) => dispatch({ patch, type: "patch_root" }),
    [],
  );
  const onPlayerChange = useCallback(
    (index: number, patch: Partial<(typeof state.values.players)[number]>) =>
      dispatch({ index, patch, type: "patch_player" }),
    [],
  );
  const onPlayOrderChange = useCallback(
    (index: number, playOrder: number) =>
      dispatch(
        workspaceData?.incidentByPlayOrder
          ? {
              incidentByPlayOrder: workspaceData.incidentByPlayOrder,
              index,
              playOrder,
              type: "sync_incidents_from_play_order",
            }
          : {
              index,
              playOrder,
              type: "set_play_order",
            },
      ),
    [workspaceData?.incidentByPlayOrder],
  );
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
    baseErrors,
    canCancelDraft,
    cancelDraftConfirmOpen,
    cancelDraftMutation,
    closeConfirm,
    confirmAction,
    confirmOpen,
    createEventMutation,
    editLoadFailed: mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery),
    editLoading: mode === "edit" && isInitialQueryLoading(matchDetailQuery),
    eventDraftValue,
    gameTitleItems,
    hasSourceImagePanel,
    handleCancelDraftConfirmed,
    handleNavigateToMasters,
    isInitialized,
    isNavigatingToMasters,
    isMutating,
    isOcrRunningBlocked,
    heldEvents,
    mapItems,
    matchDraftIdForImages,
    notice,
    pageDescription: pageCopy.description,
    pageTitle: pageCopy.title,
    preferredImageKind,
    refreshReviewStatus,
    refreshingReviewStatus,
    returnTo,
    reviewStatus,
    seasonItems,
    selectedGameTitle,
    selectedHeldEvent,
    selectedMap,
    selectedSeason,
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
    onCreateEvent,
    onGameTitleChange,
    onIncidentChange,
    onPatchRoot,
    onPlayerChange,
    onPlayOrderChange,
    onPrimaryAction,
  };
}

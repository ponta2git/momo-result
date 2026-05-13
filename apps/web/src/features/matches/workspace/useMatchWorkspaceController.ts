import {
  useActionState,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

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

  const { notice, notify } = useWorkspaceNotice();
  const [validationMessage, setValidationMessage] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState<string>(currentLocalIsoMinute);
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const [state, dispatch] = useReducer(
    matchFormReducer,
    createMatchFormReducerState(createEmptyMatchForm(new Date().toISOString())),
  );

  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const hasHandoff = searchParams.has("handoffId");

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
      onConfirmSuccess: () => setConfirmOpen(false),
      onError: setValidationMessage,
    });

  const [, confirmAction] = useActionState<null, FormData>(async () => {
    await confirmMutation.mutateAsync(toConfirmMatchRequest(state.values));
    return null;
  }, null);

  const { isInitialized } = useMatchWorkspaceInit({
    draftDetail: draftDetailQuery.data ?? undefined,
    draftDetailLoading: draftDetailQuery.isLoading,
    emptyFormFactory: () => createEmptyMatchForm(new Date().toISOString()),
    matchDetail: matchDetailQuery.data ?? undefined,
    matchDraftId,
    matchId,
    memberAliases: memberAliasesQuery.data?.items ?? [],
    mode,
    ocrDrafts: ocrDraftsQuery.data ?? undefined,
    ocrDraftsError: ocrDraftsQuery.isError,
    onInitialize: (values, workspaceInitial) => {
      dispatch({ payload: values, type: "replace" });
      setWorkspaceData(workspaceInitial);
    },
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
  });

  const { returnTo } = useMasterHandoffRestore({
    isInitialized,
    matchSessionId,
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

  const handleNavigateToMasters = useMatchWorkspaceHandoffNavigation({
    matchDraftId,
    matchSessionId,
    mode,
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
  const onRequestSubmitFocus = useCallback(() => {
    const action = document.getElementById("workspace-primary-action");
    action?.focus();
  }, []);

  return {
    baseErrors,
    canCancelDraft,
    cancelDraftConfirmOpen,
    cancelDraftMutation,
    closeConfirm,
    confirmAction,
    confirmOpen,
    createEventMutation,
    draftDetailQuery,
    eventDraftValue,
    gameTitleItems,
    hasSourceImagePanel,
    handleCancelDraftConfirmed,
    handleNavigateToMasters,
    isMutating,
    isOcrRunningBlocked,
    heldEvents,
    mapItems,
    matchDetailQuery,
    matchDraftIdForImages,
    notice,
    ocrDraftsQuery,
    pageDescription: pageCopy.description,
    pageTitle: pageCopy.title,
    preferredImageKind,
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
    sourceImageQuery,
    sourceImages,
    state,
    updateMutation,
    useSampleDrafts,
    validation,
    validationMessage,
    visibleErrorPathSet,
    workspaceData,
    onCreateEvent,
    onGameTitleChange,
    onIncidentChange,
    onPatchRoot,
    onPlayerChange,
    onPlayOrderChange,
    onPrimaryAction,
    onRequestSubmitFocus,
  };
}

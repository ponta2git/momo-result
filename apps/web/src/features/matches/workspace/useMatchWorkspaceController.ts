import {
  useActionState,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useTransition,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

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
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import { useWorkspaceHeldEventCreation } from "@/features/matches/workspace/useWorkspaceHeldEventCreation";
import {
  currentLocalIsoMinute,
  toIsoFromLocal,
} from "@/features/matches/workspace/workspaceDerivations";
import { isCancelableDraftStatus, reviewStatusLabel } from "@/shared/domain/draftStatus";
import { showToast } from "@/shared/ui/feedback/Toast";
import {
  buildMasterRoute,
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/masterReturnHandoff";

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
  const navigate = useNavigate();
  const [, startMastersTransition] = useTransition();
  const [searchParams] = useSearchParams();

  const [notice, setNotice] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState<string>(currentLocalIsoMinute);
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const notify = (message: string, tone: "info" | "success" | "warning" = "info") => {
    setNotice(message);
    showToast({ title: message, tone });
  };

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

  useEffect(() => {
    if (notice === "") {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    const latest = heldEvents.toSorted(
      (left, right) => new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime(),
    )[0];
    if (!latest) {
      return;
    }
    dispatch({
      patch: {
        heldEventId: latest.id,
        matchNoInEvent: latest.matchCount + 1,
        playedAt: latest.heldAt,
      },
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

  const handleNavigateToMasters = () => {
    if (!returnTo) {
      return;
    }
    const payload = createDraftReviewHandoffPayload({
      matchSessionId: matchSessionId ?? matchDraftId ?? mode,
      returnTo,
      values: state.values,
    });
    const handoffId = saveMasterHandoff(payload);
    startMastersTransition(() => {
      navigate(buildMasterRoute(returnTo, handoffId));
    });
  };

  const pageTitle =
    mode === "review" ? "OCR結果の確認" : mode === "edit" ? "試合を編集" : "試合の新規作成";
  const pageDescription =
    mode === "edit"
      ? "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。"
      : mode === "review"
        ? `読み取り結果を確認して、開催履歴と4人分の結果を確定します。現在の状態: ${reviewStatusLabel(reviewStatus)}`
        : "開催履歴と4人分の結果を入力して、確定前の確認へ進みます。";

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
  const onPrimaryAction = useCallback(() => {
    const nextValidation = validateMatchForm(state.values);
    if (!nextValidation.success) {
      setShowValidationErrors(true);
      setValidationMessage(nextValidation.firstMessage ?? "入力内容を確認してください");
      return;
    }
    setShowValidationErrors(false);
    setValidationMessage("");
    if (mode === "edit") {
      updateMutation.mutate(state.values);
      return;
    }
    setConfirmOpen(true);
  }, [mode, state.values, updateMutation]);
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
    pageDescription,
    pageTitle,
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { confirmMatch, createHeldEvent } from "@/features/draftReview/api";
import type { OcrDraftResponse } from "@/features/draftReview/api";
import { createSampleDraftMap } from "@/features/draftReview/sampleDrafts";
import {
  buildMasterRoute,
  clearHandoffIdFromSearch,
  createDraftReviewHandoffPayload,
  loadMasterHandoff,
  removeMasterHandoff,
  sanitizeReturnTo,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import type { MasterHandoffPayload } from "@/features/masters/masterReturnHandoff";
import { getMatch, updateMatch } from "@/features/matches/api";
import {
  cancelMatchDraft,
  getMatchDraftDetail,
  getOcrDraftsBulk,
  listHeldEvents,
  listMatchDraftSourceImages,
} from "@/features/matches/workspace/api";
import type { MatchDraftDetailResponse } from "@/features/matches/workspace/api";
import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import { matchDetailToMatchForm } from "@/features/matches/workspace/matchDetailToMatchForm";
import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import {
  toConfirmMatchRequest,
  toUpdateMatchRequest,
} from "@/features/matches/workspace/matchFormToRequest";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchDraftSummary,
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SlotKind } from "@/shared/api/enums";
import { slotKinds } from "@/shared/api/enums";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { assertDefined } from "@/shared/lib/invariant";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Card } from "@/shared/ui/layout/Card";

const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

function draftIdsFromParams(searchParams: URLSearchParams): Partial<Record<SlotKind, string>> {
  const ids: Partial<Record<SlotKind, string>> = {};
  const totalAssets = searchParams.get("totalAssets");
  const revenue = searchParams.get("revenue");
  const incidentLog = searchParams.get("incidentLog");
  if (totalAssets) ids.total_assets = totalAssets;
  if (revenue) ids.revenue = revenue;
  if (incidentLog) ids.incident_log = incidentLog;
  return ids;
}

function draftsByKind(
  ids: Partial<Record<SlotKind, string>>,
  drafts: OcrDraftResponse[] | undefined,
): Partial<Record<SlotKind, OcrDraftResponse>> {
  const byId = new Map((drafts ?? []).map((draft) => [draft.draftId, draft]));
  return Object.fromEntries(
    slotKinds
      .map((kind) => [kind, ids[kind] ? byId.get(ids[kind]) : undefined] as const)
      .filter(([, draft]) => draft),
  ) as Partial<Record<SlotKind, OcrDraftResponse>>;
}

function draftIdsFromDetail(
  detail: MatchDraftDetailResponse | undefined,
): Partial<Record<SlotKind, string>> {
  if (!detail) {
    return {};
  }
  return {
    ...(detail.totalAssetsDraftId ? { total_assets: detail.totalAssetsDraftId } : {}),
    ...(detail.revenueDraftId ? { revenue: detail.revenueDraftId } : {}),
    ...(detail.incidentLogDraftId ? { incident_log: detail.incidentLogDraftId } : {}),
  };
}

function toIsoFromLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function prefillFromDraftSummary(
  base: MatchFormValues,
  summary?: MatchDraftSummary,
): MatchFormValues {
  if (!summary) {
    return base;
  }

  return {
    ...base,
    gameTitleId: summary.gameTitleId ?? base.gameTitleId,
    heldEventId: summary.heldEventId ?? base.heldEventId,
    mapMasterId: summary.mapMasterId ?? base.mapMasterId,
    matchNoInEvent: summary.matchNoInEvent ?? base.matchNoInEvent,
    ownerMemberId: (summary.ownerMemberId ??
      base.ownerMemberId) as MatchFormValues["ownerMemberId"],
    playedAt: summary.playedAt ?? base.playedAt,
    seasonMasterId: summary.seasonMasterId ?? base.seasonMasterId,
  };
}

function reviewStatusLabel(status: string | undefined): string {
  if (status === "ocr_running") {
    return "OCR中";
  }
  if (status === "confirmed") {
    return "確定済み";
  }
  return "確定前";
}

function isCancelableDraftStatus(status: string | undefined): boolean {
  return ["ocr_running", "ocr_failed", "draft_ready", "needs_review"].includes(status ?? "");
}

function loadMasterHandoffFallback(handoffId: string): MasterHandoffPayload | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.sessionStorage.getItem(`momoresult.masterHandoff.${handoffId}`);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<MasterHandoffPayload>;
    if (parsed.source !== "draftReview" || !parsed.values) {
      return undefined;
    }
    return parsed as MasterHandoffPayload;
  } catch {
    return undefined;
  }
}

function findLatestDraftReviewHandoff(matchSessionId?: string): {
  handoffId: string;
  payload: MasterHandoffPayload;
} | null {
  if (typeof window === "undefined") {
    return null;
  }

  const prefix = "momoresult.masterHandoff.";
  const candidates: Array<{ handoffId: string; payload: MasterHandoffPayload }> = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (!key?.startsWith(prefix)) {
      continue;
    }

    const handoffId = key.slice(prefix.length);
    const payload = loadMasterHandoffFallback(handoffId);
    if (!payload || payload.source !== "draftReview") {
      continue;
    }

    if (matchSessionId && payload.matchSessionId !== matchSessionId) {
      continue;
    }
    candidates.push({ handoffId, payload });
  }

  if (candidates.length === 0) {
    return null;
  }

  const sorted = candidates.toSorted(
    (left, right) => Date.parse(right.payload.createdAt) - Date.parse(left.payload.createdAt),
  );
  return sorted[0] ?? null;
}

type MatchWorkspacePageProps = {
  matchDraftId?: string;
  matchId?: string;
  matchSessionId?: string;
  mode: WorkspaceMode;
};

export function MatchWorkspacePage({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
}: MatchWorkspacePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [notice, setNotice] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState("");
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const initializedKeyRef = useRef<string | null>(null);
  const processedHandoffIdsRef = useRef(new Set<string>());

  const [state, dispatch] = useReducer(
    matchFormReducer,
    createMatchFormReducerState(createEmptyMatchForm(new Date().toISOString())),
  );

  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const legacyIds = useMemo(() => draftIdsFromParams(searchParams), [searchParams]);

  const heldEventsQuery = useQuery({
    queryKey: ["held-events", "workspace"],
    queryFn: () => listHeldEvents("", 100),
  });

  const gameTitlesQuery = useQuery({
    queryKey: ["masters", "game-titles", "workspace"],
    queryFn: () => listGameTitles(),
  });

  const mapMastersQuery = useQuery({
    queryKey: ["masters", "map-masters", "workspace", state.values.gameTitleId],
    queryFn: () => listMapMasters(state.values.gameTitleId || undefined),
    enabled: Boolean(state.values.gameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: ["masters", "season-masters", "workspace", state.values.gameTitleId],
    queryFn: () => listSeasonMasters(state.values.gameTitleId || undefined),
    enabled: Boolean(state.values.gameTitleId),
  });

  const draftDetailQuery = useQuery({
    queryKey: ["match-draft-detail", matchDraftId],
    queryFn: () => {
      assertDefined(matchDraftId, "matchDraftId");
      return getMatchDraftDetail(matchDraftId);
    },
    enabled: mode !== "edit" && Boolean(matchDraftId),
  });

  const reviewDraftIds = useMemo(() => {
    const fromDetail = draftIdsFromDetail(draftDetailQuery.data);
    return {
      total_assets: legacyIds.total_assets ?? fromDetail.total_assets,
      revenue: legacyIds.revenue ?? fromDetail.revenue,
      incident_log: legacyIds.incident_log ?? fromDetail.incident_log,
    } as Partial<Record<SlotKind, string>>;
  }, [draftDetailQuery.data, legacyIds]);

  const reviewDraftIdList = useMemo(
    () =>
      slotKinds.flatMap((kind) => {
        const id = reviewDraftIds[kind];
        return id ? [id] : [];
      }),
    [reviewDraftIds],
  );

  const matchDetailQuery = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => {
      assertDefined(matchId, "matchId");
      return getMatch(matchId);
    },
    enabled: mode === "edit" && Boolean(matchId),
  });

  const ocrDraftsQuery = useQuery({
    queryKey: ["ocr-drafts-bulk", reviewDraftIdList.join(",")],
    queryFn: () => getOcrDraftsBulk(reviewDraftIdList),
    enabled: mode === "review" && !useSampleDrafts && reviewDraftIdList.length > 0,
    retry: false,
  });

  const sourceImageQuery = useQuery({
    queryKey: ["match-draft-source-images", state.values.matchDraftId],
    queryFn: () => {
      assertDefined(state.values.matchDraftId, "matchDraftId");
      return listMatchDraftSourceImages(state.values.matchDraftId);
    },
    enabled:
      Boolean(state.values.matchDraftId) &&
      mode !== "edit" &&
      draftDetailQuery.data?.status !== "ocr_running",
    retry: false,
  });

  const createEventMutation = useMutation({
    mutationFn: createHeldEvent,
    onSuccess: (event) => {
      dispatch({
        patch: {
          heldEventId: event.id,
          matchNoInEvent: event.matchCount + 1,
          playedAt: event.heldAt,
        },
        type: "patch_root",
      });
      setNotice(`開催履歴（${new Date(event.heldAt).toLocaleString()}）を作成して選択しました。`);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmMatch,
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
      await queryClient.invalidateQueries({ queryKey: ["match-draft-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["match-draft-detail"] });
      setConfirmOpen(false);
      navigate(`/matches/${encodeURIComponent(response.matchId)}`);
    },
    onError: (error) => {
      const normalized = normalizeUnknownApiError(error);
      setValidationMessage(normalized.detail || normalized.title || "確定に失敗しました");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (values: MatchFormValues) => {
      assertDefined(matchId, "matchId");
      return updateMatch(matchId, toUpdateMatchRequest(values));
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["match", matchId] });
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
      navigate(`/matches/${encodeURIComponent(response.matchId)}`);
    },
    onError: (error) => {
      const normalized = normalizeUnknownApiError(error);
      setValidationMessage(normalized.detail || normalized.title || "更新に失敗しました");
    },
  });

  const cancelDraftMutation = useMutation({
    mutationFn: (draftId: string) => cancelMatchDraft(draftId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
      await queryClient.invalidateQueries({ queryKey: ["match-draft-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["match-draft-detail"] });
      navigate("/matches", { replace: true });
    },
    onError: (error) => {
      const normalized = normalizeUnknownApiError(error);
      setValidationMessage(normalized.detail || normalized.title || "下書きの削除に失敗しました");
    },
  });

  useEffect(() => {
    if (eventDraftValue) {
      return;
    }

    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    setEventDraftValue(new Date(now.getTime() - offsetMs).toISOString().slice(0, 16));
  }, [eventDraftValue]);

  useEffect(() => {
    if (notice === "") {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const initKey = JSON.stringify({
      draftSummaryUpdatedAt: draftDetailQuery.data?.updatedAt,
      hasLegacyDrafts: reviewDraftIdList.join(","),
      matchDraftId,
      matchId,
      mode,
      sample: useSampleDrafts,
    });

    if (initializedKeyRef.current === initKey) {
      return;
    }

    if (mode === "edit") {
      if (!matchDetailQuery.data) {
        return;
      }
      dispatch({ payload: matchDetailToMatchForm(matchDetailQuery.data), type: "replace" });
      setWorkspaceData(null);
      initializedKeyRef.current = initKey;
      return;
    }

    if (mode === "create") {
      if (matchDraftId && draftDetailQuery.isLoading) {
        return;
      }

      const base = prefillFromDraftSummary(
        {
          ...createEmptyMatchForm(new Date().toISOString()),
          ...(matchDraftId ? { matchDraftId } : {}),
        },
        draftDetailQuery.data ?? undefined,
      );

      dispatch({ payload: base, type: "replace" });
      setWorkspaceData(null);
      initializedKeyRef.current = initKey;
      return;
    }

    if (mode === "review") {
      if (
        !useSampleDrafts &&
        reviewDraftIdList.length > 0 &&
        !ocrDraftsQuery.data &&
        !ocrDraftsQuery.isError
      ) {
        return;
      }

      const draftByKind = useSampleDrafts
        ? createSampleDraftMap()
        : draftsByKind(reviewDraftIds, ocrDraftsQuery.data?.items);

      const prepared = draftToMatchForm({
        draftByKind,
        ...(draftDetailQuery.data ? { draftSummary: draftDetailQuery.data } : {}),
        ...(matchDraftId ? { matchDraftId } : {}),
        nowIso: new Date().toISOString(),
      });

      dispatch({ payload: prepared.values, type: "replace" });
      setWorkspaceData(prepared.initialData);
      initializedKeyRef.current = initKey;
    }
  }, [
    draftDetailQuery.data,
    draftDetailQuery.isLoading,
    matchDetailQuery.data,
    matchDraftId,
    matchId,
    mode,
    ocrDraftsQuery.data,
    ocrDraftsQuery.isError,
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
  ]);

  const returnSearchParams = useMemo(() => clearHandoffIdFromSearch(searchParams), [searchParams]);
  const returnSearch = returnSearchParams.toString();
  const returnTo = sanitizeReturnTo(
    `${location.pathname}${returnSearch ? `?${returnSearch}` : ""}`,
  );

  useEffect(() => {
    if (mode !== "review") {
      return;
    }

    if (initializedKeyRef.current == null) {
      return;
    }

    const handoffId = searchParams.get("handoffId");
    if (!handoffId || !returnTo) {
      return;
    }
    if (processedHandoffIdsRef.current.has(handoffId)) {
      return;
    }
    processedHandoffIdsRef.current.add(handoffId);

    const payload =
      loadMasterHandoff({ expectedReturnTo: returnTo, handoffId }) ??
      loadMasterHandoff({ expectedReturnTo: location.pathname, handoffId }) ??
      loadMasterHandoffFallback(handoffId);
    const fallbackRecord = payload ? null : findLatestDraftReviewHandoff(matchSessionId);
    const restoredPayload = payload ?? fallbackRecord?.payload;
    const consumedHandoffId = handoffId ?? fallbackRecord?.handoffId;
    if (restoredPayload?.source === "draftReview") {
      dispatch({
        payload: {
          ...state.values,
          ...restoredPayload.values,
          ...(state.values.matchDraftId ? { matchDraftId: state.values.matchDraftId } : {}),
        },
        type: "replace",
      });
      setNotice("マスタ管理から戻ったため、入力内容を復元しました。");
    } else {
      setNotice("マスタ管理から戻りましたが、入力内容を復元できませんでした。");
    }

    removeMasterHandoff(consumedHandoffId ?? null);
    navigate(
      {
        pathname: location.pathname,
        search: returnSearch ? `?${returnSearch}` : "",
      },
      { replace: true },
    );
  }, [
    location.pathname,
    matchSessionId,
    mode,
    navigate,
    returnSearch,
    returnTo,
    searchParams,
    state.values,
  ]);

  const validation = validateMatchForm(state.values);
  const selectedHeldEvent = (heldEventsQuery.data?.items ?? []).find(
    (event) => event.id === state.values.heldEventId,
  );

  const reviewStatus = draftDetailQuery.data?.status;
  const isOcrRunningBlocked = mode !== "edit" && reviewStatus === "ocr_running";
  const refreshingReviewStatus = draftDetailQuery.isFetching || ocrDraftsQuery.isFetching;
  const isMutating =
    confirmMutation.isPending || updateMutation.isPending || cancelDraftMutation.isPending;
  const canCancelDraft =
    mode !== "edit" &&
    !useSampleDrafts &&
    Boolean(draftDetailQuery.data) &&
    Boolean(state.values.matchDraftId) &&
    isCancelableDraftStatus(reviewStatus);

  const baseErrors = [
    heldEventsQuery,
    gameTitlesQuery,
    mapMastersQuery,
    seasonMastersQuery,
    draftDetailQuery,
    ocrDraftsQuery,
    sourceImageQuery,
    matchDetailQuery,
  ]
    .filter(shouldShowQueryError)
    .map((query) => normalizeUnknownApiError(query.error));

  if (mode === "edit" && isInitialQueryLoading(matchDetailQuery)) {
    return <p className="p-8 text-[var(--color-text-secondary)]">読み込み中...</p>;
  }

  if (mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery)) {
    return (
      <div className="p-8">
        <p className="text-[var(--color-danger)]">試合が見つかりませんでした</p>
        <Link className="text-[var(--color-action)] hover:underline" to="/matches">
          一覧に戻る
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <LiveRegion message={notice || validationMessage} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={labelClass}>
            {mode === "review"
              ? "Match Review Workspace"
              : mode === "edit"
                ? "Match Edit Workspace"
                : "Match Create Workspace"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-balance text-[var(--color-text-primary)]">
            {mode === "review"
              ? "OCR下書き確認"
              : mode === "edit"
                ? "試合を編集"
                : "試合の新規作成"}
          </h1>
          <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
            1試合フォームを共通基盤で処理します。ステータス: {reviewStatusLabel(reviewStatus)}
          </p>
          {useSampleDrafts ? (
            <p className="mt-2 inline-flex rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              開発用サンプル下書きで表示中
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="text-sm font-semibold text-[var(--color-action)] hover:underline"
            to="/matches"
          >
            ← 試合一覧へ戻る
          </Link>
          {canCancelDraft ? (
            <Button
              disabled={isMutating}
              variant="danger"
              onClick={() => {
                const targetDraftId = state.values.matchDraftId;
                if (!targetDraftId) {
                  return;
                }
                const confirmed = window.confirm(
                  "この確定前の下書きを削除します。元に戻せません。よろしいですか？",
                );
                if (!confirmed) {
                  return;
                }
                setValidationMessage("");
                cancelDraftMutation.mutate(targetDraftId);
              }}
            >
              {cancelDraftMutation.isPending ? "削除中..." : "下書きを削除"}
            </Button>
          ) : null}
          {mode === "review" && returnTo ? (
            <Button
              variant="secondary"
              onClick={() => {
                const payload = createDraftReviewHandoffPayload({
                  matchSessionId: matchSessionId ?? matchDraftId ?? "review",
                  returnTo,
                  values: {
                    draftIds: {
                      incidentLog: state.values.draftIds.incidentLog,
                      revenue: state.values.draftIds.revenue,
                      totalAssets: state.values.draftIds.totalAssets,
                    },
                    gameTitleId: state.values.gameTitleId,
                    heldEventId: state.values.heldEventId,
                    mapMasterId: state.values.mapMasterId,
                    matchNoInEvent: state.values.matchNoInEvent,
                    ownerMemberId: state.values.ownerMemberId,
                    playedAt: state.values.playedAt,
                    players: state.values.players.map((player) => ({
                      incidents: {
                        cardShop: player.incidents.cardShop,
                        cardStation: player.incidents.cardStation,
                        destination: player.incidents.destination,
                        minusStation: player.incidents.minusStation,
                        plusStation: player.incidents.plusStation,
                        suriNoGinji: player.incidents.suriNoGinji,
                      },
                      memberId: player.memberId,
                      playOrder: player.playOrder,
                      rank: player.rank,
                      revenueManYen: player.revenueManYen,
                      totalAssetsManYen: player.totalAssetsManYen,
                    })),
                    seasonMasterId: state.values.seasonMasterId,
                  },
                });
                const handoffId = saveMasterHandoff(payload);
                navigate(buildMasterRoute(returnTo, handoffId));
              }}
            >
              マスタ管理へ
            </Button>
          ) : null}
        </div>
      </header>

      {baseErrors.map((error) => (
        <div
          key={`${error.status}-${error.detail}`}
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 p-4 text-[var(--color-text-primary)]"
          role="alert"
        >
          <strong>{error.title}</strong>
          <p className="mt-1 text-sm">{error.detail}</p>
        </div>
      ))}

      {notice ? (
        <div
          className="momo-safe-top momo-safe-right fixed z-[var(--z-toast)] max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-warning)]/65 bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text-primary)] shadow-sm"
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <p>{notice}</p>
            <button
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              type="button"
              onClick={() => setNotice("")}
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}

      {isOcrRunningBlocked ? (
        <Card className="mt-5">
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            OCR中のため編集できません
          </h2>
          <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
            OCRジョブが完了するまで結果確認画面には入れません。完了後に試合一覧の「確定前」から再度開いてください。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              disabled={refreshingReviewStatus}
              variant="secondary"
              onClick={async () => {
                await Promise.all([draftDetailQuery.refetch(), ocrDraftsQuery.refetch()]);
              }}
            >
              {refreshingReviewStatus ? "更新中..." : "状態を更新"}
            </Button>
            <Link
              className="text-sm font-semibold text-[var(--color-action)] hover:underline"
              to="/matches"
            >
              試合一覧へ戻る
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <MatchSetupSection
            createEventPending={createEventMutation.isPending}
            eventDraftValue={eventDraftValue}
            gameTitleItems={gameTitlesQuery.data?.items}
            heldEvents={heldEventsQuery.data?.items ?? []}
            mapItems={mapMastersQuery.data?.items}
            seasonItems={seasonMastersQuery.data?.items}
            values={state.values}
            onCreateEvent={() =>
              createEventMutation.mutate({
                heldAt: toIsoFromLocal(eventDraftValue),
              })
            }
            onEventDraftChange={setEventDraftValue}
            onGameTitleChange={(gameTitleId) => {
              dispatch({
                patch: {
                  gameTitleId,
                  mapMasterId: "",
                  seasonMasterId: "",
                },
                type: "patch_root",
              });
            }}
            onPatchRoot={(patch) => dispatch({ patch, type: "patch_root" })}
          />

          {workspaceData?.warnings.length ? (
            <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
              <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
                {workspaceData.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
            <Card className="p-4">
              {mode === "review" ? (
                <details className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
                    OCR読み取り状況を確認
                  </summary>
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    緑=高信頼OCR / 黄=要確認 / 金=手修正
                  </p>
                </details>
              ) : null}
              <ScoreGrid
                errorPathSet={validation.pathSet}
                incidentByPlayOrder={workspaceData?.incidentByPlayOrder}
                lastSyncedPlayerIndex={state.lastSyncedPlayerIndex}
                originalPlayers={workspaceData?.originalPlayers}
                players={state.values.players}
                onIncidentChange={(index, key, value) =>
                  dispatch({ index, key, type: "patch_incident", value })
                }
                onPlayerChange={(index, patch) => dispatch({ index, patch, type: "patch_player" })}
                onPlayOrderChange={(index, playOrder) =>
                  dispatch({
                    index,
                    playOrder,
                    type: "set_play_order",
                    ...(workspaceData?.incidentByPlayOrder
                      ? { incidentByPlayOrder: workspaceData.incidentByPlayOrder }
                      : {}),
                  })
                }
                onPreferImageKindChange={setPreferredImageKind}
                onRequestSubmitFocus={() => {
                  const action = document.getElementById("workspace-primary-action");
                  action?.focus();
                }}
              />
            </Card>

            {mode !== "edit" && state.values.matchDraftId ? (
              <SourceImagePanel
                loading={sourceImageQuery.isLoading}
                preferredKind={preferredImageKind}
                sourceImages={(sourceImageQuery.data?.items ?? []).map((item) => {
                  const matchDraftIdForImages = state.values.matchDraftId;
                  assertDefined(matchDraftIdForImages, "matchDraftId");
                  return Object.assign(
                    {
                      createdAt: item.createdAt,
                      imageUrl:
                        item.imageUrl ||
                        `/api/match-drafts/${encodeURIComponent(matchDraftIdForImages)}/source-images/${encodeURIComponent(item.kind)}`,
                      kind: item.kind as SourceImageKind,
                    },
                    item.contentType ? { contentType: item.contentType } : {},
                  );
                })}
              />
            ) : null}
          </div>

          {validationMessage ? (
            <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
              {validationMessage}
            </Card>
          ) : null}

          <MatchFormActions
            actionLabel={mode === "edit" ? "保存" : "確定前チェックへ進む"}
            disabled={!validation.success}
            message={
              validation.success
                ? "確定前チェックへ進めます"
                : (validation.firstMessage ?? "入力内容を確認してください")
            }
            pending={isMutating}
            onPrimaryAction={() => {
              const nextValidation = validateMatchForm(state.values);
              if (!nextValidation.success) {
                setValidationMessage(nextValidation.firstMessage ?? "入力内容を確認してください");
                return;
              }
              setValidationMessage("");
              if (mode === "edit") {
                updateMutation.mutate(state.values);
                return;
              }
              setConfirmOpen(true);
            }}
          />
        </>
      )}

      {confirmOpen ? (
        <MatchConfirmDialog
          heldEvent={selectedHeldEvent}
          pending={confirmMutation.isPending}
          values={state.values}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => confirmMutation.mutate(toConfirmMatchRequest(state.values))}
        />
      ) : null}
    </main>
  );
}

import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import type { UseQueryResult, UseSuspenseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  dedupeWorkspaceErrors,
  draftIdsFromDetail,
  draftIdsFromParams,
} from "@/features/matches/workspace/workspaceDerivations";
import { slotKinds } from "@/shared/api/enums";
import { mergeHeldEventItems } from "@/shared/api/heldEventCache";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleListResponse,
  MapMasterListResponse,
  MemberAliasListResponse,
  SeasonMasterListResponse,
} from "@/shared/api/masters";
import type {
  MatchDraftDetailResponse,
  MatchDraftSourceImageListResponse,
} from "@/shared/api/matchDrafts";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { OcrDraftListResponse } from "@/shared/api/ocrDrafts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { shouldShowBlockingQueryError, shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDetailQueryOptions,
  heldEventDirectorySuspenseQueryOptions,
  mapMastersQueryOptions,
  matchDetailQueryOptions,
  matchDraftDetailQueryOptions,
  matchDraftSourceImagesQueryOptions,
  memberAliasesQueryOptions,
  ocrDraftsBulkQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { isOcrRunning } from "@/shared/domain/draftStatus";
import { bySlot } from "@/shared/lib/slotMap";
import type { SlotMap } from "@/shared/lib/slotMap";

export type MatchWorkspaceQueriesParams = {
  gameTitleId: string;
  matchDraftId: string | undefined;
  matchDraftSourceImagesId: string | undefined;
  matchId: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId: string | undefined;
  searchParams: URLSearchParams;
  useSampleDrafts: boolean;
};

export type MatchWorkspaceQueries = {
  draftDetailQuery: UseQueryResult<MatchDraftDetailResponse, Error>;
  gameTitlesQuery: UseSuspenseQueryResult<GameTitleListResponse, Error>;
  heldEventItems: HeldEventResponse[];
  legacyIds: SlotMap<string>;
  mapMastersQuery: UseQueryResult<MapMasterListResponse, Error>;
  memberAliasesQuery: UseSuspenseQueryResult<MemberAliasListResponse, Error>;
  matchDetailQuery: UseQueryResult<MatchDetailResponse, Error>;
  ocrDraftsQuery: UseQueryResult<OcrDraftListResponse, Error>;
  preferredHeldEventPending: boolean;
  reviewDraftIdList: string[];
  reviewDraftIds: SlotMap<string>;
  seasonMastersQuery: UseQueryResult<SeasonMasterListResponse, Error>;
  sourceImageQuery: UseQueryResult<MatchDraftSourceImageListResponse, Error>;
};

export type MatchWorkspaceQueriesDerived = {
  baseErrors: NormalizedApiError[];
  editLoadFailureKind: "notFound" | "transient" | null;
  isOcrRunningBlocked: boolean;
  retryBaseQueries: () => Promise<void>;
  retryEdit: () => void;
  retryingBaseQueries: boolean;
  refreshingReviewStatus: boolean;
  reviewStatus: string | undefined;
};

/**
 * MatchWorkspacePage が必要とするクエリと、その派生表示状態を一括で返す。
 * 純粋なクエリ宣言の集合体であり副作用は QueryClient へ閉じ込めている。
 */
export function useMatchWorkspaceQueries(
  params: MatchWorkspaceQueriesParams,
): MatchWorkspaceQueries & { derived: MatchWorkspaceQueriesDerived } {
  const {
    gameTitleId,
    matchDraftId,
    matchDraftSourceImagesId,
    matchId,
    mode,
    preferredHeldEventId,
    searchParams,
    useSampleDrafts,
  } = params;

  const legacyIds = useMemo(() => draftIdsFromParams(searchParams), [searchParams]);

  const preferredHeldEventQuery = useQuery(
    heldEventDetailQueryOptions(preferredHeldEventId, Boolean(preferredHeldEventId)),
  );
  const mapMastersQuery = useQuery(
    mapMastersQueryOptions("workspace", gameTitleId, Boolean(gameTitleId)),
  );
  const seasonMastersQuery = useQuery(
    seasonMastersQueryOptions("workspace", gameTitleId, Boolean(gameTitleId)),
  );
  const draftDetailQuery = useQuery(
    matchDraftDetailQueryOptions(matchDraftId, mode !== "edit" && !useSampleDrafts),
  );
  const matchDetailQuery = useQuery(matchDetailQueryOptions(matchId, mode === "edit"));
  const [heldEventsQuery, gameTitlesQuery, memberAliasesQuery] = useSuspenseQueries({
    queries: [
      heldEventDirectorySuspenseQueryOptions(),
      gameTitlesQueryOptions("workspace"),
      memberAliasesQueryOptions(),
    ],
  });
  const heldEventItems = mergeHeldEventItems(
    heldEventsQuery.data?.items ?? [],
    preferredHeldEventQuery.data,
  );

  const reviewDraftIds = useMemo<SlotMap<string>>(() => {
    const fromDetail = draftIdsFromDetail(draftDetailQuery.data);
    return bySlot([
      ["total_assets", legacyIds.total_assets ?? fromDetail.total_assets],
      ["revenue", legacyIds.revenue ?? fromDetail.revenue],
      ["incident_log", legacyIds.incident_log ?? fromDetail.incident_log],
    ]);
  }, [draftDetailQuery.data, legacyIds]);

  const reviewDraftIdList = useMemo(
    () =>
      slotKinds.flatMap((kind) => {
        const id = reviewDraftIds[kind];
        return id ? [id] : [];
      }),
    [reviewDraftIds],
  );

  const ocrDraftsQuery = useQuery(
    ocrDraftsBulkQueryOptions(
      reviewDraftIdList,
      mode === "review" && !useSampleDrafts && reviewDraftIdList.length > 0,
    ),
  );
  const sourceImageQuery = useQuery(
    matchDraftSourceImagesQueryOptions(
      matchDraftSourceImagesId,
      mode !== "edit" && !useSampleDrafts && !isOcrRunning(draftDetailQuery.data?.status),
    ),
  );

  const reviewStatus = draftDetailQuery.data?.status;
  const isOcrRunningBlocked = mode !== "edit" && isOcrRunning(reviewStatus);
  const refreshingReviewStatus = draftDetailQuery.isFetching || ocrDraftsQuery.isFetching;
  const baseErrors = dedupeWorkspaceErrors(
    [
      mapMastersQuery,
      seasonMastersQuery,
      draftDetailQuery,
      ocrDraftsQuery,
      sourceImageQuery,
      matchDetailQuery,
      preferredHeldEventQuery,
    ]
      .filter(shouldShowQueryError)
      .map((query) => normalizeUnknownApiError(query.error)),
  );
  const retryBaseQueries = useCallback(async () => {
    const retries: Array<Promise<unknown>> = [];
    if (mapMastersQuery.error) retries.push(mapMastersQuery.refetch());
    if (seasonMastersQuery.error) retries.push(seasonMastersQuery.refetch());
    if (draftDetailQuery.error) retries.push(draftDetailQuery.refetch());
    if (ocrDraftsQuery.error) retries.push(ocrDraftsQuery.refetch());
    if (sourceImageQuery.error) retries.push(sourceImageQuery.refetch());
    if (preferredHeldEventQuery.error) retries.push(preferredHeldEventQuery.refetch());
    await Promise.all(retries);
  }, [
    draftDetailQuery,
    mapMastersQuery,
    ocrDraftsQuery,
    preferredHeldEventQuery,
    seasonMastersQuery,
    sourceImageQuery,
  ]);
  const retryEdit = useCallback(() => {
    void matchDetailQuery.refetch();
  }, [matchDetailQuery]);
  const editLoadFailureKind =
    mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery)
      ? normalizeUnknownApiError(matchDetailQuery.error).status === 404
        ? ("notFound" as const)
        : ("transient" as const)
      : null;

  return {
    derived: {
      baseErrors,
      editLoadFailureKind,
      isOcrRunningBlocked,
      retryBaseQueries,
      retryEdit,
      retryingBaseQueries:
        mapMastersQuery.isFetching ||
        seasonMastersQuery.isFetching ||
        draftDetailQuery.isFetching ||
        ocrDraftsQuery.isFetching ||
        sourceImageQuery.isFetching ||
        preferredHeldEventQuery.isFetching,
      refreshingReviewStatus,
      reviewStatus,
    },
    draftDetailQuery,
    gameTitlesQuery,
    heldEventItems,
    legacyIds,
    mapMastersQuery,
    memberAliasesQuery,
    matchDetailQuery,
    ocrDraftsQuery,
    preferredHeldEventPending: Boolean(
      preferredHeldEventId && !preferredHeldEventQuery.data && preferredHeldEventQuery.isFetching,
    ),
    reviewDraftIdList,
    reviewDraftIds,
    seasonMastersQuery,
    sourceImageQuery,
  };
}

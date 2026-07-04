import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { UseQueryResult, UseSuspenseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  draftIdsFromDetail,
  draftIdsFromParams,
} from "@/features/matches/workspace/workspaceDerivations";
import { slotKinds } from "@/shared/api/enums";
import type { HeldEventListResponse } from "@/shared/api/heldEvents";
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
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventsQueryOptions,
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
  searchParams: URLSearchParams;
  useSampleDrafts: boolean;
};

export type MatchWorkspaceQueries = {
  draftDetailQuery: UseQueryResult<MatchDraftDetailResponse, Error>;
  gameTitlesQuery: UseSuspenseQueryResult<GameTitleListResponse, Error>;
  heldEventsQuery: UseSuspenseQueryResult<HeldEventListResponse, Error>;
  legacyIds: SlotMap<string>;
  mapMastersQuery: UseQueryResult<MapMasterListResponse, Error>;
  memberAliasesQuery: UseSuspenseQueryResult<MemberAliasListResponse, Error>;
  matchDetailQuery: UseQueryResult<MatchDetailResponse, Error>;
  ocrDraftsQuery: UseQueryResult<OcrDraftListResponse, Error>;
  reviewDraftIdList: string[];
  reviewDraftIds: SlotMap<string>;
  seasonMastersQuery: UseQueryResult<SeasonMasterListResponse, Error>;
  sourceImageQuery: UseQueryResult<MatchDraftSourceImageListResponse, Error>;
};

export type MatchWorkspaceQueriesDerived = {
  baseErrors: NormalizedApiError[];
  isOcrRunningBlocked: boolean;
  refreshingReviewStatus: boolean;
  reviewStatus: string | undefined;
};

/**
 * MatchWorkspacePage が必要とする 8 種類のクエリと、その派生表示状態を一括で返す。
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
    searchParams,
    useSampleDrafts,
  } = params;

  const legacyIds = useMemo(() => draftIdsFromParams(searchParams), [searchParams]);

  const heldEventsQuery = useSuspenseQuery(heldEventsQueryOptions("", 100, "workspace"));
  const gameTitlesQuery = useSuspenseQuery(gameTitlesQueryOptions("workspace"));
  const memberAliasesQuery = useSuspenseQuery(memberAliasesQueryOptions("workspace"));
  const mapMastersQuery = useQuery(
    mapMastersQueryOptions("workspace", gameTitleId, Boolean(gameTitleId)),
  );
  const seasonMastersQuery = useQuery(
    seasonMastersQueryOptions("workspace", gameTitleId, Boolean(gameTitleId)),
  );
  const draftDetailQuery = useQuery(
    matchDraftDetailQueryOptions(matchDraftId, mode !== "edit" && !useSampleDrafts),
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

  const matchDetailQuery = useQuery(matchDetailQueryOptions(matchId, mode === "edit"));
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
  const baseErrors = [
    mapMastersQuery,
    seasonMastersQuery,
    draftDetailQuery,
    ocrDraftsQuery,
    sourceImageQuery,
    matchDetailQuery,
  ]
    .filter(shouldShowQueryError)
    .map((query) => normalizeUnknownApiError(query.error));

  return {
    derived: {
      baseErrors,
      isOcrRunningBlocked,
      refreshingReviewStatus,
      reviewStatus,
    },
    draftDetailQuery,
    gameTitlesQuery,
    heldEventsQuery,
    legacyIds,
    mapMastersQuery,
    memberAliasesQuery,
    matchDetailQuery,
    ocrDraftsQuery,
    reviewDraftIdList,
    reviewDraftIds,
    seasonMastersQuery,
    sourceImageQuery,
  };
}

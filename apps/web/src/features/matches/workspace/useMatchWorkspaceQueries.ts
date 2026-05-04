import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { UseQueryResult, UseSuspenseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { getMatch } from "@/features/matches/api";
import { isOcrRunning } from "@/features/matches/draftStatus";
import { matchKeys } from "@/features/matches/queryKeys";
import type { MatchDraftDetailResponse } from "@/features/matches/workspace/api";
import {
  getMatchDraftDetail,
  listMatchDraftSourceImages,
} from "@/features/matches/workspace/api";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  draftIdsFromDetail,
  draftIdsFromParams,
} from "@/features/matches/workspace/workspaceDerivations";
import { slotKinds } from "@/shared/api/enums";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { getOcrDraftsBulk } from "@/shared/api/ocrDrafts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys, ocrDraftKeys } from "@/shared/api/queryKeys";
import { bySlot } from "@/shared/lib/slotMap";
import type { SlotMap } from "@/shared/lib/slotMap";
import { useResourceQuery } from "@/shared/lib/useResourceQuery";

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
  gameTitlesQuery: UseSuspenseQueryResult<Awaited<ReturnType<typeof listGameTitles>>, Error>;
  heldEventsQuery: UseSuspenseQueryResult<Awaited<ReturnType<typeof listHeldEvents>>, Error>;
  legacyIds: SlotMap<string>;
  mapMastersQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof listMapMasters>>>>;
  matchDetailQuery: UseQueryResult<Awaited<ReturnType<typeof getMatch>>, Error>;
  ocrDraftsQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getOcrDraftsBulk>>>>;
  reviewDraftIdList: string[];
  reviewDraftIds: SlotMap<string>;
  seasonMastersQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof listSeasonMasters>>>>;
  sourceImageQuery: UseQueryResult<Awaited<ReturnType<typeof listMatchDraftSourceImages>>, Error>;
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

  const heldEventsQuery = useSuspenseQuery({
    queryKey: heldEventKeys.scope("workspace"),
    queryFn: () => listHeldEvents("", 100),
  });

  const gameTitlesQuery = useSuspenseQuery({
    queryKey: ["masters", "game-titles", "workspace"],
    queryFn: () => listGameTitles(),
  });

  const mapMastersQuery = useQuery({
    queryKey: ["masters", "map-masters", "workspace", gameTitleId],
    queryFn: () => listMapMasters(gameTitleId || undefined),
    enabled: Boolean(gameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: ["masters", "season-masters", "workspace", gameTitleId],
    queryFn: () => listSeasonMasters(gameTitleId || undefined),
    enabled: Boolean(gameTitleId),
  });

  const draftDetailQuery = useResourceQuery({
    key: matchKeys.draft.detail,
    id: matchDraftId,
    fetcher: getMatchDraftDetail,
    enabled: mode !== "edit",
  });

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

  const matchDetailQuery = useResourceQuery({
    key: matchKeys.detail,
    id: matchId,
    fetcher: getMatch,
    enabled: mode === "edit",
  });

  const ocrDraftsQuery = useQuery({
    queryKey: ocrDraftKeys.bulk(reviewDraftIdList.join(",")),
    queryFn: () => getOcrDraftsBulk(reviewDraftIdList),
    enabled: mode === "review" && !useSampleDrafts && reviewDraftIdList.length > 0,
    retry: false,
  });

  const sourceImageQuery = useResourceQuery({
    key: matchKeys.draft.sourceImages,
    id: matchDraftSourceImagesId,
    fetcher: listMatchDraftSourceImages,
    enabled: mode !== "edit" && !isOcrRunning(draftDetailQuery.data?.status),
  });

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
    matchDetailQuery,
    ocrDraftsQuery,
    reviewDraftIdList,
    reviewDraftIds,
    seasonMastersQuery,
    sourceImageQuery,
  };
}

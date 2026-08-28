import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
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
  GameTitleResponse,
  MapMasterResponse,
  MemberAliasResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type {
  MatchDraftDetailResponse,
  MatchDraftSourceImageResponse,
} from "@/shared/api/matchDrafts";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { OcrDraftListResponse } from "@/shared/api/ocrDrafts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
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
import { useHeldEventPickerDirectory } from "@/shared/api/useHeldEventPickerDirectory";
import type { HeldEventPickerDirectory } from "@/shared/api/useHeldEventPickerDirectory";
import { isOcrRunning } from "@/shared/domain/draftStatus";
import { bySlot } from "@/shared/lib/slotMap";
import type { SlotMap } from "@/shared/lib/slotMap";

type MatchWorkspaceQueriesParams = {
  gameTitleId: string;
  heldEventId: string;
  matchDraftId: string | undefined;
  matchDraftSourceImagesId: string | undefined;
  matchId: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId: string | undefined;
  searchParams: URLSearchParams;
  useSampleDrafts: boolean;
};

type MatchWorkspaceQueries = {
  heldEventPicker: HeldEventPickerDirectory;
  load: {
    base: {
      errors: NormalizedApiError[];
      retrying: boolean;
      onRetry: () => Promise<void>;
    };
    edit: {
      failureKind: "notFound" | "transient" | null;
      loading: boolean;
      retrying: boolean;
      onRetry: () => void;
    };
    initializationFailed: boolean;
    preferredHeldEventPending: boolean;
    sourceImagesLoading: boolean;
  };
  resources: {
    draftDetail: MatchDraftDetailResponse | undefined;
    gameTitleItems: GameTitleResponse[] | undefined;
    heldEventItems: HeldEventResponse[];
    mapItems: MapMasterResponse[] | undefined;
    matchDetail: MatchDetailResponse | undefined;
    memberAliases: MemberAliasResponse[];
    ocrDrafts: OcrDraftListResponse | undefined;
    seasonItems: SeasonMasterResponse[] | undefined;
    sourceImageItems: MatchDraftSourceImageResponse[] | undefined;
  };
  review: {
    blocked: boolean;
    draftIdList: string[];
    draftIds: SlotMap<string>;
    refresh: { pending: boolean; onRefresh: () => Promise<void> };
    status: string | undefined;
  };
};

/**
 * Match workspace の remote state lifecycle を所有する。
 * Consumer には取得済み resource と workflow 単位の load / retry 契約だけを公開する。
 */
export function useMatchWorkspaceQueries(
  params: MatchWorkspaceQueriesParams,
): MatchWorkspaceQueries {
  const {
    gameTitleId,
    heldEventId,
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
  const mapMastersQuery = useQuery(mapMastersQueryOptions(gameTitleId, Boolean(gameTitleId)));
  const seasonMastersQuery = useQuery(seasonMastersQueryOptions(gameTitleId, Boolean(gameTitleId)));
  const draftDetailQuery = useQuery(
    matchDraftDetailQueryOptions(matchDraftId, mode !== "edit" && !useSampleDrafts),
  );
  const matchDetailQuery = useQuery(matchDetailQueryOptions(matchId, mode === "edit"));
  const [heldEventsQuery, gameTitlesQuery, memberAliasesQuery] = useSuspenseQueries({
    queries: [
      heldEventDirectorySuspenseQueryOptions(),
      gameTitlesQueryOptions(),
      memberAliasesQueryOptions(),
    ],
  });
  const heldEventItems = mergeHeldEventItems(
    heldEventsQuery.data?.items ?? [],
    preferredHeldEventQuery.data,
  );
  const heldEventPicker = useHeldEventPickerDirectory({
    selectedEvent: heldEventItems.find((event) => event.id === heldEventId),
    selectedId: heldEventId,
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
  const mapMastersError = mapMastersQuery.error;
  const refetchMapMasters = mapMastersQuery.refetch;
  const seasonMastersError = seasonMastersQuery.error;
  const refetchSeasonMasters = seasonMastersQuery.refetch;
  const draftDetailError = draftDetailQuery.error;
  const refetchDraftDetail = draftDetailQuery.refetch;
  const ocrDraftsError = ocrDraftsQuery.error;
  const refetchOcrDrafts = ocrDraftsQuery.refetch;
  const sourceImageError = sourceImageQuery.error;
  const refetchSourceImages = sourceImageQuery.refetch;
  const preferredHeldEventError = preferredHeldEventQuery.error;
  const refetchPreferredHeldEvent = preferredHeldEventQuery.refetch;
  const retryBaseQueries = useCallback(async () => {
    const retries: Array<Promise<unknown>> = [];
    if (mapMastersError) retries.push(refetchMapMasters());
    if (seasonMastersError) retries.push(refetchSeasonMasters());
    if (draftDetailError) retries.push(refetchDraftDetail());
    if (ocrDraftsError) retries.push(refetchOcrDrafts());
    if (sourceImageError) retries.push(refetchSourceImages());
    if (preferredHeldEventError) retries.push(refetchPreferredHeldEvent());
    await Promise.all(retries);
  }, [
    draftDetailError,
    mapMastersError,
    ocrDraftsError,
    preferredHeldEventError,
    refetchDraftDetail,
    refetchMapMasters,
    refetchOcrDrafts,
    refetchPreferredHeldEvent,
    refetchSeasonMasters,
    refetchSourceImages,
    seasonMastersError,
    sourceImageError,
  ]);
  const refreshReviewStatus = useCallback(async () => {
    await Promise.all([refetchDraftDetail(), refetchOcrDrafts()]);
  }, [refetchDraftDetail, refetchOcrDrafts]);
  const refetchMatchDetail = matchDetailQuery.refetch;
  const retryEdit = useCallback(() => {
    void refetchMatchDetail();
  }, [refetchMatchDetail]);
  const editLoadFailureKind =
    mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery)
      ? normalizeUnknownApiError(matchDetailQuery.error).status === 404
        ? ("notFound" as const)
        : ("transient" as const)
      : null;
  const initializationFailed =
    mode !== "edit" &&
    !useSampleDrafts &&
    ((Boolean(matchDraftId) &&
      draftDetailQuery.data === undefined &&
      shouldShowQueryError(draftDetailQuery)) ||
      (mode === "review" &&
        reviewDraftIdList.length > 0 &&
        ocrDraftsQuery.data === undefined &&
        shouldShowQueryError(ocrDraftsQuery)));

  return {
    heldEventPicker,
    load: {
      base: {
        errors: baseErrors,
        retrying:
          mapMastersQuery.isFetching ||
          seasonMastersQuery.isFetching ||
          draftDetailQuery.isFetching ||
          ocrDraftsQuery.isFetching ||
          sourceImageQuery.isFetching ||
          preferredHeldEventQuery.isFetching,
        onRetry: retryBaseQueries,
      },
      edit: {
        failureKind: editLoadFailureKind,
        loading: mode === "edit" && isInitialQueryLoading(matchDetailQuery),
        retrying: matchDetailQuery.isFetching,
        onRetry: retryEdit,
      },
      initializationFailed,
      preferredHeldEventPending: Boolean(
        preferredHeldEventId && !preferredHeldEventQuery.data && preferredHeldEventQuery.isFetching,
      ),
      sourceImagesLoading: sourceImageQuery.isLoading,
    },
    resources: {
      draftDetail: draftDetailQuery.data,
      gameTitleItems: gameTitlesQuery.data.items,
      heldEventItems,
      mapItems: mapMastersQuery.data?.items,
      matchDetail: matchDetailQuery.data,
      memberAliases: memberAliasesQuery.data.items ?? [],
      ocrDrafts: ocrDraftsQuery.data,
      seasonItems: seasonMastersQuery.data?.items,
      sourceImageItems: sourceImageQuery.data?.items,
    },
    review: {
      blocked: isOcrRunningBlocked,
      draftIdList: reviewDraftIdList,
      draftIds: reviewDraftIds,
      refresh: { pending: refreshingReviewStatus, onRefresh: refreshReviewStatus },
      status: reviewStatus,
    },
  };
}

import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  dedupeWorkspaceErrors,
  draftIdsFromDetail,
} from "@/features/matches/workspace/workspaceDerivations";
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
  heldEventSummaryQueryOptions,
  heldEventsQueryOptions,
  mapMastersQueryOptions,
  matchDetailQueryOptions,
  matchDraftReviewQueryOptions,
  memberAliasesQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { isOcrRunning } from "@/shared/domain/draftStatus";
import { slotKinds } from "@/shared/domain/ocr";
import type { SlotMap } from "@/shared/domain/slotMap";
import {
  heldEventPickerPageSize,
  useHeldEventPickerDirectory,
} from "@/shared/heldEvents/useHeldEventPickerDirectory";
import type { HeldEventPickerDirectory } from "@/shared/heldEvents/useHeldEventPickerDirectory";

type MatchWorkspaceQueriesParams = {
  gameTitleId: string;
  heldEventId: string;
  matchDraftId: string | undefined;
  matchDraftSourceImagesId: string | undefined;
  matchId: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId: string | undefined;
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
    useSampleDrafts,
  } = params;

  const preferredHeldEventQuery = useQuery(
    heldEventSummaryQueryOptions(preferredHeldEventId, Boolean(preferredHeldEventId)),
  );
  const mapMastersQuery = useQuery(mapMastersQueryOptions(gameTitleId, Boolean(gameTitleId)));
  const seasonMastersQuery = useQuery(seasonMastersQueryOptions(gameTitleId, Boolean(gameTitleId)));
  const draftReviewQuery = useQuery(
    matchDraftReviewQueryOptions(
      matchDraftId ?? matchDraftSourceImagesId,
      mode !== "edit" && !useSampleDrafts,
    ),
  );
  const draftDetail = draftReviewQuery.data?.draft;
  const ocrDrafts = useMemo(
    () => (draftReviewQuery.data ? { items: draftReviewQuery.data.ocrDrafts ?? [] } : undefined),
    [draftReviewQuery.data],
  );
  const matchDetailQuery = useQuery(matchDetailQueryOptions(matchId, mode === "edit"));
  const [heldEventsQuery, gameTitlesQuery, memberAliasesQuery] = useSuspenseQueries({
    queries: [
      heldEventsQueryOptions({ page: 1, pageSize: heldEventPickerPageSize }),
      gameTitlesQueryOptions(),
      memberAliasesQueryOptions(),
    ],
  });
  const initialHeldEventItems = mergeHeldEventItems(
    heldEventsQuery.data?.items ?? [],
    preferredHeldEventQuery.data,
  );
  const heldEventPicker = useHeldEventPickerDirectory({
    selectedEvent: initialHeldEventItems.find((event) => event.id === heldEventId),
    selectedId: heldEventId,
  });

  const heldEventItems = mergeHeldEventItems(
    initialHeldEventItems,
    heldEventPicker.selectedHeldEvent,
  );

  const reviewDraftIds = useMemo(() => draftIdsFromDetail(draftDetail), [draftDetail]);

  const reviewDraftIdList = useMemo(
    () =>
      slotKinds.flatMap((kind) => {
        const id = reviewDraftIds[kind];
        return id ? [id] : [];
      }),
    [reviewDraftIds],
  );

  const reviewStatus = draftDetail?.status;
  const isOcrRunningBlocked = mode !== "edit" && isOcrRunning(reviewStatus);
  const refreshingReviewStatus = draftReviewQuery.isFetching;
  const baseErrors = dedupeWorkspaceErrors(
    [
      mapMastersQuery,
      seasonMastersQuery,
      draftReviewQuery,
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
  const draftReviewError = draftReviewQuery.error;
  const refetchDraftReview = draftReviewQuery.refetch;
  const preferredHeldEventError = preferredHeldEventQuery.error;
  const refetchPreferredHeldEvent = preferredHeldEventQuery.refetch;
  const retryBaseQueries = useCallback(async () => {
    const retries: Array<Promise<unknown>> = [];
    if (mapMastersError) retries.push(refetchMapMasters());
    if (seasonMastersError) retries.push(refetchSeasonMasters());
    if (draftReviewError) retries.push(refetchDraftReview());
    if (preferredHeldEventError) retries.push(refetchPreferredHeldEvent());
    await Promise.all(retries);
  }, [
    draftReviewError,
    mapMastersError,
    preferredHeldEventError,
    refetchDraftReview,
    refetchMapMasters,
    refetchPreferredHeldEvent,
    refetchSeasonMasters,
    seasonMastersError,
  ]);
  const refreshReviewStatus = useCallback(async () => {
    await refetchDraftReview();
  }, [refetchDraftReview]);
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
    Boolean(matchDraftId) &&
    draftReviewQuery.data === undefined &&
    shouldShowQueryError(draftReviewQuery);

  return {
    heldEventPicker,
    load: {
      base: {
        errors: baseErrors,
        retrying:
          mapMastersQuery.isFetching ||
          seasonMastersQuery.isFetching ||
          draftReviewQuery.isFetching ||
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
      sourceImagesLoading: draftReviewQuery.isLoading,
    },
    resources: {
      draftDetail,
      gameTitleItems: gameTitlesQuery.data.items,
      heldEventItems,
      mapItems: mapMastersQuery.data?.items,
      matchDetail: matchDetailQuery.data,
      memberAliases: memberAliasesQuery.data.items ?? [],
      ocrDrafts,
      seasonItems: seasonMastersQuery.data?.items,
      sourceImageItems: draftReviewQuery.data?.sourceImages,
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

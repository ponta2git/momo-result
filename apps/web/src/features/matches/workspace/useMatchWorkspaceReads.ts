import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { latestHeldEvent } from "@/features/matches/workspace/heldEventDefaults";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  dedupeWorkspaceErrors,
  draftIdsFromDetail,
} from "@/features/matches/workspace/workspaceDerivations";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { mergeHeldEventItems, preferHeldEventItem } from "@/shared/api/heldEventCache";
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
import type { HeldEventPickerDirectory } from "@/shared/heldEvents/heldEventPickerTypes";
import type { RecordSetupChoice } from "@/shared/heldEvents/recordContext";
import {
  heldEventPickerPageSize,
  useHeldEventPickerDirectory,
} from "@/shared/heldEvents/useHeldEventPickerDirectory";
import { useRecordContext } from "@/shared/heldEvents/useRecordContext";

type MatchWorkspaceReadOptions = {
  gameTitleId: string;
  heldEventId: string;
  matchDraftId: string | undefined;
  sourceImagesDraftId: string | undefined;
  matchId: string | undefined;
  mode: WorkspaceMode;
  preferredHeldEventId: string | undefined;
  useSampleDrafts: boolean;
};

type MatchWorkspaceReads = {
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
    mastersPending: boolean;
    recordContextPending: boolean;
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
    previousMatchSetup: RecordSetupChoice | undefined;
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
export function useMatchWorkspaceReads(params: MatchWorkspaceReadOptions): MatchWorkspaceReads {
  const {
    gameTitleId,
    heldEventId,
    matchDraftId,
    sourceImagesDraftId,
    matchId,
    mode,
    preferredHeldEventId,
    useSampleDrafts,
  } = params;

  const mapMastersQuery = useQuery(mapMastersQueryOptions(gameTitleId, Boolean(gameTitleId)));
  const seasonMastersQuery = useQuery(seasonMastersQueryOptions(gameTitleId, Boolean(gameTitleId)));
  const draftReviewQuery = useQuery(
    matchDraftReviewQueryOptions(
      matchDraftId ?? sourceImagesDraftId,
      mode !== "edit" && !useSampleDrafts,
    ),
  );
  const draftDetail = draftReviewQuery.data?.draft;
  const ocrDrafts = useMemo(
    () => (draftReviewQuery.data ? { items: draftReviewQuery.data.ocrDrafts ?? [] } : undefined),
    [draftReviewQuery.data],
  );
  const matchDetailQuery = useQuery(matchDetailQueryOptions(matchId, mode === "edit"));
  const matchDetail = readDetailQuery(matchDetailQuery);
  const [heldEventsQuery, gameTitlesQuery, memberAliasesQuery] = useSuspenseQueries({
    queries: [
      heldEventsQueryOptions({ page: 1, pageSize: heldEventPickerPageSize }),
      gameTitlesQueryOptions(),
      memberAliasesQueryOptions(),
    ],
  });
  // A record in a held event, requested or chosen by default, reads that event with its matches:
  // the next match number and the previous match's conditions come from that one fresh read.
  // Editing keeps the match's own conditions; review only needs it to choose a held event.
  const pickerItems = heldEventsQuery.data?.items ?? [];
  const recordContext = useRecordContext(
    heldEventId || preferredHeldEventId || latestHeldEvent(pickerItems)?.id,
    mode === "create" || (mode === "review" && !heldEventId),
  );
  const initialHeldEventItems = preferHeldEventItem(pickerItems, recordContext.event);
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
    [mapMastersQuery, seasonMastersQuery, draftReviewQuery, matchDetailQuery]
      .filter(shouldShowQueryError)
      .map((query) => normalizeUnknownApiError(query.error))
      .concat(
        recordContext.showError && !recordContext.notFound
          ? [normalizeUnknownApiError(recordContext.error)]
          : [],
      ),
  );
  const mapMastersError = mapMastersQuery.error;
  const refetchMapMasters = mapMastersQuery.refetch;
  const seasonMastersError = seasonMastersQuery.error;
  const refetchSeasonMasters = seasonMastersQuery.refetch;
  const draftReviewError = draftReviewQuery.error;
  const refetchDraftReview = draftReviewQuery.refetch;
  const recordContextError = recordContext.showError ? recordContext.error : null;
  const refetchRecordContext = recordContext.retry;
  const retryBaseQueries = useCallback(async () => {
    const retries: Array<Promise<unknown>> = [];
    if (mapMastersError) retries.push(refetchMapMasters());
    if (seasonMastersError) retries.push(refetchSeasonMasters());
    if (draftReviewError) retries.push(refetchDraftReview());
    if (recordContextError) retries.push(refetchRecordContext());
    await Promise.all(retries);
  }, [
    draftReviewError,
    mapMastersError,
    recordContextError,
    refetchDraftReview,
    refetchMapMasters,
    refetchRecordContext,
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
    mode === "edit" && (matchDetail.notFound || shouldShowBlockingQueryError(matchDetailQuery))
      ? matchDetail.notFound
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
          recordContext.fetching,
        onRetry: retryBaseQueries,
      },
      edit: {
        failureKind: editLoadFailureKind,
        loading: mode === "edit" && isInitialQueryLoading(matchDetailQuery),
        retrying: matchDetailQuery.isFetching,
        onRetry: retryEdit,
      },
      initializationFailed,
      // A failed read is reported by the base errors, not left as a pending selection.
      mastersPending:
        Boolean(gameTitleId) && (mapMastersQuery.isPending || seasonMastersQuery.isPending),
      recordContextPending: recordContext.pending,
      sourceImagesLoading: draftReviewQuery.isLoading,
    },
    resources: {
      draftDetail,
      gameTitleItems: gameTitlesQuery.data.items,
      heldEventItems,
      mapItems: mapMastersQuery.data?.items,
      matchDetail: matchDetail.detail,
      memberAliases: memberAliasesQuery.data.items ?? [],
      ocrDrafts,
      previousMatchSetup: recordContext.previous,
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

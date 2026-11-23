import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  dedupeWorkspaceErrors,
  draftIdsFromDetail,
} from "@/features/matches/workspace/workspaceDerivations";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { preferHeldEventItem } from "@/shared/api/heldEventCache";
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
  latestHeldEventQueryOptions,
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
import { useHeldEventPickerDirectory } from "@/shared/heldEvents/useHeldEventPickerDirectory";
import { useRecordContext } from "@/shared/heldEvents/useRecordContext";

type MatchWorkspaceReadOptions = {
  initialized: boolean;
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
  heldEventPicker: HeldEventPickerDirectory & { onOpenChange: (open: boolean) => void };
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
    initialHeldEvent: HeldEventResponse | undefined;
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
    initialized,
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
  // Only OCR review resolves players from raw names when initializing the form.
  const titles = gameTitlesQueryOptions();
  const directories =
    mode === "review" ? ([titles, memberAliasesQueryOptions()] as const) : ([titles] as const);
  const [gameTitlesQuery, memberAliasesQuery] = useSuspenseQueries<[...typeof directories]>({
    queries: directories,
  });

  // A saved match or draft owns its selection. Only resolve a default for an empty new form,
  // after its draft (if any) has loaded and before the user can edit it.
  const savedId = initialized ? heldEventId : draftDetail?.heldEventId;
  const needsDefault =
    !initialized &&
    mode !== "edit" &&
    !savedId &&
    (!matchDraftId || useSampleDrafts || Boolean(draftDetail));
  const [missingPreferredId, setMissingPreferredId] = useState<string>();
  const requestedId =
    needsDefault && preferredHeldEventId !== missingPreferredId ? preferredHeldEventId : undefined;
  const needsLatest = needsDefault && !requestedId;
  const latest = useQuery({ ...latestHeldEventQueryOptions(), enabled: needsLatest });
  const latestPending = needsLatest && latest.fetchStatus !== "idle";
  const latestError = needsLatest && shouldShowQueryError(latest) ? latest.error : undefined;
  const latestId =
    needsLatest && !latestPending && !latestError ? latest.data?.latestHeldEventId : undefined;
  const needsContext = mode === "create" || needsDefault;
  const recordContext = useRecordContext(savedId || requestedId || latestId, needsContext);
  const preferredMissing = requestedId && recordContext.notFound && recordContext.confirmed;
  if (preferredMissing) {
    setMissingPreferredId(requestedId);
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const heldEventPicker = useHeldEventPickerDirectory({
    includeDirectory: pickerOpen,
    selectedEvent: recordContext.event,
    // When record-context owns the selection, its pending read already supplies the label.
    selectedId: needsContext ? (recordContext.event?.id ?? "") : heldEventId,
  });
  const heldEventItems = preferHeldEventItem(
    heldEventPicker.heldEvents,
    recordContext.event ?? heldEventPicker.selectedHeldEvent,
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
        latestError ? [normalizeUnknownApiError(latestError)] : [],
        recordContext.showError ? [normalizeUnknownApiError(recordContext.error)] : [],
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
  const refetchLatest = latest.refetch;
  const retryBaseQueries = useCallback(async () => {
    const retries: Array<Promise<unknown>> = [];
    if (latestError) retries.push(refetchLatest());
    if (mapMastersError) retries.push(refetchMapMasters());
    if (seasonMastersError) retries.push(refetchSeasonMasters());
    if (draftReviewError) retries.push(refetchDraftReview());
    if (recordContextError) retries.push(refetchRecordContext());
    await Promise.all(retries);
  }, [
    draftReviewError,
    latestError,
    refetchLatest,
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
  const initialEventFailed = needsDefault && Boolean(latestError || recordContext.showError);
  const initializationFailed =
    initialEventFailed ||
    (mode !== "edit" &&
      !useSampleDrafts &&
      Boolean(matchDraftId) &&
      draftReviewQuery.data === undefined &&
      shouldShowQueryError(draftReviewQuery));

  return {
    heldEventPicker: { ...heldEventPicker, onOpenChange: setPickerOpen },
    load: {
      base: {
        errors: baseErrors,
        retrying:
          latestPending ||
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
      recordContextPending: latestPending || Boolean(preferredMissing) || recordContext.pending,
      sourceImagesLoading: draftReviewQuery.isLoading,
    },
    resources: {
      draftDetail,
      initialHeldEvent: needsDefault && recordContext.confirmed ? recordContext.event : undefined,
      gameTitleItems: gameTitlesQuery.data.items,
      heldEventItems,
      mapItems: mapMastersQuery.data?.items,
      matchDetail: matchDetail.detail,
      memberAliases: memberAliasesQuery?.data.items ?? [],
      ocrDrafts,
      previousMatchSetup: recordContext.confirmed ? recordContext.previous : undefined,
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

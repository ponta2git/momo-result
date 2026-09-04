import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { buildHeldEventPlayerRecaps } from "@/features/heldEvents/heldEventDetailViewModel";
import type {
  HeldEventMasterNames,
  HeldEventPlayerRecap,
} from "@/features/heldEvents/heldEventDetailViewModel";
import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import type {
  HeldEventDetailResponse,
  HeldEventDraftResponse,
  HeldEventMatchResponse,
} from "@/shared/api/heldEvents";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { heldEventDetailQueryOptions } from "@/shared/api/queryOptions";
import { useMasterNameDirectory } from "@/shared/api/useMasterNameDirectory";
import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

type RefreshModel = {
  pending: boolean;
  run: () => void;
};

type HeldEventDetailEnrichmentModel =
  | { kind: "complete" }
  | { kind: "pending" }
  | {
      fields: string[];
      kind: "warning";
      refresh: RefreshModel;
    };

type HeldEventDetailFreshnessModel = { kind: "current" } | { kind: "stale"; refresh: RefreshModel };

export type HeldEventDetailReadyPageModel = {
  enrichment: HeldEventDetailEnrichmentModel;
  event: {
    detail: HeldEventDetailResponse;
    drafts: HeldEventDraftResponse[];
    emphasizeNewMatch: boolean;
    masterNames: HeldEventMasterNames;
    matches: HeldEventMatchResponse[];
    playerRecaps: HeldEventPlayerRecap[];
  };
  freshness: HeldEventDetailFreshnessModel;
  kind: "ready";
  navigation: {
    backHref: string;
    exportHref: string;
    manualEntryHref: string;
    matchesHref: string;
    ocrCaptureHref: string;
    returnTo: string;
  };
  refresh: RefreshModel;
};

type HeldEventDetailTerminalNavigation = {
  backHref: string;
  exportHref: string;
  matchesHref: string;
};

export type HeldEventDetailPageModel =
  | { kind: "loading" }
  | { kind: "notFound"; navigation: HeldEventDetailTerminalNavigation }
  | {
      kind: "loadFailed";
      navigation: HeldEventDetailTerminalNavigation;
      refresh: RefreshModel;
    }
  | HeldEventDetailReadyPageModel;

/** Maps the held-event resource and optional master-name enrichment into one screen contract. */
export function useHeldEventDetailPageModel(): HeldEventDetailPageModel {
  const { heldEventId = "" } = useParams<{ heldEventId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = currentInternalLocation(location);
  const backHref = sanitizeReturnTo(searchParams.get("returnTo")) ?? "/held-events";
  const encodedRequestedHeldEventId = encodeURIComponent(heldEventId);
  const terminalNavigation: HeldEventDetailTerminalNavigation = {
    backHref,
    exportHref: withReturnTo(
      `/exports?heldEventId=${encodedRequestedHeldEventId}&format=csv`,
      returnTo,
    ),
    matchesHref: withReturnTo(
      `/matches?heldEventId=${encodedRequestedHeldEventId}&sort=match_no_asc`,
      returnTo,
    ),
  };
  const detailQuery = useQuery(
    heldEventDetailQueryOptions(heldEventId, heldEventId.trim().length > 0),
  );
  const masters = useMasterNameDirectory();
  const refreshMasters = masters.refresh;

  const {
    data: detail,
    error: detailError,
    isError: detailIsError,
    isFetching: detailIsFetching,
    isLoading: detailIsLoading,
    refetch: refetchDetail,
  } = detailQuery;
  const matches = useMemo(
    () =>
      (detail?.matches ?? []).toSorted((left, right) => left.matchNoInEvent - right.matchNoInEvent),
    [detail?.matches],
  );
  const drafts = useMemo(
    () =>
      (detail?.drafts ?? []).toSorted(
        (left, right) =>
          (left.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) -
            (right.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) ||
          right.updatedAt.localeCompare(left.updatedAt),
      ),
    [detail?.drafts],
  );
  const masterNames: HeldEventMasterNames = masters.names;
  const playerRecaps = useMemo(() => buildHeldEventPlayerRecaps(matches), [matches]);
  const detailFailed = shouldShowQueryError({ error: detailError, isFetching: detailIsFetching });
  const failedMasterNameFields = [
    masters.failed.gameTitles ? "作品名" : undefined,
    masters.failed.seasons ? "シーズン名" : undefined,
    masters.failed.maps ? "マップ名" : undefined,
  ].filter((field): field is string => Boolean(field));
  const refreshing = detailIsFetching || masters.refreshing;
  const refresh = useCallback(() => {
    void Promise.all([refetchDetail(), refreshMasters()]);
  }, [refetchDetail, refreshMasters]);
  const retryDetail = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);

  if (
    isInitialQueryLoading({
      data: detail,
      isFetching: detailIsFetching,
      isLoading: detailIsLoading,
    })
  ) {
    return { kind: "loading" };
  }

  if (detailFailed && normalizeUnknownApiError(detailError).status === 404) {
    return { kind: "notFound", navigation: terminalNavigation };
  }

  if (
    heldEventId.trim().length === 0 ||
    shouldShowBlockingQueryError({
      data: detail,
      error: detailError,
      isError: detailIsError,
      isFetching: detailIsFetching,
    }) ||
    !detail
  ) {
    return {
      kind: "loadFailed",
      navigation: terminalNavigation,
      refresh: { pending: detailIsFetching, run: retryDetail },
    };
  }

  const encodedHeldEventId = encodeURIComponent(detail.id);
  const enrichment: HeldEventDetailEnrichmentModel =
    failedMasterNameFields.length > 0
      ? {
          fields: failedMasterNameFields,
          kind: "warning",
          refresh: { pending: masters.refreshing, run: masters.retryFailed },
        }
      : masters.initialPending
        ? { kind: "pending" }
        : { kind: "complete" };

  return {
    enrichment,
    event: {
      detail,
      drafts,
      emphasizeNewMatch: drafts.length === 0 && matches.length === 0,
      masterNames,
      matches,
      playerRecaps,
    },
    freshness: detailFailed
      ? {
          kind: "stale",
          refresh: { pending: detailIsFetching, run: retryDetail },
        }
      : { kind: "current" },
    kind: "ready",
    navigation: {
      backHref,
      exportHref: withReturnTo(`/exports?heldEventId=${encodedHeldEventId}&format=csv`, returnTo),
      manualEntryHref: withReturnTo(`/matches/new?heldEventId=${encodedHeldEventId}`, returnTo),
      matchesHref: withReturnTo(
        `/matches?heldEventId=${encodedHeldEventId}&sort=match_no_asc`,
        returnTo,
      ),
      ocrCaptureHref: heldEventOcrCaptureHref(detail.id, returnTo),
      returnTo,
    },
    refresh: { pending: refreshing, run: refresh },
  };
}

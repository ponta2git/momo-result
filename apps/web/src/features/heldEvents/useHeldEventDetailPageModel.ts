import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { buildHeldEventPlayerRecaps } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventPlayerRecap } from "@/features/heldEvents/heldEventDetailViewModel";
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
import { useRetryNotice } from "@/shared/lib/useRetryNotice";
import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

type RefreshModel = {
  disabled?: boolean;
  pending: boolean;
  run: () => void;
};

type HeldEventDetailFreshnessModel = { kind: "current" } | { kind: "stale"; refresh: RefreshModel };

export type HeldEventDetailReadyPageModel = {
  event: {
    detail: HeldEventDetailResponse;
    drafts: HeldEventDraftResponse[];
    emphasizeNewMatch: boolean;
    matches: HeldEventMatchResponse[];
    playerRecaps: HeldEventPlayerRecap[];
  };
  freshness: HeldEventDetailFreshnessModel;
  kind: "ready";
  navigation: {
    backHref: string;
    exportHref: string;
    manualEntryHref: string;
    ocrCaptureHref: string;
    returnTo: string;
  };
  refresh: RefreshModel;
};

type HeldEventDetailTerminalNavigation = {
  backHref: string;
  exportHref: string;
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

/** Maps the held-event snapshot into one screen contract. */
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
  };
  const detailQuery = useQuery(
    heldEventDetailQueryOptions(heldEventId, heldEventId.trim().length > 0),
  );

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
  const playerRecaps = useMemo(() => buildHeldEventPlayerRecaps(matches), [matches]);
  const detailFailed = useRetryNotice(
    shouldShowQueryError({ error: detailError, isFetching: detailIsFetching }),
    detailIsFetching,
    heldEventId,
  );
  const refresh = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);
  const retryDetail = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);

  if (
    !detailFailed &&
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
  return {
    event: {
      detail,
      drafts,
      emphasizeNewMatch: drafts.length === 0 && matches.length === 0,
      matches,
      playerRecaps,
    },
    freshness: detailFailed
      ? {
          kind: "stale",
          refresh: {
            disabled: detailIsFetching,
            pending: detailIsFetching,
            run: retryDetail,
          },
        }
      : { kind: "current" },
    kind: "ready",
    navigation: {
      backHref,
      exportHref: withReturnTo(`/exports?heldEventId=${encodedHeldEventId}&format=csv`, returnTo),
      manualEntryHref: withReturnTo(`/matches/new?heldEventId=${encodedHeldEventId}`, returnTo),
      ocrCaptureHref: heldEventOcrCaptureHref(detail.id, returnTo),
      returnTo,
    },
    refresh: {
      disabled: detailIsFetching,
      pending: detailIsFetching,
      run: refresh,
    },
  };
}

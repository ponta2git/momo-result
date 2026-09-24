import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { buildHeldEventPlayerRecaps } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventPlayerRecap } from "@/features/heldEvents/heldEventDetailViewModel";
import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import type { HeldEventNeighbor } from "@/shared/api/detailReadResult";
import type {
  HeldEventDetailResponse,
  HeldEventDraftResponse,
  HeldEventMatchResponse,
} from "@/shared/api/heldEvents";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventDetailQueryOptions } from "@/shared/api/queryOptions";
import { formatNavigationDateTime } from "@/shared/lib/dateTime";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";
import {
  classifyReturnTo,
  currentInternalLocation,
  isSameResourceReturnTo,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";
import type { AdjacentDestination } from "@/shared/ui/navigation/AdjacentNavigation";

type RefreshModel = {
  disabled?: boolean;
  pending: boolean;
  run: () => void;
};

type HeldEventDetailFreshnessModel = { kind: "current" } | { kind: "stale"; refresh: RefreshModel };

type HeldEventBackNavigation = {
  backHref: string;
  backLabel: string;
  backNotice: string | undefined;
};

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
  navigation: HeldEventBackNavigation & {
    adjacent: {
      previous: AdjacentDestination;
      next: AdjacentDestination;
      disabled: boolean;
      status: "ready" | "refreshing" | "failed" | "unavailable";
    };
    currentDateTime: string;
    exportHref: string;
    manualEntryHref: string;
    ocrCaptureHref: string;
    returnTo: string;
  };
  refresh: RefreshModel;
};

type HeldEventDetailTerminalNavigation = HeldEventBackNavigation & {
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

function heldEventBackLabel(href: string): string {
  switch (classifyReturnTo(href).kind) {
    case "heldEventList":
      return "開催履歴へ戻る";
    case "heldEventDetail":
      return "元の開催へ戻る";
    case "matchList":
      return "試合一覧へ戻る";
    case "matchDetail":
      return "試合結果へ戻る";
    case "seriesComparison":
      return "戦績比較へ戻る";
    default:
      return "戻る";
  }
}

function adjacentDestination(
  neighbor: HeldEventNeighbor | undefined,
  direction: "previous" | "next",
  current: HeldEventDetailResponse,
  peers: string[],
  origin: string | undefined,
  available: boolean,
): AdjacentDestination {
  const label = direction === "previous" ? "前の開催" : "次の開催";
  if (!neighbor) {
    return {
      label,
      description: available
        ? direction === "previous"
          ? "最初の開催です"
          : "最後の開催です"
        : "行き先を確認できません",
    };
  }
  return {
    label,
    description: `${formatNavigationDateTime(neighbor.heldAt, peers)}${neighbor.heldAt === current.heldAt ? `（同日時の${label}）` : ""}`,
    href: withReturnTo(`/held-events/${encodeURIComponent(neighbor.id)}`, origin),
  };
}

/** Maps one read snapshot to the visible content and independently available adjacent links. */
export function useHeldEventDetailPageModel(): HeldEventDetailPageModel {
  const { heldEventId = "" } = useParams<{ heldEventId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = currentInternalLocation(location);
  const rawOrigin = searchParams.get("returnTo");
  const requestedOrigin = sanitizeReturnTo(rawOrigin);
  const selfReturn = isSameResourceReturnTo(requestedOrigin, location.pathname);
  const origin = selfReturn ? undefined : requestedOrigin;
  const backHref = origin ?? "/held-events";
  const backNavigation = {
    backHref,
    backLabel: heldEventBackLabel(backHref),
    backNotice: selfReturn
      ? "戻り先が現在の開催のため、開催履歴へ戻ります。"
      : rawOrigin !== null && !requestedOrigin
        ? "戻り先が無効なため、開催履歴へ戻ります。"
        : undefined,
  };
  const terminalNavigation: HeldEventDetailTerminalNavigation = {
    ...backNavigation,
    exportHref: withReturnTo(
      `/exports?heldEventId=${encodeURIComponent(heldEventId)}&format=csv`,
      returnTo,
    ),
  };
  const detailQuery = useQuery(
    heldEventDetailQueryOptions(heldEventId, heldEventId.trim().length > 0),
  );
  const { detail, navigation, notFound, error } = readDetailQuery(detailQuery);
  const pending = detailQuery.isFetching || detailQuery.isPaused;
  const matches = (detail?.matches ?? []).toSorted(
    (left, right) => left.matchNoInEvent - right.matchNoInEvent,
  );
  const drafts = (detail?.drafts ?? []).toSorted(
    (left, right) =>
      (left.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) -
        (right.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
  const playerRecaps = buildHeldEventPlayerRecaps(matches);
  const detailFailed = useRetryNotice(
    shouldShowQueryError({ error, isFetching: pending }),
    pending,
    heldEventId,
  );
  const refetchDetail = detailQuery.refetch;
  const refresh = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);
  const refreshModel = { disabled: pending, pending, run: refresh };

  if (notFound) return { kind: "notFound", navigation: terminalNavigation };
  if (!detail && detailQuery.isPending && !error && heldEventId.trim().length > 0) {
    return { kind: "loading" };
  }
  if (!detail || heldEventId.trim().length === 0) {
    return { kind: "loadFailed", navigation: terminalNavigation, refresh: refreshModel };
  }

  const available = navigation?.kind === "available";
  const previous = available ? navigation.previous : undefined;
  const next = available ? navigation.next : undefined;
  const peers = [
    detail.heldAt,
    ...(previous ? [previous.heldAt] : []),
    ...(next ? [next.heldAt] : []),
  ];
  const encodedHeldEventId = encodeURIComponent(detail.id);
  return {
    event: {
      detail,
      drafts,
      emphasizeNewMatch: drafts.length === 0 && matches.length === 0,
      matches,
      playerRecaps,
    },
    freshness: detailFailed ? { kind: "stale", refresh: refreshModel } : { kind: "current" },
    kind: "ready",
    navigation: {
      ...backNavigation,
      adjacent: {
        previous: adjacentDestination(previous, "previous", detail, peers, origin, available),
        next: adjacentDestination(next, "next", detail, peers, origin, available),
        disabled: pending || Boolean(error) || !available,
        status: pending ? "refreshing" : error ? "failed" : available ? "ready" : "unavailable",
      },
      currentDateTime: formatNavigationDateTime(detail.heldAt, peers),
      exportHref: withReturnTo(`/exports?heldEventId=${encodedHeldEventId}&format=csv`, returnTo),
      manualEntryHref: withReturnTo(`/matches/new?heldEventId=${encodedHeldEventId}`, returnTo),
      ocrCaptureHref: heldEventOcrCaptureHref(detail.id, returnTo),
      returnTo,
    },
    refresh: refreshModel,
  };
}

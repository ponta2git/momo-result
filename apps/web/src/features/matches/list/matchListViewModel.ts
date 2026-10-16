import {
  buildMatchListPrimaryAction,
  buildMatchListSecondaryActions,
  matchListDetailHref,
  matchListExportHref,
  matchListReviewHref,
} from "@/features/matches/list/matchListActionPolicy";
import {
  hasMatchListWarnings,
  matchListDisplayStatus,
  matchListStatusDescription,
  matchListStatusLabel,
  normalizeMatchListStatus,
} from "@/features/matches/list/matchListStatusPolicy";
import type {
  MatchListItemView,
  MatchListSearch,
  MatchListSourceItem,
} from "@/features/matches/list/matchListTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type { MatchListResponse, MatchListSummaryResponse } from "@/shared/api/matches";
import { isInitialQueryLoading, shouldShowStaleShield } from "@/shared/api/queryErrorState";
import { memberDisplayName } from "@/shared/domain/members";
import { compact } from "@/shared/lib/compact";

type ListRead<T> = {
  data: T | undefined;
  isFetching: boolean;
  isLoading: boolean;
  isPlaceholderData: boolean;
};

/** Relates requested filters to retained reads before exposing rows, counts, or actions. */
export function resolveMatchListDisplay({
  current,
  deferred,
  locationSettling,
  list,
  summary,
}: {
  current: MatchListSearch;
  deferred: MatchListSearch;
  locationSettling: boolean;
  list: ListRead<MatchListResponse>;
  summary: ListRead<MatchListSummaryResponse>;
}) {
  const initialLoading = isInitialQueryLoading(list);
  const scopeChanging = locationSettling || list.isPlaceholderData;
  const listRefreshing = list.isFetching && !initialLoading;
  const summaryRefreshing = summary.isFetching && summary.data !== undefined;
  return {
    initialLoading,
    scopeChanging,
    sameScopeRefreshing: !scopeChanging && (listRefreshing || summaryRefreshing),
    summaryMasked:
      current.gameTitleId !== deferred.gameTitleId ||
      current.heldEventId !== deferred.heldEventId ||
      current.seasonMasterId !== deferred.seasonMasterId ||
      summary.isPlaceholderData,
    updating: shouldShowStaleShield({
      hasVisibleData: list.data !== undefined,
      isPlaceholderData: list.isPlaceholderData,
      isRefreshing: listRefreshing,
      isSettling: locationSettling,
    }),
  };
}

export function matchListHeldEventChoices(
  events: HeldEventResponse[],
  selected: HeldEventResponse | undefined,
): HeldEventResponse[] {
  return selected ? [selected, ...events.filter((event) => event.id !== selected.id)] : events;
}

export function toMatchListItemView(item: MatchListSourceItem): MatchListItemView {
  const status = normalizeMatchListStatus(item.status);
  return {
    canCancelOcr: false,
    createdAt: item.createdAt,
    displayStatus: matchListDisplayStatus(status),
    hasWarnings: hasMatchListWarnings(status),
    hasNote: item.hasNote === true,
    id: item.id,
    kind: item.kind === "match_draft" ? "match_draft" : "match",
    primaryAction: buildMatchListPrimaryAction(item, status),
    ranks: (item.ranks ?? [])
      .toSorted((left, right) => left.rank - right.rank)
      .map((rank) => ({
        displayName: memberDisplayName(rank.memberId),
        memberId: rank.memberId,
        rank: rank.rank,
      })),
    secondaryActions: buildMatchListSecondaryActions(item, status),
    status,
    statusLabel: matchListStatusLabel(status),
    updatedAt: item.updatedAt,
    ...compact({
      detailHref: matchListDetailHref(item.matchId),
      exportHref: matchListExportHref(item.matchId),
      gameTitleId: item.gameTitleId || undefined,
      gameTitleName: item.gameTitleName || undefined,
      heldAt: item.heldAt ?? item.playedAt ?? undefined,
      heldEventId: item.heldEventId || undefined,
      mapName: item.mapName || undefined,
      matchDraftId: item.matchDraftId || undefined,
      matchId: item.matchId || undefined,
      matchNoInEvent: item.matchNoInEvent || undefined,
      ownerName: item.ownerMemberId ? memberDisplayName(item.ownerMemberId) : undefined,
      reviewHref: matchListReviewHref(item.matchDraftId, status),
      seasonMasterId: item.seasonMasterId || undefined,
      seasonName: item.seasonName || undefined,
      statusDescription: matchListStatusDescription(status),
    }),
  };
}

export function toMatchListItemViews(items: MatchListSourceItem[]): MatchListItemView[] {
  return items.map((item) => toMatchListItemView(item));
}

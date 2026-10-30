import { formatGameSeason, formatMatchNo } from "@/features/matches/list/matchListFormat";
import {
  defaultMatchListSearch,
  hasMatchListConditions,
} from "@/features/matches/list/matchListSearchParams";
import type {
  MatchListItemView,
  MatchListSearch,
  MatchListSourceItem,
} from "@/features/matches/list/matchListTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { memberDisplayName } from "@/shared/domain/members";
import { compact } from "@/shared/lib/compact";
import { matchDetailHref } from "@/shared/navigation/publicIdentifiers";

type MatchListReadState = {
  available: boolean;
  loading: boolean;
  refreshing: boolean;
  fromPreviousSelection: boolean;
};

/** Relates the requested search to the retained read before exposing rows or actions. */
export function resolveMatchListDisplayState({
  locationSettling,
  list,
}: {
  locationSettling: boolean;
  list: MatchListReadState;
}) {
  const scopeChanging = locationSettling || list.fromPreviousSelection;
  return {
    initialLoading: list.loading,
    scopeChanging,
    sameScopeRefreshing: !scopeChanging && list.refreshing,
    updating:
      locationSettling || ((list.fromPreviousSelection || list.available) && list.refreshing),
  };
}

export function matchListHeldEventChoices(
  events: HeldEventResponse[],
  selected: HeldEventResponse | undefined,
): HeldEventResponse[] {
  return selected ? [selected, ...events.filter((event) => event.id !== selected.id)] : events;
}

/** The list reads confirmed matches only; rows without a match id are not navigable and dropped. */
export function toMatchListItemViews(items: MatchListSourceItem[]): MatchListItemView[] {
  return items.flatMap((item) => {
    if (!item.matchId) return [];
    const noteBody = item.noteBody?.trim() ? item.noteBody : undefined;
    return [
      {
        detailHref: matchDetailHref(item.matchId, item.publicId),
        exportHref: `/exports?matchId=${encodeURIComponent(item.matchId)}`,
        gameSeasonLabel: formatGameSeason(item.gameTitleName, item.seasonName),
        id: item.id,
        mapName: item.mapName || "マップ未設定",
        matchNoLabel: formatMatchNo(item.matchNoInEvent || undefined),
        ranks: (item.ranks ?? [])
          .toSorted((left, right) => left.rank - right.rank)
          .map((rank) => ({
            displayName: memberDisplayName(rank.memberId),
            memberId: rank.memberId,
            rank: rank.rank,
          })),
        ...compact({ heldAt: item.heldAt ?? item.playedAt ?? undefined, noteBody }),
      },
    ];
  });
}

/**
 * Export accepts one held event or one season as its scope. The list's conditions are carried
 * over only when they are exactly such a scope; otherwise the export starts from all matches.
 */
export function matchListExportLink(search: MatchListSearch): { href: string; label: string } {
  const narrowedOnly = (allowed: ReadonlyArray<keyof MatchListSearch>) =>
    !hasMatchListConditions({
      ...search,
      ...Object.fromEntries(allowed.map((key) => [key, defaultMatchListSearch[key]])),
    });
  if (search.heldEventId && narrowedOnly(["heldEventId"])) {
    return {
      href: `/exports?heldEventId=${encodeURIComponent(search.heldEventId)}`,
      label: "この条件で出力",
    };
  }
  if (search.seasonMasterId && narrowedOnly(["seasonMasterId", "gameTitleId"])) {
    return {
      href: `/exports?seasonMasterId=${encodeURIComponent(search.seasonMasterId)}`,
      label: "この条件で出力",
    };
  }
  return { href: "/exports", label: "まとめて出力" };
}

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
  MatchListLookupMaps,
  MatchListSourceItem,
} from "@/features/matches/list/matchListTypes";
import { memberDisplayName } from "@/shared/domain/members";
import { compact } from "@/shared/lib/compact";

export function toMatchListItemView(
  item: MatchListSourceItem,
  lookupMaps: MatchListLookupMaps,
): MatchListItemView {
  const status = normalizeMatchListStatus(item.status);
  const heldEvent = item.heldEventId ? lookupMaps.heldEventsById.get(item.heldEventId) : undefined;
  const gameTitle = item.gameTitleId ? lookupMaps.gameTitlesById.get(item.gameTitleId) : undefined;
  const season = item.seasonMasterId ? lookupMaps.seasonsById.get(item.seasonMasterId) : undefined;
  const map = item.mapMasterId ? lookupMaps.mapsById.get(item.mapMasterId) : undefined;
  const heldAt = heldEvent?.heldAt ?? item.playedAt;

  return {
    canCancelOcr: false,
    createdAt: item.createdAt,
    displayStatus: matchListDisplayStatus(status),
    hasWarnings: hasMatchListWarnings(status),
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
      gameTitleName: gameTitle?.name || undefined,
      heldAt: heldAt || undefined,
      heldEventId: item.heldEventId || undefined,
      mapName: map?.name || undefined,
      matchDraftId: item.matchDraftId || undefined,
      matchId: item.matchId || undefined,
      matchNoInEvent: item.matchNoInEvent || undefined,
      ownerName: item.ownerMemberId ? memberDisplayName(item.ownerMemberId) : undefined,
      reviewHref: matchListReviewHref(item.matchDraftId, status),
      seasonMasterId: item.seasonMasterId || undefined,
      seasonName: season?.name || undefined,
      statusDescription: matchListStatusDescription(status),
    }),
  };
}

export function toMatchListItemViews(
  items: MatchListSourceItem[],
  lookupMaps: MatchListLookupMaps,
): MatchListItemView[] {
  return items.map((item) => toMatchListItemView(item, lookupMaps));
}

export { sortMatchListItems } from "@/features/matches/list/matchListSort";
export { summarizeMatchList } from "@/features/matches/list/matchListSummary";

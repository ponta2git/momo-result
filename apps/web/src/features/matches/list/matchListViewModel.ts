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
  MatchListSourceItem,
} from "@/features/matches/list/matchListTypes";
import { memberDisplayName } from "@/shared/domain/members";
import { compact } from "@/shared/lib/compact";

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

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { createEmptyMatchForm, emptyIncidents } from "@/features/matches/workspace/matchFormTypes";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { fixedMembers } from "@/shared/domain/members";

export function matchDetailToMatchForm(detail: MatchDetailResponse): MatchFormValues {
  const base = createEmptyMatchForm(detail.playedAt);
  const sortedPlayers = (detail.players ?? []).toSorted(
    (left, right) => left.playOrder - right.playOrder,
  );
  const players = sortedPlayers.map((player) => ({
    incidents: {
      cardShop: player.incidents.cardShop,
      cardStation: player.incidents.cardStation,
      destination: player.incidents.destination,
      minusStation: player.incidents.minusStation,
      plusStation: player.incidents.plusStation,
      suriNoGinji: player.incidents.suriNoGinji,
    },
    memberId: player.memberId,
    playOrder: player.playOrder,
    rank: player.rank,
    revenueManYen: player.revenueManYen,
    totalAssetsManYen: player.totalAssetsManYen,
  }));

  while (players.length < 4) {
    const member = fixedMembers[players.length];
    players.push({
      incidents: emptyIncidents(),
      memberId: member?.memberId ?? base.ownerMemberId,
      playOrder: players.length + 1,
      rank: players.length + 1,
      revenueManYen: 0,
      totalAssetsManYen: 0,
    });
  }

  return {
    ...base,
    draftIds: {
      ...(detail.totalAssetsDraftId ? { totalAssets: detail.totalAssetsDraftId } : {}),
      ...(detail.revenueDraftId ? { revenue: detail.revenueDraftId } : {}),
      ...(detail.incidentLogDraftId ? { incidentLog: detail.incidentLogDraftId } : {}),
    },
    gameTitleId: detail.gameTitleId,
    heldEventId: detail.heldEventId,
    mapMasterId: detail.mapMasterId,
    matchNoInEvent: detail.matchNoInEvent,
    ownerMemberId: detail.ownerMemberId as MatchFormValues["ownerMemberId"],
    playedAt: detail.playedAt,
    players: players as MatchFormValues["players"],
    seasonMasterId: detail.seasonMasterId,
  };
}

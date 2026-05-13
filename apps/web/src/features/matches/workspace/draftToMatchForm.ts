import type {
  DraftByKind,
  MatchDraftSummary,
  MatchFormValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import { mergeDrafts } from "@/features/matches/workspace/review/reviewViewModel";
import { incidentCountsByLabelToKey } from "@/shared/domain/incidents";
import type { MemberAliasDirectory } from "@/shared/domain/memberDirectory";

export function draftToMatchForm(input: {
  draftByKind: DraftByKind;
  draftSummary?: MatchDraftSummary;
  matchDraftId?: string;
  memberDirectory?: MemberAliasDirectory;
  nowIso: string;
}): {
  initialData: MatchWorkspaceInitialData;
  values: MatchFormValues;
} {
  const merged = mergeDrafts(input.draftByKind, input.memberDirectory);
  const base = createEmptyMatchForm(input.nowIso);

  const values: MatchFormValues = {
    ...base,
    ...(input.matchDraftId ? { matchDraftId: input.matchDraftId } : {}),
    draftIds: {
      ...(input.draftByKind.total_assets
        ? { totalAssets: input.draftByKind.total_assets.draftId }
        : {}),
      ...(input.draftByKind.revenue ? { revenue: input.draftByKind.revenue.draftId } : {}),
      ...(input.draftByKind.incident_log
        ? { incidentLog: input.draftByKind.incident_log.draftId }
        : {}),
    },
    gameTitleId: input.draftSummary?.gameTitleId ?? "",
    heldEventId: input.draftSummary?.heldEventId ?? "",
    mapMasterId: input.draftSummary?.mapMasterId ?? "",
    matchNoInEvent: input.draftSummary?.matchNoInEvent ?? 1,
    ownerMemberId: (input.draftSummary?.ownerMemberId ??
      base.ownerMemberId) as MatchFormValues["ownerMemberId"],
    playedAt: input.draftSummary?.playedAt ?? base.playedAt,
    players: merged.players.map((player) => ({
      incidents: incidentCountsByLabelToKey(player.incidents),
      memberId: player.memberId as MatchFormValues["players"][number]["memberId"],
      playOrder: player.playOrder,
      rank: player.rank,
      revenueManYen: player.revenueManYen,
      totalAssetsManYen: player.totalAssetsManYen,
    })) as MatchFormValues["players"],
    seasonMasterId: input.draftSummary?.seasonMasterId ?? "",
  };

  return {
    initialData: {
      draftByKind: input.draftByKind,
      incidentByPlayOrder: merged.incidentByPlayOrder,
      originalPlayers: merged.players,
      warnings: merged.warnings,
    },
    values,
  };
}

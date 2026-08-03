import type {
  IncidentLookupEntry,
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import {
  reviewCellId,
  reviewWarningMessage,
} from "@/features/matches/workspace/review/reviewWarningModel";
import type {
  ReviewFieldEvidence,
  ReviewFieldKey,
} from "@/features/matches/workspace/review/reviewWarningModel";
import { incidentDefinitions } from "@/shared/domain/incidents";
import { memberDisplayName } from "@/shared/domain/members";

export type ReviewItem = {
  cellId: string;
  confidence: number | null;
  field: ReviewFieldKey;
  label: string;
  message: string;
  row: number;
  sourceKind: ReviewFieldEvidence["sourceKind"];
  warningCount: number;
};

function toReviewItem(args: {
  evidence: ReviewFieldEvidence | undefined;
  field: ReviewFieldKey;
  label: string;
  row: number;
}): ReviewItem | null {
  if (!args.evidence || args.evidence.warnings.length === 0) {
    return null;
  }
  const firstWarning = args.evidence.warnings[0];
  if (!firstWarning) {
    return null;
  }
  return {
    cellId: reviewCellId(args.row, args.field),
    confidence: args.evidence.confidence,
    field: args.field,
    label: args.label,
    message: reviewWarningMessage(firstWarning),
    row: args.row,
    sourceKind: args.evidence.sourceKind,
    warningCount: args.evidence.warnings.length,
  };
}

export function buildReviewItems(args: {
  incidentByPlayOrder: Map<number, IncidentLookupEntry> | undefined;
  originalPlayers: readonly OriginalPlayerSnapshot[] | undefined;
  players: MatchFormValues["players"];
}): ReviewItem[] {
  if (!args.originalPlayers) {
    return [];
  }

  return args.players.flatMap((player, row) => {
    const original = args.originalPlayers?.[row];
    if (!original) {
      return [];
    }
    const playerName = memberDisplayName(player.memberId);
    const incidentEvidence = args.incidentByPlayOrder?.get(player.playOrder)?.evidence ?? {};
    const candidates = [
      toReviewItem({
        evidence: original.evidence.member,
        field: "memberId",
        label: `${playerName} メンバー`,
        row,
      }),
      toReviewItem({
        evidence: original.evidence.playOrder,
        field: "playOrder",
        label: `${playerName} プレー順`,
        row,
      }),
      toReviewItem({
        evidence: original.evidence.rank,
        field: "rank",
        label: `${playerName} 順位`,
        row,
      }),
      toReviewItem({
        evidence: original.evidence.totalAssets,
        field: "totalAssetsManYen",
        label: `${playerName} 総資産`,
        row,
      }),
      toReviewItem({
        evidence: original.evidence.revenue,
        field: "revenueManYen",
        label: `${playerName} 収益`,
        row,
      }),
      ...incidentDefinitions.map((definition) =>
        toReviewItem({
          evidence: incidentEvidence[definition.label],
          field: `incident.${definition.key}`,
          label: `${playerName} ${definition.label}`,
          row,
        }),
      ),
    ];
    return candidates.filter((item): item is ReviewItem => item !== null);
  });
}

export function countChangedReviewCells(args: {
  incidentByPlayOrder: Map<number, IncidentLookupEntry> | undefined;
  originalPlayers: readonly OriginalPlayerSnapshot[] | undefined;
  players: MatchFormValues["players"];
}): number {
  if (!args.originalPlayers) {
    return 0;
  }
  let changed = 0;
  args.players.forEach((player, row) => {
    const original = args.originalPlayers?.[row];
    if (!original) {
      return;
    }
    if (player.memberId !== original.memberId) changed += 1;
    if (player.playOrder !== original.playOrder) changed += 1;
    if (player.rank !== original.rank) changed += 1;
    if (player.totalAssetsManYen !== original.totalAssetsManYen) changed += 1;
    if (player.revenueManYen !== original.revenueManYen) changed += 1;

    const incidentOriginal = args.incidentByPlayOrder?.get(player.playOrder)?.counts;
    for (const definition of incidentDefinitions) {
      const originalValue = incidentOriginal?.[definition.label] ?? 0;
      if (player.incidents[definition.key] !== originalValue) {
        changed += 1;
      }
    }
  });
  return changed;
}

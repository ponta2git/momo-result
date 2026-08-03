import type {
  IncidentLookupEntry,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import {
  byMemberId,
  emptyIncidents,
  numberValue,
  resolveMemberIds,
  resolvePlayOrders,
} from "@/features/matches/workspace/review/reviewDraftExtractors";
import type {
  IncidentName,
  OcrDraftPayload,
  OcrField,
  OcrWarning,
} from "@/features/matches/workspace/review/reviewDraftExtractors";
import {
  buildFieldEvidence,
  mergeFieldEvidence,
  reviewWarningMessage,
} from "@/features/matches/workspace/review/reviewWarningModel";
import type { MemberAliasDirectory } from "@/shared/domain/memberDirectory";
import { fixedMembers } from "@/shared/domain/members";

type ParsedReviewDraft = {
  payload: OcrDraftPayload;
  warnings: OcrWarning[];
};

type ParsedDrafts = {
  incidentLog: ParsedReviewDraft | undefined;
  revenue: ParsedReviewDraft | undefined;
  totalAssets: ParsedReviewDraft | undefined;
};

type ReviewFieldEvidence = ReturnType<typeof buildFieldEvidence>;

function evidenceForField<T>(args: {
  attachedWarnings: Set<OcrWarning>;
  draft: ParsedReviewDraft | undefined;
  field: OcrField<T> | undefined;
  fieldNames: readonly string[];
  playerIndex: number;
  sourceKind: "revenue" | "total_assets";
}): ReviewFieldEvidence | undefined {
  if (!args.draft || args.playerIndex < 0) {
    return undefined;
  }
  return buildFieldEvidence({
    attachedWarnings: args.attachedWarnings,
    confidence: args.field?.confidence,
    embeddedWarnings: args.field?.warnings,
    fieldNames: args.fieldNames,
    playerIndex: args.playerIndex,
    sourceKind: args.sourceKind,
    warnings: args.draft.warnings,
  });
}

export function buildReviewPlayers(
  parsed: ParsedDrafts,
  incidentByPlayOrder: Map<number, IncidentLookupEntry>,
  directory: MemberAliasDirectory,
  attachedWarnings: Set<OcrWarning>,
): { players: OriginalPlayerSnapshot[]; warnings: string[] } {
  const memberIds = directory.memberIds;
  const sourcePlayers = parsed.totalAssets?.payload.players.length
    ? parsed.totalAssets.payload.players
    : fixedMembers.map(() => undefined);
  const trimmedSources = sourcePlayers.slice(0, 4);
  const resolvedMemberIds = resolveMemberIds(trimmedSources, directory);
  const resolvedPlayOrders = resolvePlayOrders(trimmedSources);
  const revenueByMember = byMemberId(parsed.revenue?.payload, directory);

  const players = trimmedSources.map((entry, index) => {
    const memberId = resolvedMemberIds[index] ?? memberIds[index] ?? "";
    const revenueEntry = revenueByMember.entries.get(memberId);
    const revenueIndex = revenueEntry
      ? (parsed.revenue?.payload.players.indexOf(revenueEntry) ?? -1)
      : -1;
    const playOrder = resolvedPlayOrders[index] ?? index + 1;
    const incidentLookup = incidentByPlayOrder.get(playOrder);
    const incidents = incidentLookup ? { ...incidentLookup.counts } : emptyIncidents();
    const incidentConfidence: Partial<Record<IncidentName, number | null>> = incidentLookup
      ? { ...incidentLookup.confidence }
      : {};
    const rawNameEvidence = evidenceForField({
      attachedWarnings,
      draft: parsed.totalAssets,
      field: entry?.raw_player_name,
      fieldNames: ["raw_player_name"],
      playerIndex: index,
      sourceKind: "total_assets",
    });
    const memberIdEvidence = evidenceForField({
      attachedWarnings,
      draft: parsed.totalAssets,
      field: entry?.raw_player_name,
      fieldNames: ["member_id"],
      playerIndex: index,
      sourceKind: "total_assets",
    });
    const memberEvidence =
      rawNameEvidence && memberIdEvidence
        ? mergeFieldEvidence("total_assets", [rawNameEvidence, memberIdEvidence])
        : (rawNameEvidence ?? memberIdEvidence);
    const playOrderEvidence = evidenceForField({
      attachedWarnings,
      draft: parsed.totalAssets,
      field: entry?.play_order,
      fieldNames: ["play_order"],
      playerIndex: index,
      sourceKind: "total_assets",
    });
    const rankEvidence = evidenceForField({
      attachedWarnings,
      draft: parsed.totalAssets,
      field: entry?.rank,
      fieldNames: ["rank"],
      playerIndex: index,
      sourceKind: "total_assets",
    });
    const totalAssetsEvidence = evidenceForField({
      attachedWarnings,
      draft: parsed.totalAssets,
      field: entry?.total_assets_man_yen,
      fieldNames: ["total_assets_man_yen"],
      playerIndex: index,
      sourceKind: "total_assets",
    });
    const revenueEvidence = evidenceForField({
      attachedWarnings,
      draft: parsed.revenue,
      field: revenueEntry?.revenue_man_yen,
      fieldNames: ["revenue_man_yen"],
      playerIndex: revenueIndex,
      sourceKind: "revenue",
    });
    const playerWarnings = [
      ...(memberEvidence?.warnings ?? []),
      ...(playOrderEvidence?.warnings ?? []),
      ...(rankEvidence?.warnings ?? []),
      ...(totalAssetsEvidence?.warnings ?? []),
      ...(revenueEvidence?.warnings ?? []),
      ...Object.values(incidentLookup?.evidence ?? {}).flatMap(
        (fieldEvidence) => fieldEvidence?.warnings ?? [],
      ),
    ].map(reviewWarningMessage);

    return {
      confidence: {
        incidents: incidentConfidence,
        rank: entry?.rank.confidence ?? null,
        revenue: revenueEntry?.revenue_man_yen.confidence ?? null,
        totalAssets: entry?.total_assets_man_yen.confidence ?? null,
      },
      evidence: {
        incidents: incidentLookup ? { ...incidentLookup.evidence } : {},
        member: memberEvidence,
        playOrder: playOrderEvidence,
        rank: rankEvidence,
        revenue: revenueEvidence,
        totalAssets: totalAssetsEvidence,
      },
      incidents,
      memberId,
      playOrder,
      rank: numberValue(entry?.rank, index + 1),
      rawPlayerName: entry?.raw_player_name.value ?? undefined,
      revenueManYen: numberValue(revenueEntry?.revenue_man_yen, 0),
      totalAssetsManYen: numberValue(entry?.total_assets_man_yen, 0),
      warnings: playerWarnings,
    };
  });
  return { players, warnings: revenueByMember.warnings };
}

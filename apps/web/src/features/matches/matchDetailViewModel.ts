import type { MatchDetailResponse } from "@/shared/api/matches";
import type {
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisMatchContextV3,
} from "@/shared/api/seriesAnalysis";
import { matchFeatureDefinition } from "@/shared/domain/matchFeatures";
import type { MatchFeatureDefinition } from "@/shared/domain/matchFeatures";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateOnly, formatDateTimeLong } from "@/shared/lib/dateTime";
import { matchPerformanceContextFromArtifact } from "@/shared/matches/matchPerformanceContext";
import type { MatchPerformanceContextRow } from "@/shared/matches/matchPerformanceContext";
export { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";

export type MatchFeatureBadge = MatchFeatureDefinition & {
  tone: AnalysisFeature["tone"];
};
type AnalysisFeature = NonNullable<SeriesAnalysisMatchContextV3["match"]>["features"][number];

export type MatchDetailLedgerRow = MatchPerformanceContextRow & {
  displayName: string;
  playOrder: number | undefined;
  incidents: NonNullable<MatchDetailResponse["players"]>[number]["incidents"] | undefined;
};

export function buildMatchDetailLedgerRows(
  match: MatchDetailResponse,
  performance: ReturnType<typeof matchPerformanceContextFromArtifact>,
): MatchDetailLedgerRow[] {
  const rows =
    performance?.rows ??
    (match.players ?? []).map((player) => ({
      memberId: player.memberId,
      rank: player.rank,
      revenueManYen: player.revenueManYen,
      totalAssetsManYen: player.totalAssetsManYen,
      trend: "unavailable" as const,
    }));
  return rows.map((row) => {
    const player = match.players?.find((candidate) => candidate.memberId === row.memberId);
    return Object.assign({}, row, {
      displayName: memberDisplayName(row.memberId),
      playOrder: player?.playOrder,
      incidents: player?.incidents,
    });
  });
}

export function matchDeletionDisabledReason(note: { pending: boolean; dirty: boolean }) {
  return note.pending
    ? "メモの保存・削除が完了するまで、試合は削除できません。"
    : note.dirty
      ? "メモを保存するか、編集をキャンセルすると試合を削除できます。"
      : undefined;
}

export function matchFeatureAnalysisQuery(
  match: MatchDetailResponse | undefined,
  artifactId: string | undefined,
): SeriesAnalysisMatchContextQuery | undefined {
  return match && artifactId
    ? {
        artifactId,
        gameTitleId: match.gameTitleId,
        mapMasterId: match.mapMasterId,
        matchId: match.matchId,
        seasonMasterId: match.seasonMasterId,
      }
    : undefined;
}

export function buildMatchFeatureAnalysis({
  match,
  artifactId,
  context,
  calculationStatus,
  statusLoading,
  contextLoading,
}: {
  match: MatchDetailResponse | undefined;
  artifactId: string | undefined;
  context: SeriesAnalysisMatchContextV3 | undefined;
  calculationStatus: string | undefined;
  statusLoading: boolean;
  contextLoading: boolean;
}) {
  const matchingContext =
    match && context?.artifact.artifactId === artifactId && context?.matchId === match.matchId
      ? context
      : undefined;
  const performanceContext = matchPerformanceContextFromArtifact(matchingContext);
  const loading =
    statusLoading ||
    contextLoading ||
    calculationStatus === "queued" ||
    calculationStatus === "running";
  return {
    comparisonContextStatus:
      performanceContext === undefined ? (loading ? "loading" : "unavailable") : "ready",
    badges: buildMatchFeatureBadges({
      features:
        matchingContext?.inclusion.status === "included"
          ? matchingContext.match?.features
          : undefined,
    }),
    performanceContext,
  } as const;
}

export function formatMatchDetailDate(iso: string): string {
  return formatDateTimeLong(iso);
}

export function formatMatchDetailDateOnly(iso: string): string {
  return formatDateOnly(iso);
}

export function buildMatchFeatureBadges({
  features = [],
}: {
  features?: AnalysisFeature[] | undefined;
}): MatchFeatureBadge[] {
  return features.map((feature) => ({
    ...matchFeatureDefinition(feature.featureCode),
    tone: feature.tone,
  }));
}

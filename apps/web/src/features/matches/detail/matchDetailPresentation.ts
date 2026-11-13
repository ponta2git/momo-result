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

export type MatchFeatureBadge = MatchFeatureDefinition & {
  tone: AnalysisFeature["tone"];
};
type AnalysisFeature = NonNullable<SeriesAnalysisMatchContextV3["match"]>["features"][number];

/** The incident counts fill one row when the ledger card is wide enough; loading reuses it. */
/**
 * Six incidents sit as 3×2 or 6×1 by the card's width, so no single item is left on a line. The
 * column gap matches the revenue breakdown above, so their column lines meet in both layouts.
 */
export const matchIncidentFactsGridClass = "grid grid-cols-3 gap-x-4 gap-y-2 @xl:grid-cols-6";

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

export function matchAnalysisQueryParams(
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

export function buildMatchAnalysisView({
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
  const loading = statusLoading || contextLoading;
  const calculating = calculationStatus === "queued" || calculationStatus === "running";
  return {
    comparisonContextStatus:
      performanceContext !== undefined
        ? "ready"
        : loading
          ? "loading"
          : calculating
            ? "calculating"
            : "unavailable",
    // Only an in-flight read reserves space for its results; a queued calculation has no end here.
    contextPending: matchingContext === undefined && (statusLoading || contextLoading),
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

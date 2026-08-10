import type { MatchDetailResponse } from "@/shared/api/matches";
import type { SeriesAnalysisMatchContextV2 } from "@/shared/api/seriesAnalysis";
import { matchFeatureDefinition } from "@/shared/domain/matchFeatures";
import type { MatchFeatureDefinition, MatchFeatureSource } from "@/shared/domain/matchFeatures";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateOnly, formatDateTimeLong } from "@/shared/lib/dateTime";
export { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";

export type MatchDetailPlayerResult = NonNullable<MatchDetailResponse["players"]>[number];
export type MatchFeatureBadge = MatchFeatureDefinition & {
  source: MatchFeatureSource;
};
export type MatchDetailSortKey =
  | "cardShop"
  | "cardStation"
  | "destination"
  | "member"
  | "minusStation"
  | "playOrder"
  | "plusStation"
  | "rank"
  | "revenueManYen"
  | "suriNoGinji"
  | "totalAssetsManYen";

export type MatchDetailSortState = {
  direction: "asc" | "desc";
  key: MatchDetailSortKey;
};

type AnalysisFeature = NonNullable<SeriesAnalysisMatchContextV2["match"]>["features"][number];

export function formatMatchDetailDate(iso: string): string {
  return formatDateTimeLong(iso);
}

export function formatMatchDetailDateOnly(iso: string): string {
  return formatDateOnly(iso);
}

function sortValue(player: MatchDetailPlayerResult, key: MatchDetailSortKey): number | string {
  if (key === "member") return memberDisplayName(player.memberId);
  if (key in player.incidents) {
    return player.incidents[key as keyof MatchDetailPlayerResult["incidents"]];
  }
  return player[
    key as keyof Pick<
      MatchDetailPlayerResult,
      "playOrder" | "rank" | "revenueManYen" | "totalAssetsManYen"
    >
  ];
}

export function nextMatchDetailSort(
  current: MatchDetailSortState,
  key: MatchDetailSortKey,
): MatchDetailSortState {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}

export function sortMatchDetailPlayers(
  players: MatchDetailPlayerResult[],
  sort: MatchDetailSortState,
): MatchDetailPlayerResult[] {
  return players.toSorted((left, right) => {
    const leftValue = sortValue(left, sort.key);
    const rightValue = sortValue(right, sort.key);
    const direction = sort.direction === "asc" ? 1 : -1;

    if (typeof leftValue === "string" || typeof rightValue === "string") {
      return String(leftValue).localeCompare(String(rightValue), "ja-JP") * direction;
    }

    return (leftValue - rightValue) * direction;
  });
}

export function buildMatchFeatureBadges({
  features = [],
}: {
  features?: AnalysisFeature[] | undefined;
}): MatchFeatureBadge[] {
  return features.map((feature) => ({
    ...matchFeatureDefinition(feature.featureCode),
    source: feature.source,
    tone: feature.tone,
  }));
}

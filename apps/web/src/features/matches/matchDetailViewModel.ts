import type { MatchDetailResponse } from "@/shared/api/matches";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import {
  isMatchFeatureId,
  matchFeatureDefinition,
  matchFeaturePriority,
  maxMatchFeatureBadges,
  seriesRelativeMatchFeatureIds,
} from "@/shared/domain/matchFeatures";
import type {
  MatchFeatureDefinition,
  MatchFeatureId,
  MatchFeatureSource,
} from "@/shared/domain/matchFeatures";
import { memberDisplayName } from "@/shared/domain/members";

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

type MatchFeatureCandidate = {
  id: MatchFeatureId;
  source: MatchFeatureSource;
};

export function formatMatchDetailDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function formatMatchDetailDateOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

export function rankMatchDetailPlayers(
  players: MatchDetailPlayerResult[],
): MatchDetailPlayerResult[] {
  return players.toSorted((left, right) => left.rank - right.rank);
}

export function buildMatchFeatureBadges({
  match,
  maxItems = maxMatchFeatureBadges,
  seriesComparison,
}: {
  match: MatchDetailResponse;
  maxItems?: number;
  seriesComparison?: SeriesComparisonResponse | undefined;
}): MatchFeatureBadge[] {
  const players = match.players ?? [];
  const candidates: MatchFeatureCandidate[] = [
    ...seriesRelativeFeatureCandidates(match.matchId, seriesComparison),
    ...matchFeatureCandidates(players),
  ];
  const seen = new Set<MatchFeatureId>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.id)) {
        return false;
      }
      seen.add(candidate.id);
      return true;
    })
    .toSorted((left, right) => matchFeaturePriority(left.id) - matchFeaturePriority(right.id))
    .slice(0, maxItems)
    .map((candidate) => featureBadge(candidate.id, candidate.source));
}

function seriesRelativeFeatureCandidates(
  matchId: string,
  seriesComparison: SeriesComparisonResponse | undefined,
): MatchFeatureCandidate[] {
  const point = seriesComparison?.matchTimeline?.find((item) => item.matchId === matchId);
  return (point?.flags ?? []).flatMap((flag) => {
    if (!isMatchFeatureId(flag) || !isSeriesRelativeFeatureId(flag)) {
      return [];
    }
    return [{ id: flag, source: "series" as const }];
  });
}

function matchFeatureCandidates(players: MatchDetailPlayerResult[]): MatchFeatureCandidate[] {
  if (players.length === 0) {
    return [];
  }

  const winner = rankMatchDetailPlayers(players)[0];
  const destinationTotal = players.reduce(
    (total, player) => total + player.incidents.destination,
    0,
  );
  const totalGinji = players.reduce((total, player) => total + player.incidents.suriNoGinji, 0);
  const maxRevenue = Math.max(...players.map((player) => player.revenueManYen));
  const winnerRevenueRank = winner
    ? players.filter((player) => player.revenueManYen > winner.revenueManYen).length + 1
    : undefined;
  const candidates: MatchFeatureCandidate[] = [];

  if (winner && winner.revenueManYen < maxRevenue) {
    candidates.push({ id: "revenue_top_no_win", source: "match" });
  }
  if (totalGinji >= 2) {
    candidates.push({ id: "ginji_storm", source: "match" });
  }
  if (players.some((player) => player.totalAssetsManYen < 0)) {
    candidates.push({ id: "negative_assets", source: "match" });
  }
  if (destinationTotal === 0) {
    candidates.push({ id: "no_destination", source: "match" });
  } else if (destinationTotal >= 4) {
    candidates.push({ id: "destination_burst", source: "match" });
  }
  if (winnerRevenueRank !== undefined && winnerRevenueRank >= 3) {
    candidates.push({ id: "low_revenue_win", source: "match" });
  }
  if (winner?.playOrder === 4) {
    candidates.push({ id: "fourth_order_win", source: "match" });
  }

  return candidates;
}

function featureBadge(id: MatchFeatureId, source: MatchFeatureSource): MatchFeatureBadge {
  return { ...matchFeatureDefinition(id), source };
}

function isSeriesRelativeFeatureId(id: MatchFeatureId): boolean {
  return (seriesRelativeMatchFeatureIds as readonly string[]).includes(id);
}

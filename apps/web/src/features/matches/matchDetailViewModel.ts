import type { MatchDetailResponse } from "@/shared/api/matches";
import { memberDisplayName } from "@/shared/domain/members";

export type MatchDetailPlayerResult = NonNullable<MatchDetailResponse["players"]>[number];
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

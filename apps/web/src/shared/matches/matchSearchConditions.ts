import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { canonicalResultMembers } from "@/shared/domain/members";

/** Lists that search confirmed matches share the held-order sort and its labels. */
export type HeldOrderSort = "held_desc" | "held_asc";

export const heldOrderSortOptions: Array<{ label: string; value: HeldOrderSort }> = [
  { label: "開催が新しい順", value: "held_desc" },
  { label: "開催が古い順", value: "held_asc" },
];

export function parseHeldOrderSort(value: string | null): HeldOrderSort {
  return value === "held_asc" ? "held_asc" : "held_desc";
}

/** Title / season / map candidates a confirmed-match search can be scoped to. */
export type MatchSearchScopeCandidates = {
  gameTitles: GameTitleResponse[];
  maps: MapMasterResponse[];
  seasons: SeasonMasterResponse[];
};

export type SearchRange = "gte" | "lte";

export const searchRangeOptions: Array<{ label: string; value: SearchRange }> = [
  { label: "以上", value: "gte" },
  { label: "以下", value: "lte" },
];

export const anyMemberLabel = "4人のうち誰か";

export const searchMemberOptions = [
  { label: anyMemberLabel, value: "" },
  ...canonicalResultMembers.map((member) => ({
    label: member.displayName,
    value: member.memberId,
  })),
];

/** The API rejects longer memo queries; the input enforces the same bound. */
export const matchNoteQueryMaxLength = 50;

export function normalizeMatchNoteQuery(value: string): string {
  return value.trim();
}

export function parseMatchNoteQuery(value: string | null): string {
  const q = normalizeMatchNoteQuery(value ?? "");
  return [...q].length <= matchNoteQueryMaxLength ? q : "";
}

export function isSearchDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function searchPeriodError(from: string, to: string): string | undefined {
  return from && to && isSearchDate(from) && isSearchDate(to) && from > to
    ? "終了日は開始日以降にしてください。"
    : undefined;
}

/** An inverted period is dropped instead of guessing which end was meant. */
export function parseSearchPeriod(searchParams: URLSearchParams): { from: string; to: string } {
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const validFrom = isSearchDate(from) ? from : "";
  const validTo = isSearchDate(to) ? to : "";
  return validFrom && validTo && validFrom > validTo
    ? { from: "", to: "" }
    : { from: validFrom, to: validTo };
}

function formatPeriodDate(value: string): string {
  return value.replaceAll("-", "/");
}

export function describeSearchPeriod(from: string, to: string): string | undefined {
  if (from && to) return `期間 ${formatPeriodDate(from)}〜${formatPeriodDate(to)}`;
  if (from) return `期間 ${formatPeriodDate(from)}以降`;
  if (to) return `期間 ${formatPeriodDate(to)}以前`;
  return undefined;
}

/** Labels the visible scope conditions; a candidate that is not loaded yet reads as selected. */
export function describeSearchScope(
  candidates: MatchSearchScopeCandidates,
  search: { gameTitleId: string; mapMasterId: string; seasonMasterId: string },
) {
  const gameTitle = candidates.gameTitles.find((item) => item.id === search.gameTitleId);
  const season = candidates.seasons.find((item) => item.id === search.seasonMasterId);
  const map = candidates.maps.find((item) => item.id === search.mapMasterId);
  return [
    search.gameTitleId
      ? { key: "gameTitle" as const, label: `作品 ${gameTitle?.name ?? "選択中"}` }
      : undefined,
    search.seasonMasterId
      ? { key: "season" as const, label: `シーズン ${season?.name ?? "選択中"}` }
      : undefined,
    search.mapMasterId
      ? { key: "map" as const, label: `マップ ${map?.name ?? "選択中"}` }
      : undefined,
  ].filter((condition) => condition !== undefined);
}

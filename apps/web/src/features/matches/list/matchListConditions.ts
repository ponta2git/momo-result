import type {
  MatchListAppliedCondition,
  MatchListFilterCandidates,
  MatchListRecord,
  MatchListRecordCondition,
  MatchListRecordRange,
  MatchListSearch,
  MatchListSort,
} from "@/features/matches/list/matchListTypes";
import { canonicalResultMembers, memberDisplayName } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";

export const matchListSortOptions: Array<{ label: string; value: MatchListSort }> = [
  { label: "開催が新しい順", value: "held_desc" },
  { label: "開催が古い順", value: "held_asc" },
];

const recordNames: Record<MatchListRecord, string> = {
  destination: "目的地",
  plus_station: "プラス駅",
  minus_station: "マイナス駅",
  card_station: "カード駅",
  card_shop: "カード売り場",
  suri_no_ginji: "スリの銀次",
  total_assets: "総資産",
  revenue: "収益",
};

export function isMatchListRecord(value: string): value is MatchListRecord {
  return Object.hasOwn(recordNames, value);
}

export function isIncidentRecord(record: MatchListRecord): boolean {
  return record !== "total_assets" && record !== "revenue";
}

export const matchListRecordOptions = Object.keys(recordNames)
  .filter(isMatchListRecord)
  .map((value) => ({
    label: isIncidentRecord(value) ? `事件簿: ${recordNames[value]}` : recordNames[value],
    value,
  }));

export const matchListRangeOptions: Array<{ label: string; value: MatchListRecordRange }> = [
  { label: "以上", value: "gte" },
  { label: "以下", value: "lte" },
];

export const matchListAnyMemberLabel = "4人のうち誰か";

export const matchListMemberOptions = [
  { label: matchListAnyMemberLabel, value: "" },
  ...canonicalResultMembers.map((member) => ({
    label: member.displayName,
    value: member.memberId,
  })),
];

/** Incidents are non-negative counts; money is an integer amount in 万円. */
export function parseMatchListRecordValue(
  record: MatchListRecord,
  value: string,
): number | undefined {
  const trimmed = value.trim();
  const pattern = isIncidentRecord(record) ? /^\d{1,9}$/u : /^-?\d{1,9}$/u;
  return pattern.test(trimmed) ? Number(trimmed) : undefined;
}

export function isCompleteMatchListRecord(
  condition: MatchListRecordCondition,
): condition is MatchListRecordCondition & { record: MatchListRecord } {
  return (
    condition.record !== "" &&
    parseMatchListRecordValue(condition.record, condition.value) !== undefined
  );
}

export function isMatchListDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function matchListPeriodError(from: string, to: string): string | undefined {
  return from && to && isMatchListDate(from) && isMatchListDate(to) && from > to
    ? "終了日は開始日以降にしてください。"
    : undefined;
}

export function matchListRecordError(condition: MatchListRecordCondition): string | undefined {
  if (condition.value.trim() === "") return undefined;
  if (condition.record === "") return "記録を選んでください。";
  return parseMatchListRecordValue(condition.record, condition.value) === undefined
    ? isIncidentRecord(condition.record)
      ? "0以上の整数で入力してください。"
      : "整数の万円で入力してください。"
    : undefined;
}

export function matchListRecordValueLabel(record: MatchListRecord | ""): string {
  if (record === "") return "回数・金額";
  return isIncidentRecord(record) ? "回数" : "金額（万円）";
}

export function describeMatchListRecord(condition: MatchListRecordCondition): string | undefined {
  if (!isCompleteMatchListRecord(condition)) return undefined;
  const value = parseMatchListRecordValue(condition.record, condition.value) ?? 0;
  const amount = isIncidentRecord(condition.record)
    ? `${value.toLocaleString()}回`
    : `${value.toLocaleString()}万円`;
  const member = condition.memberId ? memberDisplayName(condition.memberId) : "誰か";
  const range = condition.range === "gte" ? "以上" : "以下";
  return `${member} の ${recordNames[condition.record]} ${amount}${range}`;
}

function formatPeriodDate(value: string): string {
  return value.replaceAll("-", "/");
}

function describePeriod(from: string, to: string): string | undefined {
  if (from && to) return `期間 ${formatPeriodDate(from)}〜${formatPeriodDate(to)}`;
  if (from) return `期間 ${formatPeriodDate(from)}以降`;
  if (to) return `期間 ${formatPeriodDate(to)}以前`;
  return undefined;
}

export type MatchListConditionScope = "all" | "details";

/**
 * Lists applied conditions in reading order. The PC layout keeps title / season / map as visible
 * controls, so only conditions hidden behind the detail disclosure are repeated there.
 */
export function describeMatchListConditions(
  candidates: MatchListFilterCandidates,
  search: MatchListSearch,
  scope: MatchListConditionScope,
): MatchListAppliedCondition[] {
  const gameTitle = candidates.gameTitles.find((item) => item.id === search.gameTitleId);
  const season = candidates.seasons.find((item) => item.id === search.seasonMasterId);
  const map = candidates.maps.find((item) => item.id === search.mapMasterId);
  const heldEvent = candidates.heldEvents.find((item) => item.id === search.heldEventId);
  const period = describePeriod(search.from, search.to);
  const record = describeMatchListRecord(search.record);

  const primary: Array<MatchListAppliedCondition | undefined> =
    scope === "all"
      ? [
          search.gameTitleId
            ? { key: "gameTitle", label: `作品 ${gameTitle?.name ?? "選択中"}` }
            : undefined,
          search.seasonMasterId
            ? { key: "season", label: `シーズン ${season?.name ?? "選択中"}` }
            : undefined,
          search.mapMasterId ? { key: "map", label: `マップ ${map?.name ?? "選択中"}` } : undefined,
        ]
      : [];

  return [
    ...primary,
    search.heldEventId
      ? {
          key: "heldEvent",
          label: `開催 ${heldEvent ? formatDateOnly(heldEvent.heldAt) : "選択中"}`,
        }
      : undefined,
    period ? { key: "period", label: period } : undefined,
    search.q ? { key: "memo", label: `メモ「${search.q}」` } : undefined,
    record ? { key: "record", label: record } : undefined,
  ].filter((condition): condition is MatchListAppliedCondition => condition !== undefined);
}

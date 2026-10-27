import type {
  MatchListAppliedCondition,
  MatchListFilterCandidates,
  MatchListRecord,
  MatchListRecordCondition,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { describeSearchPeriod, describeSearchScope } from "@/shared/matches/matchSearchConditions";

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
  const heldEvent = candidates.heldEvents.find((item) => item.id === search.heldEventId);
  const period = describeSearchPeriod(search.from, search.to);
  const record = describeMatchListRecord(search.record);

  const primary: MatchListAppliedCondition[] =
    scope === "all" ? describeSearchScope(candidates, search) : [];

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

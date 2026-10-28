import type {
  HeldEventListAppliedCondition,
  HeldEventListFilterCandidates,
  HeldEventListMetric,
  HeldEventListMetricCondition,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import { memberDisplayName } from "@/shared/domain/members";
import { describeSearchPeriod, describeSearchScope } from "@/shared/matches/matchSearchConditions";

const metricNames: Record<HeldEventListMetric, string> = {
  average_rank: "開催平均順位",
  rank1_count: "1位の回数",
  rank2_count: "2位の回数",
  rank3_count: "3位の回数",
  rank4_count: "4位の回数",
};

export function isHeldEventListMetric(value: string): value is HeldEventListMetric {
  return Object.hasOwn(metricNames, value);
}

export const heldEventListMetricOptions = Object.keys(metricNames)
  .filter(isHeldEventListMetric)
  .map((value) => ({ label: metricNames[value], value }));

/** The match-count condition offers the lower bounds that narrow a typical night's record. */
export const heldEventListMinMatchCountValues = [2, 3, 4, 5] as const;

export const heldEventListMinMatchCountOptions = [
  { label: "指定しない", value: "" },
  ...heldEventListMinMatchCountValues.map((count) => ({
    label: `${count}試合以上`,
    value: String(count),
  })),
];

export function parseHeldEventListMinMatchCount(value: string | null): number {
  const count = Number(value ?? "");
  return (heldEventListMinMatchCountValues as readonly number[]).includes(count) ? count : 0;
}

/**
 * The API compares averages rounded to 2 decimals within 1.00–4.00, and counts as non-negative
 * integers. Returns the canonical wire string, or undefined when the value is not acceptable.
 */
export function parseHeldEventListMetricValue(
  metric: HeldEventListMetric,
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (metric === "average_rank") {
    if (!/^\d(?:\.\d{1,2})?$/u.test(trimmed)) return undefined;
    const average = Number(trimmed);
    return average >= 1 && average <= 4 ? String(average) : undefined;
  }
  return /^\d{1,9}$/u.test(trimmed) ? String(Number(trimmed)) : undefined;
}

export function isCompleteHeldEventListMetric(
  condition: HeldEventListMetricCondition,
): condition is HeldEventListMetricCondition & { metric: HeldEventListMetric } {
  return (
    condition.metric !== "" &&
    parseHeldEventListMetricValue(condition.metric, condition.value) !== undefined
  );
}

export function heldEventListMetricError(
  condition: HeldEventListMetricCondition,
): string | undefined {
  if (condition.value.trim() === "") return undefined;
  if (condition.metric === "") return "指標を選んでください。";
  if (parseHeldEventListMetricValue(condition.metric, condition.value) !== undefined) {
    return undefined;
  }
  return condition.metric === "average_rank"
    ? "1.00〜4.00の数値（小数第2位まで）で入力してください。"
    : "0以上の整数で入力してください。";
}

export function describeHeldEventListMetric(
  condition: HeldEventListMetricCondition,
): string | undefined {
  if (!isCompleteHeldEventListMetric(condition)) return undefined;
  const value = parseHeldEventListMetricValue(condition.metric, condition.value) ?? "";
  const amount =
    condition.metric === "average_rank"
      ? Number(value).toFixed(2)
      : `${Number(value).toLocaleString()}回`;
  const member = condition.memberId ? memberDisplayName(condition.memberId) : "誰か";
  const range = condition.range === "gte" ? "以上" : "以下";
  return `${member} の${metricNames[condition.metric]} ${amount}${range}`;
}

export type HeldEventListConditionScope = "all" | "details";

/**
 * Lists applied conditions in reading order. The PC layout keeps title / season / map as visible
 * controls, so only conditions hidden behind the detail disclosure are repeated there.
 */
export function describeHeldEventListConditions(
  candidates: HeldEventListFilterCandidates,
  search: HeldEventListSearch,
  scope: HeldEventListConditionScope,
): HeldEventListAppliedCondition[] {
  const period = describeSearchPeriod(search.from, search.to);
  const metric = describeHeldEventListMetric(search.metric);
  const primary: HeldEventListAppliedCondition[] =
    scope === "all" ? describeSearchScope(candidates, search) : [];

  return [
    ...primary,
    period ? { key: "period" as const, label: period } : undefined,
    search.minMatchCount > 0
      ? { key: "matchCount" as const, label: `確定試合数 ${search.minMatchCount}試合以上` }
      : undefined,
    search.q ? { key: "memo" as const, label: `メモ「${search.q}」` } : undefined,
    metric ? { key: "metric" as const, label: metric } : undefined,
  ].filter((condition) => condition !== undefined);
}

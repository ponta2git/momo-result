import { formatManYen } from "@/shared/lib/formatters";
export { rankColor as rankOutcomeColor } from "@/shared/ui/rank/rankPresentation";

import type { NullableNumber } from "./seriesComparisonPresentationTypes";

export function isNumber(value: NullableNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatDecimal(value: NullableNumber, digits = 2): string {
  return isNumber(value) ? value.toFixed(digits) : "-";
}

export function formatSigned(value: NullableNumber, unit = ""): string {
  if (!isNumber(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

export function formatSignedPercentPoint(value: NullableNumber): string {
  if (!isNumber(value)) {
    return "-";
  }
  const point = value * 100;
  const sign = point > 0 ? "+" : "";
  return `${sign}${point.toFixed(1)}pt`;
}

export function formatPercent(value: NullableNumber): string {
  return isNumber(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

export function formatCountRate({
  count,
  rate,
  targetCount,
  unit = "戦",
}: {
  count?: NullableNumber;
  rate?: NullableNumber;
  targetCount?: NullableNumber;
  unit?: string;
}): string {
  if (!isNumber(targetCount) || targetCount <= 0) {
    return "対象なし";
  }
  return `${isNumber(count) ? count : 0}/${targetCount}${unit}・${formatPercent(rate)}`;
}

export function formatMoney(value: NullableNumber): string {
  return isNumber(value) ? formatManYen(Math.round(value)) : "-";
}

export function formatPlayOrderLabel(playOrder: NullableNumber): string {
  return isNumber(playOrder) ? `${playOrder}P` : "P不明";
}

export function playOrderColor(playOrder: NullableNumber): string {
  const colors = [
    "var(--color-player-1)",
    "var(--color-player-2)",
    "var(--color-player-3)",
    "var(--color-player-4)",
  ];
  return isNumber(playOrder)
    ? (colors[playOrder - 1] ?? "var(--color-text-muted)")
    : "var(--color-text-muted)";
}

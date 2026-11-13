import {
  directionLabel,
  formatDecimal,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { cn } from "@/shared/ui/cn";
import { compactBadgeClass, compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";

export type ChangeDirection =
  | "declined"
  | "first_observation"
  | "improved"
  | "unavailable"
  | "unchanged";

export function ChangeBadge({
  direction,
  magnitude,
}: {
  direction: ChangeDirection;
  magnitude: number | null;
}) {
  const absoluteMagnitude = magnitude !== null && magnitude < 0 ? -magnitude : magnitude;
  const value = absoluteMagnitude === null ? "" : `${formatDecimal(absoluteMagnitude)} `;
  return (
    <span className={cn(compactBadgeClass, "w-fit tabular-nums", changeTone(direction))}>
      {value}
      {directionLabel(direction)}
    </span>
  );
}

export function deltaDirection(value: number | null): ChangeDirection {
  if (value === null) return "unavailable";
  if (value < 0) return "improved";
  if (value > 0) return "declined";
  return "unchanged";
}

export function formatSignedDecimal(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${formatDecimal(value)}`;
}

export function rankDeltaLabel(delta: number | null): string {
  if (delta === null) return "初戦";
  if (delta === 0) return "0位・維持";
  return `${delta < 0 ? -delta : delta}位・${delta < 0 ? "改善" : "後退"}`;
}

/** Improvement and decline keep the analysis colors; only their border and surface override the recipe. */
function changeTone(direction: ChangeDirection): string {
  if (direction === "improved") {
    return "border-[var(--color-analysis-positive)]/45 bg-[var(--color-analysis-positive)]/10";
  }
  if (direction === "declined") {
    return "border-[var(--color-analysis-negative)]/45 bg-[var(--color-analysis-negative)]/10";
  }
  return compactBadgeToneClass.neutral;
}

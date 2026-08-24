import {
  directionLabel,
  formatDecimal,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";

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
    <span
      className={`inline-flex min-h-7 w-fit items-center rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold tabular-nums ${changeTone(direction)}`}
    >
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

function changeTone(direction: ChangeDirection): string {
  if (direction === "improved") {
    return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10";
  }
  if (direction === "declined") {
    return "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]";
}

import type { ReactNode } from "react";

import { formatManYen } from "@/shared/lib/formatters";
import type { MatchPerformanceContextRow } from "@/shared/matches/matchPerformanceContext";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { PlayOrderMark } from "@/shared/matches/PlayOrderMark";
import { RankBadge } from "@/shared/matches/RankBadge";
import {
  WinnerCelebrationMark,
  WinnerCelebrationSurface,
} from "@/shared/matches/WinnerCelebration";
import { cn } from "@/shared/ui/cn";
import { compactBadgeClass, compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";
import { contentText, momentText } from "@/shared/ui/typography";

type MatchResultLedgerRow = MatchPerformanceContextRow & {
  displayName: string;
  playOrder?: number | undefined;
  details?: ReactNode;
};

/**
 * `loading` is an in-flight read that ends by itself. `calculating` waits for a queued or running
 * analysis that this page does not track, so it must not read as loading.
 */
type MatchResultLedgerContextStatus = "loading" | "calculating" | "ready" | "unavailable";
type MatchResultLedgerPresentation = "embedded" | "standalone";

export const matchResultLedgerRowClass = "grid min-w-0 content-start gap-4 p-4";
/**
 * Rows that regroup by the card's width sit in their own size container. The card itself cannot
 * be one: containment would detach it from the shared row tracks.
 */
export const matchResultLedgerFlowClass = "@container min-w-0";
/**
 * Side-by-side cards share their row tracks, so each question (who and where, the total, its
 * breakdown, the series context, incidents) sits at the same height in both cards.
 */
export const matchResultLedgerGridClass = "grid min-w-0 gap-4 lg:grid-cols-2";
/**
 * Revenue and the two figures derived from it. A narrow card gives the amount its own line and
 * pairs the derived figures below it, rather than stranding one of the three on a second line.
 */
export const matchResultLedgerBreakdownClass =
  "grid min-w-0 grid-cols-2 items-start gap-4 @md:grid-cols-3 [&>:first-child]:col-span-2 @md:[&>:first-child]:col-span-1";

/**
 * Each card answers, in order: who finished where, the total assets that decided it, how the
 * revenue made it up, where the match leaves the player in the series, and what happened.
 */
export function MatchResultLedger({
  ariaLabel = "試合の順位と成績",
  celebrateWinner = false,
  contextStatus,
  presentation = "standalone",
  rows,
}: {
  ariaLabel?: string;
  /**
   * Set only for the moment a match is confirmed (UI rule: 節目の演出). Every first place, ties
   * included, gets the celebration surface, mark, and the moment-sized total; the rest keep the
   * same shape so the four still compare as one group.
   */
  celebrateWinner?: boolean;
  contextStatus: MatchResultLedgerContextStatus;
  presentation?: MatchResultLedgerPresentation;
  rows: MatchResultLedgerRow[];
}) {
  const withDetails = rows.some((row) => row.details);
  return (
    <ol aria-label={ariaLabel} className={matchResultLedgerGridClass}>
      {rows
        .toSorted((left, right) => left.rank - right.rank)
        .map((row) => {
          const celebrated = celebrateWinner && row.rank === 1;
          return (
            <li
              key={row.memberId}
              className={cn(
                matchResultLedgerRowClass,
                "border lg:grid-rows-subgrid",
                withDetails ? "lg:row-span-5" : "lg:row-span-4",
                celebrated
                  ? "relative isolate border-[var(--color-celebration-border)]"
                  : "border-[var(--color-border)]",
                presentation === "embedded" ? "rounded-sm" : "rounded-md",
              )}
            >
              {celebrated ? <WinnerCelebrationSurface /> : null}
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <RankBadge rank={row.rank} size="md" />
                  <h3 className={cn(contentText.primary, "min-w-0")}>
                    <MemberSequenceLabel
                      accent={row.playOrder === undefined}
                      memberId={row.memberId}
                    >
                      {row.displayName}
                    </MemberSequenceLabel>
                  </h3>
                  {celebrated ? <WinnerCelebrationMark /> : null}
                </div>
                {row.playOrder === undefined ? null : <PlayOrderMark playOrder={row.playOrder} />}
              </div>

              {/* The total decides the rank, so it takes a row of its own under the name. */}
              <dl className="min-w-0">
                <dt className={contentText.supporting}>総資産</dt>
                <dd
                  className={cn(
                    celebrated ? momentText.result : contentText.primary,
                    "mt-0.5 break-words tabular-nums",
                  )}
                >
                  {formatManYen(row.totalAssetsManYen)}
                </dd>
              </dl>

              <div className={matchResultLedgerFlowClass}>
                <dl className={matchResultLedgerBreakdownClass}>
                  <LedgerFact label="物件収益" value={formatManYen(row.revenueManYen)} />
                  <LedgerFact label="収益順位" value={formatOrdinal(row.revenueRank)} />
                  <LedgerFact
                    label="物件収益比率"
                    value={
                      row.revenueAssetRate === undefined
                        ? row.totalAssetsManYen <= 0
                          ? "対象外"
                          : "—"
                        : formatRevenueAssetRate(row.revenueAssetRate)
                    }
                  />
                </dl>
              </div>

              <dl className="grid content-start gap-0.5">
                <dt className={contentText.supporting}>通算平均順位</dt>
                {/* Every comparison state keeps the badge row height, so the late context does not move the card. */}
                <dd className="flex min-h-6 flex-wrap items-center gap-2">
                  <AverageRankChange contextStatus={contextStatus} row={row} />
                </dd>
              </dl>
              {row.details ? <div className={matchResultLedgerFlowClass}>{row.details}</div> : null}
            </li>
          );
        })}
    </ol>
  );
}

function LedgerFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={contentText.supporting}>{label}</dt>
      <dd className={cn(contentText.body, "mt-0.5 break-words tabular-nums")}>{value}</dd>
    </div>
  );
}

function AverageRankChange({
  contextStatus,
  row,
}: {
  contextStatus: MatchResultLedgerContextStatus;
  row: MatchResultLedgerRow;
}) {
  if (contextStatus === "loading") {
    return <span className={contentText.supporting}>比較データを読み込み中</span>;
  }
  if (contextStatus === "calculating") {
    return <span className={contentText.supporting}>集計待ち</span>;
  }
  if (
    contextStatus === "unavailable" ||
    row.trend === "unavailable" ||
    row.cumulativeAverageAfter === undefined
  ) {
    return <span className={contentText.supporting}>比較データなし</span>;
  }

  const transition =
    row.cumulativeAverageBefore === undefined
      ? formatAverageRank(row.cumulativeAverageAfter)
      : `${formatAverageRank(row.cumulativeAverageBefore)} → ${formatAverageRank(
          row.cumulativeAverageAfter,
        )}`;
  return (
    <>
      <strong className={cn(contentText.body, "tabular-nums")}>{transition}</strong>
      <span className={cn(compactBadgeClass, trendTone(row.trend))}>{trendLabel(row)}</span>
    </>
  );
}

function formatAverageRank(value: number): string {
  return value.toFixed(2);
}

function formatOrdinal(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}位`;
}

function formatRevenueAssetRate(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(value);
}

function trendLabel(row: MatchResultLedgerRow): string {
  if (row.trend === "firstMatch") {
    return "初戦";
  }
  if (row.trend === "unchanged" || row.cumulativeAverageDelta === undefined) {
    return "維持";
  }
  return `${Math.abs(row.cumulativeAverageDelta).toFixed(2)}${
    row.trend === "improved" ? "改善" : "後退"
  }`;
}

/** Improvement and decline keep their analysis colors; the badge recipe owns size and type. */
function trendTone(trend: MatchResultLedgerRow["trend"]): string {
  if (trend === "improved") {
    return "border-[var(--color-analysis-positive)]/45 bg-[var(--color-analysis-positive)]/10 text-[var(--color-analysis-positive)]";
  }
  if (trend === "declined") {
    return "border-[var(--color-analysis-negative)]/35 bg-[var(--color-analysis-negative)]/8 text-[var(--color-analysis-negative)]";
  }
  return compactBadgeToneClass.neutral;
}

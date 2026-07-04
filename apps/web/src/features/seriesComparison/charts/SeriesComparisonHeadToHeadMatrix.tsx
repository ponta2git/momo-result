import type {
  HeadToHeadEntry,
  Player,
} from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { isFiniteNumber } from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import {
  formatPercent,
  formatSigned,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  headToHeadBands,
  headToHeadRankDiffSignal,
  SERIES_COMPARISON_THRESHOLDS,
} from "@/features/seriesComparison/model/seriesComparisonThresholds";
import { colorMix } from "@/features/seriesComparison/charts/SeriesComparisonRankColors";

export function HeadToHeadMatrix({
  entries,
  players,
}: {
  entries: HeadToHeadEntry[];
  players: Player[];
}) {
  const entryByPair = new Map(
    entries.map((entry) => [`${entry.subjectMemberId}:${entry.opponentMemberId}`, entry]),
  );

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[42rem] gap-1"
        style={{
          gridTemplateColumns: `9rem repeat(${Math.max(1, players.length)}, minmax(7rem, 1fr))`,
        }}
      >
        <div aria-hidden="true" />
        {players.map((player) => (
          <div
            key={player.memberId}
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1.5 text-center text-xs font-semibold break-words text-[var(--color-text-primary)]"
          >
            vs {player.displayName}
          </div>
        ))}
        {players.map((subject, rowIndex) => (
          <MatrixRow
            key={subject.memberId}
            entryByPair={entryByPair}
            players={players}
            rowIndex={rowIndex}
            subject={subject}
          />
        ))}
      </div>
    </div>
  );
}

function MatrixRow({
  entryByPair,
  players,
  rowIndex,
  subject,
}: {
  entryByPair: Map<string, HeadToHeadEntry>;
  players: Player[];
  rowIndex: number;
  subject: Player;
}) {
  return (
    <>
      <div
        className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-sm font-semibold break-words text-[var(--color-text-primary)]"
        style={{ borderLeftColor: playerColor(rowIndex), borderLeftWidth: 3 }}
      >
        {subject.displayName}
      </div>
      {players.map((opponent) => {
        const entry = entryByPair.get(`${subject.memberId}:${opponent.memberId}`);
        const rate = entry?.betterRankRate;
        const matchCount = entry?.matchCount;
        const tone = headToHeadCellTone(rate, matchCount, entry?.averageRankDiff);
        const isSelf = subject.memberId === opponent.memberId;
        return (
          <div
            key={opponent.memberId}
            className="min-h-16 rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-2 text-center"
            style={{
              backgroundColor: isSelf
                ? "var(--color-surface-subtle)"
                : colorMix(tone.color, tone.alpha),
              borderColor: isSelf ? "var(--color-border)" : colorMix(tone.color, tone.borderAlpha),
            }}
          >
            {isSelf ? (
              <span className="text-xs text-[var(--color-text-muted)]">-</span>
            ) : (
              <>
                <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                  {formatPercent(rate)}
                </div>
                <div className="mt-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                  {headToHeadToneLabel(rate, matchCount, entry?.averageRankDiff)}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                  {entry?.betterRankCount ?? 0}/{entry?.matchCount ?? 0}戦
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                  順位差 {formatSigned(entry?.averageRankDiff)}
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

export function headToHeadCellTone(
  rate: number | null | undefined,
  matchCount?: number,
  averageRankDiff?: number | null,
): {
  alpha: number;
  borderAlpha: number;
  color: string;
} {
  const bands = headToHeadBands(matchCount);
  if (
    matchCount != null &&
    matchCount > 0 &&
    matchCount <= SERIES_COMPARISON_THRESHOLDS.headToHead.referenceMaxMatchCount
  ) {
    return { alpha: 0.08, borderAlpha: 0.2, color: "var(--color-tray-incident)" };
  }
  if (!isFiniteNumber(rate)) {
    return { alpha: 0, borderAlpha: 0.14, color: "var(--color-tray-incident)" };
  }
  if (rate > bands.slightDisadvantageTo && rate < bands.slightAdvantageFrom) {
    const rankDiffSignal = headToHeadRankDiffSignal(averageRankDiff, matchCount);
    if (rankDiffSignal === "strong_positive" || rankDiffSignal === "slight_positive") {
      return directionalHeadToHeadTone("positive", averageRankDiff);
    }
    if (rankDiffSignal === "strong_negative" || rankDiffSignal === "slight_negative") {
      return directionalHeadToHeadTone("negative", averageRankDiff);
    }
    return { alpha: 0.08, borderAlpha: 0.2, color: "var(--color-tray-incident)" };
  }
  const distance = Math.abs(rate - 0.5);
  const alpha = Math.min(0.46, distance < 0.001 ? 0.04 : 0.1 + distance * 0.92);
  return rate >= 0.5
    ? { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), color: "var(--color-action)" }
    : { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), color: "var(--color-danger)" };
}

function directionalHeadToHeadTone(
  direction: "negative" | "positive",
  averageRankDiff: number | null | undefined,
): {
  alpha: number;
  borderAlpha: number;
  color: string;
} {
  const distance = Math.min(
    0.22,
    Math.max(0.06, Math.abs(isFiniteNumber(averageRankDiff) ? averageRankDiff : 0) * 0.42),
  );
  const alpha = Math.min(0.46, 0.1 + distance * 0.92);
  return direction === "positive"
    ? { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), color: "var(--color-action)" }
    : { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), color: "var(--color-danger)" };
}

export function headToHeadToneLabel(
  rate: number | null | undefined,
  matchCount?: number,
  averageRankDiff?: number | null,
): string {
  const bands = headToHeadBands(matchCount);
  if (
    matchCount != null &&
    matchCount > 0 &&
    matchCount <= SERIES_COMPARISON_THRESHOLDS.headToHead.referenceMaxMatchCount
  ) {
    return "参考";
  }
  if (matchCount === 0) {
    return "判定なし";
  }
  if (!isFiniteNumber(rate)) {
    return "判定なし";
  }
  if (rate >= bands.strongAdvantageFrom) {
    return "優勢";
  }
  if (rate >= bands.slightAdvantageFrom) {
    return "やや優勢";
  }
  if (rate <= bands.strongDisadvantageTo) {
    return "劣勢";
  }
  if (rate <= bands.slightDisadvantageTo) {
    return "やや劣勢";
  }
  const rankDiffSignal = headToHeadRankDiffSignal(averageRankDiff, matchCount);
  if (rankDiffSignal === "strong_positive") {
    return "優勢";
  }
  if (rankDiffSignal === "slight_positive") {
    return "やや優勢";
  }
  if (rankDiffSignal === "strong_negative") {
    return "劣勢";
  }
  if (rankDiffSignal === "slight_negative") {
    return "やや劣勢";
  }
  return "互角";
}

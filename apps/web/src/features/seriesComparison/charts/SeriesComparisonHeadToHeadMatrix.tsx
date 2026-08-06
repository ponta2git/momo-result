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
import { colorMix } from "@/shared/ui/rank/rankPresentation";

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
        const tone = headToHeadCellTone(entry?.headToHeadSignal, rate, entry?.averageRankDiff);
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
                  {headToHeadToneLabel(entry?.headToHeadSignal)}
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
  signal: string | null | undefined,
  rate: number | null | undefined,
  averageRankDiff?: number | null,
): {
  alpha: number;
  borderAlpha: number;
  color: string;
} {
  switch (signal) {
    case "strong_advantage":
      return directionalHeadToHeadTone("positive", "strong", rate, averageRankDiff);
    case "slight_advantage":
      return directionalHeadToHeadTone("positive", "slight", rate, averageRankDiff);
    case "strong_disadvantage":
      return directionalHeadToHeadTone("negative", "strong", rate, averageRankDiff);
    case "slight_disadvantage":
      return directionalHeadToHeadTone("negative", "slight", rate, averageRankDiff);
    case "reference":
    case "neutral":
      return { alpha: 0.08, borderAlpha: 0.2, color: "var(--color-tray-incident)" };
    default:
      return { alpha: 0, borderAlpha: 0.14, color: "var(--color-tray-incident)" };
  }
}

function directionalHeadToHeadTone(
  direction: "negative" | "positive",
  strength: "slight" | "strong",
  rate: number | null | undefined,
  averageRankDiff: number | null | undefined,
): {
  alpha: number;
  borderAlpha: number;
  color: string;
} {
  const rateDistance = isFiniteNumber(rate) ? Math.abs(rate - 0.5) : 0;
  const rankDistance = Math.min(
    0.22,
    Math.max(0.06, Math.abs(isFiniteNumber(averageRankDiff) ? averageRankDiff : 0) * 0.42),
  );
  const signalDistance = strength === "strong" ? 0.15 : 0.06;
  const distance = Math.max(rateDistance, rankDistance, signalDistance);
  const alpha = Math.min(0.46, 0.1 + distance * 0.92);
  return direction === "positive"
    ? { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), color: "var(--color-action)" }
    : { alpha, borderAlpha: Math.min(0.66, alpha + 0.16), color: "var(--color-danger)" };
}

export function headToHeadToneLabel(signal: string | null | undefined): string {
  switch (signal) {
    case "strong_advantage":
      return "優勢";
    case "slight_advantage":
      return "やや優勢";
    case "strong_disadvantage":
      return "劣勢";
    case "slight_disadvantage":
      return "やや劣勢";
    case "reference":
      return "参考";
    case "neutral":
      return "互角";
    default:
      return "判定なし";
  }
}

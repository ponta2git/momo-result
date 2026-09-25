import {
  AnalysisMatrix,
  MatrixAxisHeader,
  MatrixCell,
  MatrixColumnHeader,
  MatrixRowHeader,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { contentText } from "@/shared/ui/typography";

type MatchNoEntry = SeriesComparisonAggregate["matchNoInEvent"]["entries"][number];

export function MatchNoInEventMatrix({
  entries,
  players,
}: {
  entries: MatchNoEntry[];
  players: SeriesComparisonAggregate["players"];
}) {
  const regularEntries = entries.filter((entry) => entry.category === "regular");
  const additionalEntries = entries.filter((entry) => entry.category === "additional");

  return (
    <div className="grid gap-3">
      <MatchNoMatrix
        ariaLabel="通常試合の開催内順別傾向"
        entries={regularEntries}
        players={players}
      />
      {additionalEntries.length > 0 ? (
        <Disclosure panelPadding="sm" summary="追加試合" triggerVariant="supporting">
          <MatchNoMatrix
            ariaLabel="追加試合の開催内順別傾向"
            entries={additionalEntries}
            players={players}
          />
        </Disclosure>
      ) : null}
    </div>
  );
}

function MatchNoMatrix({
  ariaLabel,
  entries,
  players,
}: {
  ariaLabel: string;
  entries: MatchNoEntry[];
  players: SeriesComparisonAggregate["players"];
}) {
  return (
    <AnalysisMatrix ariaLabel={ariaLabel} className="min-w-[42rem] table-fixed">
      <thead>
        <tr>
          <MatrixAxisHeader className="w-28" columnLabel="プレーヤー" rowLabel="試合順" />
          {players.map((player) => (
            <MatrixColumnHeader key={player.memberId}>
              <span className="flex justify-center">
                <MemberSequenceLabel memberId={player.memberId}>
                  {player.displayName}
                </MemberSequenceLabel>
              </span>
            </MatrixColumnHeader>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <MatchNoRow entry={entry} key={entry.matchNoInEvent} />
        ))}
      </tbody>
    </AnalysisMatrix>
  );
}

function MatchNoRow({ entry }: { entry: MatchNoEntry }) {
  return (
    <tr>
      <MatrixRowHeader className="py-3">
        {formatMatchNoInEvent(entry.matchNoInEvent)}
      </MatrixRowHeader>
      {entry.players.map((player) => {
        const qualityAdvisory = qualityAdvisoryLabel(player.qualityStatus);
        return (
          <MatrixCell
            aria-label={`${player.displayName}、${formatMatchNoInEvent(entry.matchNoInEvent)}、${player.targetCount}戦${qualityAdvisory ? `、${qualityAdvisory}` : ""}、平均${formatDecimal(player.averageRank)}位、入賞${formatPercent(player.podiumRate)}`}
            className="rounded-xs border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"
            key={player.memberId}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cn(contentText.supporting, "tabular-nums")}>
                {player.targetCount}戦
              </span>
              <SeriesAnalysisQualityAdvisory status={player.qualityStatus} />
            </div>
            <p className={cn(contentText.compactPrimary, "mt-1 tabular-nums")}>
              平均 {formatDecimal(player.averageRank)}位
            </p>
            <p className={cn(contentText.body, "mt-0.5 tabular-nums")}>
              入賞 {formatPercent(player.podiumRate)}
            </p>
          </MatrixCell>
        );
      })}
    </tr>
  );
}

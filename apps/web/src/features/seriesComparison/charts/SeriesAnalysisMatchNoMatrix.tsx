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
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";

type MatchNoEntry = SeriesComparisonAggregateV3["matchNoInEvent"]["entries"][number];

export function MatchNoInEventMatrix({ response }: { response: SeriesComparisonAggregateV3 }) {
  const regularEntries = response.matchNoInEvent.entries.filter(
    (entry) => entry.category === "regular",
  );
  const additionalEntries = response.matchNoInEvent.entries.filter(
    (entry) => entry.category === "additional",
  );

  return (
    <div className="grid gap-3">
      <MatchNoMatrix
        ariaLabel="通常試合の開催内順別傾向"
        entries={regularEntries}
        response={response}
      />
      {additionalEntries.length > 0 ? (
        <Disclosure
          panelPadding="sm"
          presentation="inset"
          summary="追加試合"
          triggerVariant="supporting"
        >
          <MatchNoMatrix
            ariaLabel="追加試合の開催内順別傾向"
            entries={additionalEntries}
            response={response}
          />
        </Disclosure>
      ) : null}
    </div>
  );
}

function MatchNoMatrix({
  ariaLabel,
  entries,
  response,
}: {
  ariaLabel: string;
  entries: MatchNoEntry[];
  response: SeriesComparisonAggregateV3;
}) {
  const players = response.players;
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
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {player.targetCount}戦
              </span>
              <SeriesAnalysisQualityAdvisory status={player.qualityStatus} />
            </div>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              平均 {formatDecimal(player.averageRank)}位
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
              入賞 {formatPercent(player.podiumRate)}
            </p>
          </MatrixCell>
        );
      })}
    </tr>
  );
}

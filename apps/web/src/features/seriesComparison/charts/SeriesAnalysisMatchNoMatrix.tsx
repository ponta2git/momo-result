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
import { orderFixedMembers } from "@/shared/domain/members";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";

type MatchNoEntry = SeriesComparisonAggregateV3["matchNoInEvent"]["entries"][number];

export function MatchNoInEventMatrix({ response }: { response: SeriesComparisonAggregateV3 }) {
  const entryByNo = new Map(
    response.matchNoInEvent.entries.map((entry) => [entry.matchNoInEvent, entry]),
  );
  const regularEntries = [1, 2, 3, 4].map(
    (matchNoInEvent): MatchNoEntry =>
      entryByNo.get(matchNoInEvent) ?? {
        category: "regular",
        matchNoInEvent,
        players: [],
      },
  );
  const additionalEntries = response.matchNoInEvent.entries.filter(
    (entry) => entry.category === "additional" || entry.matchNoInEvent > 4,
  );

  return (
    <div className="grid gap-3">
      <MatchNoMatrix
        ariaLabel="開催内第1試合から第4試合の傾向"
        entries={regularEntries}
        response={response}
      />
      {additionalEntries.length > 0 ? (
        <Disclosure
          className="border-y border-[var(--color-border)]"
          panelClassName="border-t border-[var(--color-border)] py-3"
          summary="第5試合以降"
          triggerVariant="supporting"
        >
          <MatchNoMatrix
            ariaLabel="開催内第5試合以降の傾向"
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
  const players = orderFixedMembers(response.players);
  return (
    <AnalysisMatrix ariaLabel={ariaLabel} className="min-w-[42rem] table-fixed">
      <thead>
        <tr>
          <MatrixAxisHeader className="w-28" columnLabel="プレーヤー" rowLabel="試合順" />
          {players.map((player) => (
            <MatrixColumnHeader key={player.memberId}>
              <MemberSequenceLabel className="justify-center" memberId={player.memberId}>
                {player.displayName}
              </MemberSequenceLabel>
            </MatrixColumnHeader>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const rowByMemberId = new Map(entry.players.map((player) => [player.memberId, player]));
          return (
            <MatchNoRow
              entry={entry}
              key={entry.matchNoInEvent}
              response={response}
              rowByMemberId={rowByMemberId}
            />
          );
        })}
      </tbody>
    </AnalysisMatrix>
  );
}

function MatchNoRow({
  entry,
  response,
  rowByMemberId,
}: {
  entry: MatchNoEntry;
  response: SeriesComparisonAggregateV3;
  rowByMemberId: Map<string, MatchNoEntry["players"][number]>;
}) {
  const players = orderFixedMembers(response.players);
  return (
    <tr>
      <MatrixRowHeader className="py-3">
        {formatMatchNoInEvent(entry.matchNoInEvent)}
      </MatrixRowHeader>
      {players.map((player) => {
        const row = rowByMemberId.get(player.memberId);
        const qualityStatus = row?.qualityStatus ?? "no_target";
        const qualityAdvisory = qualityAdvisoryLabel(qualityStatus);
        return (
          <MatrixCell
            aria-label={`${player.displayName}、${formatMatchNoInEvent(entry.matchNoInEvent)}、${row?.targetCount ?? 0}戦${qualityAdvisory ? `、${qualityAdvisory}` : ""}、平均${formatDecimal(row?.averageRank)}位、入賞${formatPercent(row?.podiumRate)}`}
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"
            key={player.memberId}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {row?.targetCount ?? 0}戦
              </span>
              <SeriesAnalysisQualityAdvisory status={qualityStatus} />
            </div>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              平均 {formatDecimal(row?.averageRank)}位
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
              入賞 {formatPercent(row?.podiumRate)}
            </p>
          </MatrixCell>
        );
      })}
    </tr>
  );
}

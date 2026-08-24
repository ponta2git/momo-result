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
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { dataVizSeriesColor } from "@/shared/ui/dataViz/playerSeries";

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
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
          panelClassName="border-t border-[var(--color-border)] p-3"
          summary="第5試合以降"
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
  return (
    <AnalysisMatrix ariaLabel={ariaLabel} className="min-w-[42rem] table-fixed">
      <thead>
        <tr>
          <MatrixAxisHeader className="w-28" columnLabel="プレーヤー" rowLabel="試合順" />
          {response.players.map((player, playerIndex) => (
            <MatrixColumnHeader
              key={player.memberId}
              style={{ borderTopColor: dataVizSeriesColor(playerIndex), borderTopWidth: 3 }}
            >
              {player.displayName}
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
  return (
    <tr>
      <MatrixRowHeader className="py-3">第{entry.matchNoInEvent}試合</MatrixRowHeader>
      {response.players.map((player) => {
        const row = rowByMemberId.get(player.memberId);
        const quality = qualityLabel(row?.qualityStatus ?? "no_target");
        return (
          <MatrixCell
            aria-label={`${player.displayName}、第${entry.matchNoInEvent}試合、${row?.targetCount ?? 0}戦、${quality}、平均${formatDecimal(row?.averageRank)}位、入賞${formatPercent(row?.podiumRate)}`}
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"
            key={player.memberId}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {row?.targetCount ?? 0}戦
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">{quality}</span>
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

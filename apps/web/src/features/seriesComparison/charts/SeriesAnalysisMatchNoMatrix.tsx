import {
  formatDecimal,
  formatPercent,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV2 } from "@/shared/api/seriesAnalysis";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { dataVizSeriesColor } from "@/shared/ui/dataViz/playerSeries";

type MatchNoEntry = SeriesComparisonAggregateV2["matchNoInEvent"]["entries"][number];

export function MatchNoInEventMatrix({ response }: { response: SeriesComparisonAggregateV2 }) {
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
      <MatchNoMatrix entries={regularEntries} response={response} />
      {additionalEntries.length > 0 ? (
        <Disclosure
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
          panelClassName="border-t border-[var(--color-border)] p-3"
          summary="第5試合以降"
        >
          <MatchNoMatrix entries={additionalEntries} response={response} />
        </Disclosure>
      ) : null}
    </div>
  );
}

function MatchNoMatrix({
  entries,
  response,
}: {
  entries: MatchNoEntry[];
  response: SeriesComparisonAggregateV2;
}) {
  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[42rem] gap-1"
        style={{
          gridTemplateColumns: `7rem repeat(${response.players.length === 0 ? 1 : response.players.length}, minmax(8rem, 1fr))`,
        }}
      >
        <div aria-hidden="true" />
        {response.players.map((player, playerIndex) => (
          <div
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-center text-xs font-semibold break-words"
            key={player.memberId}
            style={{ borderTopColor: dataVizSeriesColor(playerIndex), borderTopWidth: 3 }}
          >
            {player.displayName}
          </div>
        ))}
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
      </div>
    </div>
  );
}

function MatchNoRow({
  entry,
  response,
  rowByMemberId,
}: {
  entry: MatchNoEntry;
  response: SeriesComparisonAggregateV2;
  rowByMemberId: Map<string, MatchNoEntry["players"][number]>;
}) {
  return (
    <>
      <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-3 text-sm font-semibold">
        第{entry.matchNoInEvent}試合
      </div>
      {response.players.map((player) => {
        const row = rowByMemberId.get(player.memberId);
        return (
          <div
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"
            key={player.memberId}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {row?.targetCount ?? 0}戦
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {qualityLabel(row?.qualityStatus ?? "no_target")}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              平均 {formatDecimal(row?.averageRank)}位
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
              入賞 {formatPercent(row?.podiumRate)}
            </p>
          </div>
        );
      })}
    </>
  );
}

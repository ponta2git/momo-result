import {
  StrategyProfileChart,
  StrategyScatterPlot,
} from "@/features/seriesComparison/charts/SeriesComparisonCharts";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export function SeriesComparisonStrategyEvidence({
  focusMatchId,
  response,
}: {
  focusMatchId?: string | undefined;
  response: SeriesComparisonResponse;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:items-start">
      <StrategyScatterPlot
        focusedMatchId={focusMatchId}
        players={response.players ?? []}
        points={response.matchPlayerPoints ?? []}
      />
      <StrategyProfileChart
        players={response.players ?? []}
        profiles={response.playerPerformanceProfiles}
      />
    </div>
  );
}

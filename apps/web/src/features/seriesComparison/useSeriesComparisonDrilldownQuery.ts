import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { seriesComparisonDrilldownQueryOptions } from "@/shared/api/queryOptions";
import type {
  SeriesComparisonDrilldownQuery,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";

export function useSeriesComparisonDrilldownQuery({
  metricId,
  open,
  response,
  selectedMemberId,
}: {
  metricId: SeriesComparisonDrilldownQuery["metricId"];
  open: boolean;
  response: SeriesComparisonResponse;
  selectedMemberId: string | null;
}) {
  const players = response.players ?? [];
  const selectedPlayer =
    players.find((player) => player.memberId === selectedMemberId) ?? players[0] ?? null;
  const query = useMemo<SeriesComparisonDrilldownQuery | undefined>(() => {
    if (!selectedPlayer) {
      return undefined;
    }
    return {
      gameTitleId: response.scope.gameTitleId,
      mapMasterId: response.scope.mapMasterId,
      memberId: selectedPlayer.memberId,
      metricId,
      seasonMasterId: response.scope.seasonMasterId,
    };
  }, [
    metricId,
    response.scope.gameTitleId,
    response.scope.mapMasterId,
    response.scope.seasonMasterId,
    selectedPlayer,
  ]);

  return {
    drilldownQuery: useQuery(seriesComparisonDrilldownQueryOptions(query, open)),
    players,
    selectedPlayer,
  };
}

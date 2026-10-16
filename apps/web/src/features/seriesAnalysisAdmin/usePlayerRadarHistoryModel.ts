import { useQuery } from "@tanstack/react-query";

import type { SeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminUrlState";
import { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  playerRadarHistoryQueryOptions,
  playerRadarRevisionQueryOptions,
} from "@/shared/api/seriesPlayerRadarHistory";
import type {
  PlayerRadarRevisionList,
  PlayerRadarRevisionDetail,
} from "@/shared/api/seriesPlayerRadarHistory";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** History navigation never changes the title or scope of the threshold editor. */
export function usePlayerRadarHistoryModel() {
  const authorization = useAuthorization();
  const location = useSeriesAnalysisAdminLocation();
  const owner = usePlayerRadarHistory(authorization, location);
  return {
    ...location.history,
    ...historyPresentation(owner),
    actions: owner.actions,
  };
}

function usePlayerRadarHistory(
  authorization: ReturnType<typeof useAuthorization>,
  location: ReturnType<typeof useSeriesAnalysisAdminLocation>,
) {
  const { gameTitleId, cursor, revisionId } = location.history;
  const listOptions = playerRadarHistoryQueryOptions({ gameTitleId, cursor });
  const detailOptions = playerRadarRevisionQueryOptions(revisionId);
  const list = useQuery({
    ...listOptions,
    enabled: () => !revisionId && authorization.canRead("operations", listOptions.queryKey),
  });
  const detail = useQuery({
    ...detailOptions,
    enabled: () =>
      Boolean(revisionId) && authorization.canRead("operations", detailOptions.queryKey),
  });
  const result = revisionId ? detail : list;
  const update = (action: SeriesAnalysisAdminNavigation) => {
    if (authorization.begin("operations")) location.update(action);
  };
  return {
    allowed: authorization.allowed.operations,
    checking: authorization.auth.isChecking,
    list,
    detail,
    result,
    actions: {
      showList: () => update({ kind: "historyList" }),
      selectRevision: (value: string) => update({ kind: "historyRevision", value }),
      selectTitle: (value: string) => update({ kind: "historyTitle", value }),
      selectCursor: (value: string | undefined) => update({ kind: "historyCursor", value }),
      refresh: () => {
        if (authorization.begin("operations")) void result.refetch();
      },
    },
  };
}

function historyPresentation({
  allowed,
  checking,
  list,
  detail,
  result,
}: {
  allowed: boolean;
  checking: boolean;
  list: { data: PlayerRadarRevisionList | undefined };
  detail: { data: PlayerRadarRevisionDetail | undefined };
  result: { data: unknown; error: unknown; isFetching: boolean; isLoading: boolean };
}) {
  return {
    data: allowed ? list.data : undefined,
    revision: allowed ? detail.data : undefined,
    loading: checking || isInitialQueryLoading(result),
    refreshing: result.isFetching,
    disabled: !allowed,
    refreshDisabled: !allowed || result.isFetching,
    error: shouldShowQueryError(result)
      ? {
          ...normalizeDisplayApiError(result.error, "改訂履歴を読み込めません"),
          tone: result.data ? ("warning" as const) : ("danger" as const),
        }
      : null,
  };
}

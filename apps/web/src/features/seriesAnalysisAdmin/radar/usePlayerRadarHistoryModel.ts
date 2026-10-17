import { useQuery } from "@tanstack/react-query";

import type { SeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminUrlState";
import { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  playerRadarHistoryQueryOptions,
  playerRadarRevisionQueryOptions,
} from "@/shared/api/seriesPlayerRadarHistory";
import type { AuthorizationAccess } from "@/shared/auth/authorization";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** History navigation never changes the title or scope of the threshold editor. */
export function usePlayerRadarHistoryModel() {
  const authorization = useAuthorization();
  const location = useSeriesAnalysisAdminLocation();
  const history = usePlayerRadarHistory(authorization, location);
  return {
    ...location.history,
    ...history,
  };
}

function usePlayerRadarHistory(
  authorization: Pick<AuthorizationAccess, "canRead" | "allowed" | "auth" | "begin">,
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
    data: authorization.allowed.operations ? list.data : undefined,
    revision: authorization.allowed.operations ? detail.data : undefined,
    loading: authorization.auth.isChecking || isInitialQueryLoading(result),
    refreshing: result.isFetching,
    disabled: !authorization.allowed.operations,
    refreshDisabled: !authorization.allowed.operations || result.isFetching,
    error: shouldShowQueryError(result)
      ? {
          ...normalizeDisplayApiError(result.error, "改訂履歴を読み込めません"),
          tone: result.data ? ("warning" as const) : ("danger" as const),
        }
      : null,
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

import { useRadarHistoryRead } from "@/features/seriesAnalysisAdmin/radar/playerRadarQueryAdapter";
import type { SeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminUrlState";
import { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type { AuthorizationAccess } from "@/shared/auth/authorization";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** History navigation never changes the title or scope of the threshold editor. */
export function usePlayerRadarHistory() {
  const authorization = useAuthorization();
  const location = useSeriesAnalysisAdminLocation();
  const history = useAuthorizedRadarHistory(authorization, location);
  return {
    ...location.history,
    ...history,
  };
}

function useAuthorizedRadarHistory(
  authorization: Pick<AuthorizationAccess, "can" | "allowed" | "auth" | "begin">,
  location: ReturnType<typeof useSeriesAnalysisAdminLocation>,
) {
  const historyRead = useRadarHistoryRead(location.history, authorization);
  const update = (action: SeriesAnalysisAdminNavigation) => {
    if (authorization.begin("operations")) location.update(action);
  };
  return {
    data: historyRead.data,
    revision: historyRead.revision,
    loading: authorization.auth.isChecking || historyRead.loading,
    refreshing: historyRead.refreshing,
    disabled: !authorization.allowed.operations,
    refreshDisabled: !authorization.allowed.operations || historyRead.refreshing,
    error: historyRead.error
      ? {
          ...normalizeDisplayApiError(historyRead.error, "改訂履歴を読み込めません"),
          tone: historyRead.hasData ? ("warning" as const) : ("danger" as const),
        }
      : null,
    actions: {
      showList: () => update({ kind: "historyList" }),
      selectRevision: (value: string) => update({ kind: "historyRevision", value }),
      selectTitle: (value: string) => update({ kind: "historyTitle", value }),
      selectCursor: (value: string | undefined) => update({ kind: "historyCursor", value }),
      refresh: () => {
        if (authorization.begin("operations")) void historyRead.refresh();
      },
    },
  };
}

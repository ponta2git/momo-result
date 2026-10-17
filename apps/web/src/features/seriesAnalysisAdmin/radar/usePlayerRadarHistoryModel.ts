import { useRadarHistoryRead } from "@/features/seriesAnalysisAdmin/radar/playerRadarQueryAdapter";
import type { SeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminUrlState";
import { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
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
  authorization: Pick<AuthorizationAccess, "can" | "allowed" | "auth" | "begin">,
  location: ReturnType<typeof useSeriesAnalysisAdminLocation>,
) {
  const read = useRadarHistoryRead(location.history, authorization);
  const update = (action: SeriesAnalysisAdminNavigation) => {
    if (authorization.begin("operations")) location.update(action);
  };
  return {
    data: read.data,
    revision: read.revision,
    loading: authorization.auth.isChecking || read.loading,
    refreshing: read.refreshing,
    disabled: !authorization.allowed.operations,
    refreshDisabled: !authorization.allowed.operations || read.refreshing,
    error: read.error
      ? {
          ...normalizeDisplayApiError(read.error, "改訂履歴を読み込めません"),
          tone: read.hasData ? ("warning" as const) : ("danger" as const),
        }
      : null,
    actions: {
      showList: () => update({ kind: "historyList" }),
      selectRevision: (value: string) => update({ kind: "historyRevision", value }),
      selectTitle: (value: string) => update({ kind: "historyTitle", value }),
      selectCursor: (value: string | undefined) => update({ kind: "historyCursor", value }),
      refresh: () => {
        if (authorization.begin("operations")) void read.refresh();
      },
    },
  };
}

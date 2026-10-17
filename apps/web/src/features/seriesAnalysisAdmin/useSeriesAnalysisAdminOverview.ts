import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { selectAnalysisAdminOverview } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
import type { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { seriesAnalysisAdminOverviewQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import type { AuthorizationAccess } from "@/shared/auth/authorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Owns overview reads and the default-title handoff to its canonical URL/cache. */
export function useSeriesAnalysisAdminOverview({
  authorization,
  location,
  onTitleChange,
}: {
  authorization: Pick<AuthorizationAccess, "canRead" | "retained" | "auth" | "allowed" | "begin">;
  location: ReturnType<typeof useSeriesAnalysisAdminLocation>;
  onTitleChange: () => void;
}) {
  const queryClient = useQueryClient();
  const { gameTitleId, selectTitle } = location;
  const options = seriesAnalysisAdminOverviewQueryOptions(gameTitleId);
  const canRead = authorization.canRead("operations", options.queryKey);
  const query = useQuery({
    ...options,
    enabled: () => canRead && authorization.canRead("operations", options.queryKey),
  });
  const source = authorization.retained.operations ? query.data : undefined;
  const canonicalTitleId = source?.selectedTitle?.gameTitleId;
  const canonicalQuery = useQuery({
    ...seriesAnalysisAdminOverviewQueryOptions(canonicalTitleId, false),
    placeholderData: () => undefined,
  });
  const resolved = selectAnalysisAdminOverview({
    requestedTitleId: gameTitleId,
    source,
    sourceUpdatedAt: query.dataUpdatedAt,
    canonical: canonicalQuery.data,
    canonicalUpdatedAt: canonicalQuery.dataUpdatedAt,
    retained: authorization.retained.operations,
  });

  useEffect(() => {
    if (!canRead || gameTitleId || !canonicalTitleId || !source || query.isPlaceholderData) return;
    const key = seriesAnalysisAdminOverviewQueryOptions(canonicalTitleId).queryKey;
    // A refreshed canonical query wins over the default alias, including races after render.
    if ((queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) < query.dataUpdatedAt) {
      queryClient.setQueryData(key, source, { updatedAt: query.dataUpdatedAt });
    }
    selectTitle(canonicalTitleId);
  }, [
    canRead,
    canonicalTitleId,
    gameTitleId,
    source,
    query.dataUpdatedAt,
    query.isPlaceholderData,
    queryClient,
    selectTitle,
  ]);

  const error = shouldShowQueryError(query) ? normalizeDisplayApiError(query.error) : undefined;
  const errorTitle = useRetryNotice(error?.title, query.isFetching, gameTitleId ?? "");
  const errorDetail = useRetryNotice(error?.detail, query.isFetching, gameTitleId ?? "");
  const selectedGameTitleId = resolved.selection.gameTitleId;
  return {
    data: resolved.data,
    selection: resolved.selection,
    error: errorTitle ? { title: errorTitle, detail: errorDetail } : undefined,
    loading: (authorization.auth.isChecking || isInitialQueryLoading(query)) && !errorTitle,
    fetching: query.isFetching,
    refreshDisabled:
      !authorization.allowed.operations ||
      query.isFetching ||
      (!gameTitleId && canonicalTitleId !== undefined),
    actions: {
      selectTitle: (value: string) => {
        if (!authorization.begin("operations")) return;
        onTitleChange();
        selectTitle(value);
      },
      refresh: () => {
        if (!authorization.begin("operations")) return;
        void Promise.all([
          query.refetch(),
          selectedGameTitleId
            ? queryClient.invalidateQueries({
                queryKey: seriesPlayerRadarKeys.state(selectedGameTitleId),
                exact: true,
              })
            : Promise.resolve(),
        ]);
      },
      refreshRadar: () => {
        if (!selectedGameTitleId || !authorization.begin("operations")) return;
        void queryClient.invalidateQueries({
          queryKey: seriesPlayerRadarKeys.state(selectedGameTitleId),
          exact: true,
        });
      },
    },
  };
}

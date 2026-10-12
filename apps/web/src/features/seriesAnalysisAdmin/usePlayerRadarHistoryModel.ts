import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  playerRadarHistoryQueryOptions,
  playerRadarRevisionQueryOptions,
} from "@/shared/api/seriesPlayerRadarHistory";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** History navigation never changes the title or scope of the threshold editor. */
export function usePlayerRadarHistoryModel() {
  const authorization = useAuthorization();
  const [params, setParams] = useSearchParams();
  const gameTitleId = params.get("historyGameTitleId") || undefined;
  const cursor = params.get("historyCursor") || undefined;
  const revisionId = params.get("historyRevisionId") || undefined;
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
  const update = (values: Record<string, string | undefined>) => {
    if (!authorization.begin("operations")) return;
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  return {
    gameTitleId,
    cursor,
    revisionId,
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
      showList: () => update({ historyRevisionId: undefined }),
      selectRevision: (value: string) => update({ historyRevisionId: value }),
      selectTitle: (value: string) =>
        update({
          historyGameTitleId: value,
          historyCursor: undefined,
          historyRevisionId: undefined,
        }),
      selectCursor: (value: string | undefined) => update({ historyCursor: value }),
      refresh: () => {
        if (authorization.begin("operations")) void result.refetch();
      },
    },
  };
}

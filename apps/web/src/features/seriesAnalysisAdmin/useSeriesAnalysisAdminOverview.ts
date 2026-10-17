import { useEffect } from "react";

import { useAnalysisAdminOverviewRead } from "@/features/seriesAnalysisAdmin/analysisAdminQueryAdapter";
import { selectAnalysisAdminOverview } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
import type { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type { AuthorizationAccess } from "@/shared/auth/authorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Adopts the resolved default title and guards administration actions. */
export function useSeriesAnalysisAdminOverview({
  authorization,
  location,
  onTitleChange,
}: {
  authorization: Pick<AuthorizationAccess, "can" | "retained" | "auth" | "allowed" | "begin">;
  location: ReturnType<typeof useSeriesAnalysisAdminLocation>;
  onTitleChange: () => void;
}) {
  const { gameTitleId, selectTitle } = location;
  const read = useAnalysisAdminOverviewRead(gameTitleId, authorization);
  const resolved = selectAnalysisAdminOverview(read.data, read.selectedTitleId);
  useEffect(() => {
    if (read.defaultTitleId) selectTitle(read.defaultTitleId);
  }, [read.defaultTitleId, selectTitle]);

  const error = read.error ? normalizeDisplayApiError(read.error) : undefined;
  const errorTitle = useRetryNotice(error?.title, read.fetching, gameTitleId ?? "");
  const errorDetail = useRetryNotice(error?.detail, read.fetching, gameTitleId ?? "");
  const selectedGameTitleId = resolved.selection.gameTitleId;
  return {
    data: resolved.data,
    selection: resolved.selection,
    error: errorTitle ? { title: errorTitle, detail: errorDetail } : undefined,
    loading: (authorization.auth.isChecking || read.loading) && !errorTitle,
    fetching: read.fetching,
    refreshDisabled:
      !authorization.allowed.operations || read.fetching || read.resolvingDefaultTitle,
    actions: {
      selectTitle: (value: string) => {
        if (!authorization.begin("operations")) return;
        onTitleChange();
        selectTitle(value);
      },
      refresh: () => {
        if (!authorization.begin("operations")) return;
        void read.refresh();
      },
      refreshRadar: () => {
        if (!selectedGameTitleId || !authorization.begin("operations")) return;
        read.refreshRadar();
      },
    },
  };
}

import { useEffect } from "react";

import { useAnalysisAdminOverviewRead } from "@/features/seriesAnalysisAdmin/analysisAdminQueryAdapter";
import { buildAnalysisAdminOverviewView } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
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
  const overviewRead = useAnalysisAdminOverviewRead(gameTitleId, authorization);
  const overviewView = buildAnalysisAdminOverviewView(
    overviewRead.data,
    overviewRead.selectedTitleId,
  );
  useEffect(() => {
    if (overviewRead.defaultTitleId) selectTitle(overviewRead.defaultTitleId);
  }, [overviewRead.defaultTitleId, selectTitle]);

  const error = overviewRead.error ? normalizeDisplayApiError(overviewRead.error) : undefined;
  const errorTitle = useRetryNotice(error?.title, overviewRead.fetching, gameTitleId ?? "");
  const errorDetail = useRetryNotice(error?.detail, overviewRead.fetching, gameTitleId ?? "");
  const selectedGameTitleId = overviewView.selection.gameTitleId;
  return {
    data: overviewView.data,
    selection: overviewView.selection,
    error: errorTitle ? { title: errorTitle, detail: errorDetail } : undefined,
    loading: (authorization.auth.isChecking || overviewRead.loading) && !errorTitle,
    fetching: overviewRead.fetching,
    refreshDisabled:
      !authorization.allowed.operations ||
      overviewRead.fetching ||
      overviewRead.resolvingDefaultTitle,
    actions: {
      selectTitle: (value: string) => {
        if (!authorization.begin("operations")) return;
        onTitleChange();
        selectTitle(value);
      },
      refresh: () => {
        if (!authorization.begin("operations")) return;
        void overviewRead.refresh();
      },
      refreshRadar: () => {
        if (!selectedGameTitleId || !authorization.begin("operations")) return;
        overviewRead.refreshRadar();
      },
    },
  };
}

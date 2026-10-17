import { buildRecalculationView } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminPresentation";
import { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { useSeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminNavigation";
import { useSeriesAnalysisAdminOverview } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminOverview";
import { useSeriesAnalysisRecalculation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisRecalculation";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** Composes navigation, overview reads and recalculation receipts into the page contract. */
export function useSeriesAnalysisAdmin() {
  const authorization = useAuthorization();
  const location = useSeriesAnalysisAdminLocation();
  const recalculationCommands = useSeriesAnalysisRecalculation(authorization);
  const overview = useSeriesAnalysisAdminOverview({
    authorization,
    location,
    onTitleChange: recalculationCommands.clearFeedback,
  });
  const recalculationView = buildRecalculationView({
    ...recalculationCommands,
    selectedTitle: overview.selection.selectedTitle,
    selectedGameTitleId: overview.selection.gameTitleId,
  });
  const navigation = useSeriesAnalysisAdminNavigation({
    location,
    authorization,
    selectedTitleName: overview.selection.selectedTitle?.gameTitleName,
    refreshRadar: overview.actions.refreshRadar,
    clearRecalculationFeedback: recalculationCommands.clearFeedback,
  });
  return {
    authorization: {
      canOperate: authorization.allowed.operations,
      retainOperations: authorization.retained.operations,
      canRecalculateAll: authorization.allowed.admin,
      retainAdmin: authorization.retained.admin,
    },
    actions: {
      ...overview.actions,
      recalculateAll: () =>
        recalculationCommands.recalculateAll(overview.data?.titleOptions.length ?? 0),
      recalculateTitle: () =>
        recalculationCommands.recalculateTitle(overview.selection.selectedTitle),
    },
    navigation,
    feedback: {
      acceptance: recalculationView.acceptance,
      mutationError: recalculationView.error,
      resourceError: overview.error,
    },
    recalculation: recalculationView.status,
    resource: {
      data: overview.data,
      loading: overview.loading,
      refreshing: overview.fetching && !recalculationCommands.pending,
      refreshDisabled: overview.refreshDisabled || recalculationCommands.pending,
    },
    selection: overview.selection,
  };
}

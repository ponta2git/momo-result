import { recalculationPresentation } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminModel";
import { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import { useSeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminNavigation";
import { useSeriesAnalysisAdminOverview } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminOverview";
import { useSeriesAnalysisRecalculation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisRecalculation";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** Composes navigation, overview reads and recalculation receipts into the page contract. */
export function useSeriesAnalysisAdminPageModel() {
  const authorization = useAuthorization();
  const location = useSeriesAnalysisAdminLocation();
  const commands = useSeriesAnalysisRecalculation(authorization);
  const overview = useSeriesAnalysisAdminOverview({
    authorization,
    location,
    onTitleChange: commands.clearFeedback,
  });
  const recalculation = recalculationPresentation({
    ...commands,
    selectedTitle: overview.selection.selectedTitle,
    selectedGameTitleId: overview.selection.gameTitleId,
  });
  const navigation = useSeriesAnalysisAdminNavigation({
    location,
    authorization,
    selectedTitleName: overview.selection.selectedTitle?.gameTitleName,
    refreshRadar: overview.actions.refreshRadar,
    clearRecalculationFeedback: commands.clearFeedback,
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
      recalculateAll: () => commands.recalculateAll(overview.data?.titleOptions.length ?? 0),
      recalculateTitle: () => commands.recalculateTitle(overview.selection.selectedTitle),
    },
    navigation,
    feedback: {
      acceptance: recalculation.acceptance,
      mutationError: recalculation.error,
      resourceError: overview.error,
    },
    recalculation: recalculation.status,
    resource: {
      data: overview.data,
      loading: overview.loading,
      refreshing: overview.fetching && !commands.pending,
      refreshDisabled: overview.refreshDisabled || commands.pending,
    },
    selection: overview.selection,
  };
}
